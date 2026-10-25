import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOpenMcp } from './open-mcp';
import { AUDIT_FILE, AUDIT_MAX, redact } from './open-mcp-settings';

const freePort = async () => { const server = createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const { port } = server.address() as AddressInfo; await new Promise<void>(resolve => server.close(() => resolve())); return port; };
// Fake secrets planted everywhere a careless read could leak them.
const FAKE = ['sk-FAKE-VISION-111', 'sk-FAKE-BACKUP-222', 'sk-FAKE-TEXT-333', 'FAKE-LICENCE-444', 'FD-FAKE-MACH-INE0', 'QWERTY', 'sk-NEW-KEY-555', 'sk-NEW-TEXT-666'];
const noSecrets = (where: string, value: unknown) => { const text = typeof value === 'string' ? value : JSON.stringify(value); for (const secret of FAKE) assert.ok(!text.includes(secret), `${where} leaked ${secret}`); };

type Options = { confirm?: 'yes' | 'none'; status?: string; application?: string };
async function harness(t: TestContext, options: Options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'kada-mcp-settings-'));
  const file = join(dir, 'open-mcp.json');
  const reception = { status: options.status ?? 'paused', message: '', cycle: 0, jobs: [] as never[], config: { receptionMode: 'inbox', conversations: [], mode: 'auto', pollSeconds: 5, maxRepliesPerHour: 60, knowledgeIds: [], workflowId: '', layout: { x: 1 }, application: options.application ?? 'chat_app', reviewMode: 'risky', adminContact: 'QWERTY-老板', adminTag: 'QWERTY', persona: { tone: 'friendly', name: '合成小店' }, dailySummaryAt: '21:00', receptionSuspended: false } as Record<string, unknown> };
  const knowledge = [
    { id: 'knowledge_a', title: '价格', content: '298 元/30 天', tags: [], enabled: true, reviewStatus: 'approved', updatedAt: '2026-10-01T00:00:00.000Z' },
    { id: 'knowledge_b', title: '发货', content: '3 天内发货', tags: ['来源:MCP'], enabled: false, reviewStatus: 'pending', updatedAt: '2026-10-02T00:00:00.000Z' },
  ];
  const workflows = [{ id: 'workflow_1', name: '售前话术', scenario: 'sales', description: '', instructions: '先问需求', greeting: '你好', enabled: true, updatedAt: '' }];
  const provider = { baseUrl: 'https://api.text.example/v1', model: 'text-1', temperature: 0.3, hasKey: true, apiKey: 'sk-FAKE-TEXT-333' };
  const requests: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
  const saved: Array<Record<string, unknown>> = [];
  const confirms: string[] = [];
  const answer: { no: boolean; hold: boolean; release?: () => void } = { no: false, hold: false };
  const calls = { start: 0, stop: 0, visionSave: [] as unknown[], backup: [] as unknown[], pool: [] as boolean[] };
  const vision = { activeId: 'qwen-cn', backupId: 'zhipu-cn', profiles: [{ id: 'qwen-cn', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3-vl-plus', hasKey: true, apiKey: 'sk-FAKE-VISION-111' }, { id: 'zhipu-cn', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.6v-flash', hasKey: true, key: 'sk-FAKE-BACKUP-222' }, { id: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-3.8-flash', hasKey: false }] };
  const mcp = createOpenMcp({
    file,
    request: async input => {
      requests.push(input);
      if (input.path === '/state') return { knowledge, workflows, provider, preferences: { workspaceName: '合成工作台', operatorName: '合成' }, tasks: [], events: [] };
      if (input.path === '/license/status') return { ok: true, status: { machineId: 'FD-FAKE-MACH-INE0', licensed: true, plan: 'annual', licenseKey: 'FAKE-LICENCE-444', trialUsed: 3, trialLimit: 50 } };
      if (input.path === '/knowledge/import/preview') return { previewId: 'p1', warnings: [], rows: [{ rowId: '1', title: '退货', content: '7 天无理由', tags: [], errors: [] }, { rowId: '2', title: '价格', content: '298 元/30 天', errors: [], duplicateOf: 'knowledge_a' }] };
      if (input.path === '/knowledge/import/commit') return { created: [{ id: 'knowledge_c', title: '退货' }], skipped: 0 };
      if (input.method === 'PUT' && input.path.startsWith('/knowledge/')) return { reviewStatus: input.body?.content ? 'pending' : 'approved', enabled: input.body?.enabled === true };
      if (input.path === '/provider/test') return { ok: true, message: '连通', model: 'text-1', apiKey: 'sk-FAKE-TEXT-333' };
      return { ok: true };
    },
    reception: () => reception as never,
    pauseReception: async () => undefined,
    suspendReception: async value => { reception.config.receptionSuspended = value; },
    ...(options.confirm === 'none' ? {} : { confirmOwner: async (reason: string) => { confirms.push(reason); if (answer.hold) await new Promise<void>(resolve => { answer.release = resolve; }); if (answer.no) throw new Error('已取消'); } }),
    settings: {
      // The reception page's validator, reduced to two of its rules for this fixture.
      saveReplyConfig: async (config: any) => { if (!['off', 'new', 'risky', 'all', undefined].includes(config.reviewMode)) throw new Error('审核模式无效'); if (!Number.isInteger(config.pollSeconds) || config.pollSeconds < 1) throw new Error('回复配置无效'); saved.push(config as never); reception.config = { ...config } as never; return reception; },
      startReception: async () => { calls.start++; reception.status = 'running'; },
      stopReception: async () => { calls.stop++; reception.status = 'stopped'; },
      vision: {
        settings: async () => structuredClone(vision) as never,
        save: async input => { calls.visionSave.push(input); return vision as never; },
        saveBackup: async input => { calls.backup.push(input); return vision as never; },
        clearBackup: async () => vision as never,
        test: async () => ({ model: 'qwen3-vl-plus', message: '图片识别测试通过', durationMs: 900, apiKey: 'sk-FAKE-VISION-111' } as never),
      },
      pool: { status: async () => ({ enabled: true, models: [{ id: 'qwen-vl-max', ms: 800 }] }), setEnabled: async enabled => { calls.pool.push(enabled); return { enabled, models: [] }; }, refresh: async () => ({ enabled: true, models: [] }) },
      displayMode: () => 'floater',
    },
  });
  t.after(async () => { await mcp.close(); await rm(dir, { recursive: true, force: true }); });
  await mcp.init();
  let s = await mcp.save({ enabled: true, port: await freePort() });
  s = await mcp.addClient({ label: 'Cursor', tool: 'cursor' }); const cursor = s.clients.at(-1)!.id;
  const keyOf = (id: string) => id === 'default' ? s.token : mcp.clientKey(id);
  const rpc = async (as: string, method: string, params: Record<string, unknown> = {}) => (await (await fetch(s.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${keyOf(as)}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json() as { result: Record<string, unknown> }).result;
  const call = async (as: string, name: string, args: Record<string, unknown> = {}) => { const r = await rpc(as, 'tools/call', { name, arguments: args }) as { isError?: boolean; content: Array<{ text: string }> }; return { isError: r.isError ?? false, text: r.content[0].text }; };
  const names = async (as: string) => ((await rpc(as, 'tools/list')).tools as Array<{ name: string }>).map(tool => tool.name);
  const grant = async (configWrite: boolean, skipConfirm?: boolean) => { s = await mcp.save({ clientScope: { id: cursor, configWrite, ...(skipConfirm !== undefined ? { skipConfirm } : {}) } }); };
  return { mcp, dir, file, cursor, rpc, call, names, grant, reception, requests, saved, confirms, answer, calls, state: () => s };
}

test('读取工具对所有调用方开放，输出里没有任何密钥、卡密或暗号（只有 hasKey）', async t => {
  const h = await harness(t);
  for (const as of ['default', h.cursor]) {
    const settings = await h.call(as, 'settings_get'); assert.equal(settings.isError, false); noSecrets('settings_get', settings.text);
    const view = JSON.parse(settings.text);
    assert.equal(view.platform.id, 'chat_app'); assert.equal(view.review.effective, 'risky'); assert.equal(view.adminContact, '老板'); assert.equal(view.config.adminContact, '老板');
    assert.equal(view.adminTagged, true); assert.equal(view.models.vision.main.hasKey, true); assert.equal(view.models.text.hasKey, true); assert.equal(view.models.vision.backup.provider, 'zhipu-cn');
    assert.equal(view.license.licensed, true); assert.equal(view.displayMode, 'floater'); assert.equal(view.workflows[0].name, '售前话术'); assert.equal(view.config.persona.name, '合成小店');
    assert.ok(!('layout' in view.config) && !('adminTag' in view.config));
    const models = await h.call(as, 'models_get'); noSecrets('models_get', models.text); assert.equal(JSON.parse(models.text).autoPool.models[0].id, 'qwen-vl-max');
    const list = JSON.parse((await h.call(as, 'knowledge_list', { status: 'pending' })).text);
    assert.deepEqual([list.total, list.items[0].id, list.items[0].review], [1, 'knowledge_b', 'pending']);
  }
});

test('兜底脱敏：任何层级的密钥、卡密、令牌和暗号字段都被去掉，hasKey 与关键词规则保留', () => {
  assert.deepEqual(redact({ apiKey: 'x', nested: [{ licenseKey: 'y', hasKey: true, keywordRules: [{ keywords: ['a'] }] }], adminTag: 'z', token: 't' }), { nested: [{ hasKey: true, keywordRules: [{ keywords: ['a'] }] }] });
});

test('没有「可以修改设置」时写入工具不在列表里，调用被拒绝并记入审计；读取和原有工具照常可用', async t => {
  const h = await harness(t);
  const base = ['knowledge_search', 'knowledge_answer', 'reception_status', 'reception_control', 'knowledge_add', 'settings_get', 'models_get', 'knowledge_list'];
  assert.deepEqual(await h.names('default'), base); assert.deepEqual(await h.names(h.cursor), base);
  for (const as of ['default', h.cursor]) {
    const refused = await h.call(as, 'settings_update', { reception: { reviewMode: 'all' } });
    assert.equal(refused.isError, true); assert.match(refused.text, as === 'default' ? /默认密钥不能修改设置/ : /「Cursor」没有修改设置权限/);
    assert.match((await h.call(as, 'reception_control', { action: 'start' })).text, /修改设置权限|默认密钥不能修改设置/);
  }
  assert.equal(h.saved.length, 0); assert.equal(h.calls.start, 0);
  assert.equal(h.mcp.state().audit[0].outcome, 'refused');
  // Existing behaviour: pause stays open to every caller, and is now audited.
  assert.equal((await h.call('default', 'reception_control', { action: 'pause' })).isError, false); assert.equal(h.reception.config.receptionSuspended, true);
  assert.deepEqual([h.mcp.state().audit[0].tool, h.mcp.state().audit[0].caller], ['reception_control', '开放接口']);
  assert.equal(JSON.parse((await h.call('default', 'reception_control', { action: 'status' })).text).suspended, true);
});

test('授予修改设置要主人确认；授予后写入工具出现；默认密钥无法授予', async t => {
  const h = await harness(t);
  await h.grant(true);
  assert.match(h.confirms[0], /允许「Cursor」修改咔哒设置/);
  assert.ok((await h.names(h.cursor)).includes('settings_update')); assert.ok(!(await h.names('default')).includes('settings_update'));
  await h.grant(true, true); assert.match(h.confirms[1], /不经确认/);
  await h.grant(false); assert.equal(h.state().clients[0].configWrite, false); assert.equal(h.state().clients[0].skipConfirm, false);
  await assert.rejects(h.mcp.save({ clientScope: { id: 'default', configWrite: true } }), /客户端不存在/);
  await assert.rejects(h.mcp.save({ clientScope: { id: h.cursor, configWrite: 'yes' as never } }), /权限无效/);
  const denied = await harness(t); denied.answer.no = true;
  await assert.rejects(denied.grant(true), /已取消/); assert.equal(denied.state().clients[0].configWrite, false);
});

test('settings_update：未知字段、禁改字段和校验错误都原样报出；接待运行中拒绝修改', async t => {
  const h = await harness(t); await h.grant(true);
  assert.match((await h.call(h.cursor, 'settings_update', { reception: { nope: 1 } })).text, /未知设置项：nope/);
  assert.match((await h.call(h.cursor, 'settings_update', { reception: { adminTag: 'ACDEFG' } })).text, /adminTag 不能经开放接口修改/);
  assert.match((await h.call(h.cursor, 'settings_update', { reception: { lightModel: 'x' } })).text, /请用 models_set/);
  assert.match((await h.call(h.cursor, 'settings_update', { extra: {} })).text, /未知参数：extra/);
  const invalid = await h.call(h.cursor, 'settings_update', { reception: { pollSeconds: 0 } });
  assert.equal(invalid.isError, true); assert.equal(invalid.text, '回复配置无效');
  assert.equal(h.saved.length, 0);
  const ok = await h.call(h.cursor, 'settings_update', { reception: { dailySummaryAt: '20:30', persona: { tone: 'brief' }, reviewMode: 'all' }, preferences: { workspaceName: '新名字' }, workflow: { action: 'update', id: 'workflow_1', instructions: '先报价' } });
  assert.equal(ok.isError, false, ok.text);
  assert.deepEqual([h.saved[0].dailySummaryAt, h.saved[0].reviewMode, (h.saved[0].persona as { tone: string }).tone, h.saved[0].adminTag], ['20:30', 'all', 'brief', 'QWERTY']);
  assert.deepEqual(h.requests.find(r => r.path === '/settings')?.body, { preferences: { workspaceName: '新名字', operatorName: '合成' } });
  assert.equal(h.requests.find(r => r.path === '/workflows/workflow_1')?.method, 'PUT');
  assert.equal(h.confirms.length, 1, 'tightening review needs no confirmation');
  assert.match((await h.call(h.cursor, 'settings_update', { workflow: { action: 'delete', id: '../license/activate' } })).text, /话术 id 无效/);
  h.reception.status = 'running';
  assert.match((await h.call(h.cursor, 'settings_update', { reception: { dailySummaryAt: '' } })).text, /接待正在运行/);
});

test('放宽审核（通用模式改平台）、改管理员和固定话术需要主人确认；主人拒绝或无法确认时不保存并记为 refused', async t => {
  const h = await harness(t, { application: 'other' }); await h.grant(true); h.confirms.length = 0;
  for (const reception of [{ application: 'chat_app' }, { adminContact: '别人' }, { mediaAutoReply: '点这个链接' }, { draftOnly: false }, { adminContact: '别人' }]) {
    const before = h.confirms.length;
    const result = await h.call(h.cursor, 'settings_update', { reception }); assert.equal(result.isError, false, result.text);
    assert.equal(h.confirms.length, before + (h.confirms.length > before ? 1 : 0));
  }
  assert.equal(h.confirms.length, 3, 'draftOnly was not on, and the same admin name twice is one change');
  assert.match(h.confirms[0], /^「Cursor」请求：把发送前审核从「全部先审核」改为「高风险先审核」/);
  assert.match(h.confirms[1], /管理员联系人改为「别人」/); assert.match(h.confirms[2], /固定话术/);
  noSecrets('confirm', h.confirms);
  // The shown admin name hides the tag; sending it back unchanged keeps the tagged name.
  const t2 = await harness(t); await t2.grant(true); t2.confirms.length = 0;
  assert.equal(JSON.parse((await t2.call(t2.cursor, 'settings_get')).text).adminContact, '老板');
  assert.equal((await t2.call(t2.cursor, 'settings_update', { reception: { adminContact: '老板', reviewMode: 'all' } })).isError, false);
  assert.deepEqual([t2.saved[0].adminContact, t2.confirms.length], ['QWERTY-老板', 0]);
  t2.answer.no = true;
  const refused = await t2.call(t2.cursor, 'settings_update', { reception: { reviewMode: 'off' } });
  assert.equal(refused.isError, true); assert.match(refused.text, /主人没有确认：已取消/); assert.equal(t2.saved.length, 1);
  assert.equal(t2.mcp.state().audit[0].outcome, 'refused');
  const none = await harness(t, { application: 'other', confirm: 'none' }); await none.grant(true);
  const cannot = await none.call(none.cursor, 'settings_update', { reception: { application: 'chat_app' } });
  assert.match(cannot.text, /不能弹出确认/); assert.equal(none.saved.length, 0);
  await none.grant(true, true);
  assert.equal((await none.call(none.cursor, 'settings_update', { reception: { application: 'chat_app', reviewMode: 'off' } })).isError, false);
  assert.deepEqual([none.saved[0].application, none.saved[0].reviewMode, none.mcp.state().audit[0].outcome], ['chat_app', 'off', 'ok']);
});

test('确认期间权限被收回则放弃；同一时间只等一个确认', async t => {
  const h = await harness(t); await h.grant(true); h.confirms.length = 0;
  h.answer.hold = true;
  const pending = h.call(h.cursor, 'knowledge_delete', { id: 'knowledge_a' });
  while (!h.confirms.length) await new Promise(r => setTimeout(r, 5));
  assert.match((await h.call(h.cursor, 'knowledge_delete', { id: 'knowledge_a' })).text, /已有一个修改在等主人确认/);
  h.answer.hold = false; await h.mcp.save({ clientScope: { id: h.cursor, configWrite: false } }); h.answer.release?.();
  assert.match((await pending).text, /权限已被收回/);
  assert.equal(h.requests.some(r => r.method === 'DELETE'), false);
});

test('模型：apiKey 只写入不返回；换模型要确认；回复模型换地址必须带新密钥；内置模型版不能经接口开启', async t => {
  const h = await harness(t); await h.grant(true); h.confirms.length = 0;
  const set = await h.call(h.cursor, 'models_set', { vision: { provider: 'siliconflow-cn', model: 'Qwen/Qwen3-VL-32B-Instruct', apiKey: 'sk-NEW-KEY-555' }, autoPool: false, lightModel: 'qwen-vl-lite' });
  assert.equal(set.isError, false, set.text); noSecrets('models_set', set.text);
  assert.deepEqual(h.calls.visionSave[0], { id: 'siliconflow-cn', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen3-VL-32B-Instruct', apiKey: 'sk-NEW-KEY-555' });
  assert.deepEqual(h.calls.pool, [false]); assert.equal(h.saved.at(-1)?.lightModel, 'qwen-vl-lite');
  assert.equal(h.confirms.length, 1); assert.match(h.confirms[0], /画面识别主模型改为 .*api\.siliconflow\.cn.*并更换密钥/); noSecrets('confirm', h.confirms);
  assert.match((await h.call(h.cursor, 'models_set', { text: { baseUrl: 'https://evil.example/v1' } })).text, /必须同时提供新密钥/);
  assert.equal(h.requests.some(r => r.path === '/settings'), false);
  assert.equal((await h.call(h.cursor, 'models_set', { text: { baseUrl: 'https://other.example/v1', model: 'm2', apiKey: 'sk-NEW-TEXT-666' } })).isError, false);
  assert.deepEqual(h.requests.find(r => r.path === '/settings')?.body, { provider: { baseUrl: 'https://other.example/v1', model: 'm2', temperature: 0.3, apiKey: 'sk-NEW-TEXT-666' } });
  assert.match((await h.call(h.cursor, 'models_set', { vision: { provider: 'unknown-vendor', model: 'x' } })).text, /provider 无效/);
  assert.match((await h.call(h.cursor, 'models_set', { backup: { provider: 'nope', model: 'x' } })).text, /provider 无效/);
  const tested = await h.call(h.cursor, 'models_test', { target: 'main' }); assert.equal(JSON.parse(tested.text).durationMs, 900); noSecrets('models_test', tested.text);
  noSecrets('models_test text', (await h.call(h.cursor, 'models_test', { target: 'text' })).text);
  noSecrets('audit', h.mcp.state().audit); noSecrets('audit file', await readFile(join(h.dir, AUDIT_FILE), 'utf8'));
});

test('知识管理：列表、通过（确认）、驳回（只限待审核）、修改、删除（确认）、导入文本进待审核', async t => {
  const h = await harness(t); await h.grant(true); h.confirms.length = 0;
  assert.match((await h.call(h.cursor, 'knowledge_review', { ids: ['knowledge_a'], action: 'reject' })).text, /不是待审核条目/);
  assert.equal((await h.call(h.cursor, 'knowledge_review', { ids: ['knowledge_b'], action: 'approve' })).isError, false);
  assert.match(h.confirms[0], /审核通过并启用 1 条知识/); assert.deepEqual(h.requests.find(r => r.path === '/knowledge/review')?.body, { ids: ['knowledge_b'], approved: true });
  assert.equal((await h.call(h.cursor, 'knowledge_review', { ids: ['knowledge_b'], action: 'reject' })).isError, false);
  assert.equal(h.confirms.length, 1, 'rejecting a pending item needs no confirmation');
  const updated = JSON.parse((await h.call(h.cursor, 'knowledge_update', { id: 'knowledge_a', content: '新价格' })).text); assert.equal(updated.review, 'pending');
  assert.equal((await h.call(h.cursor, 'knowledge_delete', { id: 'knowledge_a' })).isError, false); assert.match(h.confirms.at(-1)!, /永久删除知识「价格」/);
  assert.match((await h.call(h.cursor, 'knowledge_delete', { id: 'knowledge_zzz' })).text, /知识不存在/);
  const imported = JSON.parse((await h.call(h.cursor, 'knowledge_import', { text: '退货：7 天无理由', sourceName: '售后手册' })).text);
  assert.deepEqual([imported.created, imported.skipped], [1, 1]);
  const commit = h.requests.find(r => r.path === '/knowledge/import/commit')!.body as { rows: Array<{ rowId: string; tags: string[] }> };
  assert.deepEqual(commit.rows.map(r => [r.rowId, r.tags]), [['1', ['来源:MCP']]]);
});

test('reception_control：start 要权限和主人确认，stop 直接停止；pause/resume 行为不变', async t => {
  const h = await harness(t); await h.grant(true); h.confirms.length = 0;
  const started = await h.call(h.cursor, 'reception_control', { action: 'start' });
  assert.equal(started.isError, false); assert.equal(h.calls.start, 1); assert.equal(JSON.parse(started.text).status, 'running');
  assert.match(h.confirms[0], /开始自动接待/);
  assert.equal((await h.call(h.cursor, 'reception_control', { action: 'start' })).isError, false); assert.equal(h.calls.start, 1, 'already running');
  assert.equal(JSON.parse((await h.call(h.cursor, 'reception_control', { action: 'stop' })).text).status, 'stopped');
  assert.match((await h.call(h.cursor, 'reception_control', { action: 'nope' })).text, /pause、resume、status、start 或 stop/);
  const tools = (await h.rpc(h.cursor, 'tools/list')).tools as Array<{ name: string; inputSchema: { properties: { action?: { enum: string[] } } } }>;
  assert.deepEqual(tools.find(tool => tool.name === 'reception_control')?.inputSchema.properties.action?.enum, ['pause', 'resume', 'status', 'start', 'stop']);
});

test('审计：每次写入记下时间、调用方、工具和摘要，最多 50 条，重启后保留；可在开放页单独关闭设置工具', async t => {
  const h = await harness(t); await h.grant(true, true);
  for (let i = 0; i < AUDIT_MAX + 5; i++) await h.call(h.cursor, 'settings_update', { reception: { pollSeconds: 5 + (i % 3) } });
  const audit = h.mcp.state().audit;
  assert.equal(audit.length, AUDIT_MAX);
  assert.deepEqual([audit[0].caller, audit[0].callerId, audit[0].tool, audit[0].outcome], ['Cursor', h.cursor, 'settings_update', 'ok']);
  assert.match(audit[0].summary, /接待配置：pollSeconds/); assert.ok(Date.parse(audit[0].at) > 0);
  await h.mcp.close();
  const stored = JSON.parse(await readFile(join(h.dir, AUDIT_FILE), 'utf8')) as { entries: unknown[] };
  assert.equal(stored.entries.length, AUDIT_MAX);
  const saved = await h.mcp.save({ disabledTools: ['settings_get', 'knowledge_delete'] });
  assert.deepEqual(saved.disabledTools, ['settings_get', 'knowledge_delete']);
});
