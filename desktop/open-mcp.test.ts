import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type AddressInfo } from 'node:net';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOpenMcp } from './open-mcp';
const createAppTasks = (opts?: any) => {
  const tasksList: any[] = [];
  let seq = 0;
  return {
    apps: () => opts?.allowedApps ? Object.fromEntries(Object.entries(opts.allowedApps).map(([k, v]: [string, any]) => [k, v.label])) : {},
    request: async (owner: any, args: any) => {
      if (opts?.allowedApps && !opts.allowedApps[args.app]) throw new Error(`应用「${args.app}」不在允许列表中`);
      const existing = tasksList.find(t => t.callerKey === owner.key && t.requestId === args.requestId);
      if (existing) return existing;
      seq++;
      const appName = opts?.allowedApps?.[args.app]?.label ?? args.app;
      const task = {
        taskId: String(seq),
        no: seq,
        status: 'queued',
        callerKey: owner.key,
        label: owner.label,
        requestId: args.requestId,
        instruction: args.instruction,
        app: args.app,
        maxSteps: args.maxSteps ?? 3,
        remoteApproval: true
      };
      tasksList.push(task);
      if (opts?.notifyAdmin) {
        opts.notifyAdmin('remote_task', `「${owner.label}」请求在「${appName}」执行任务 ${seq}：${args.instruction}。在管理员通知里回复「允许 ${seq}」加验证器上的 6 位数。`);
      }
      return task;
    },
    status: (owner: any, taskId: string) => {
      const task = tasksList.find(t => t.taskId === taskId && t.callerKey === owner.key);
      if (!task) throw new Error('任务不存在');
      return task;
    },
    cancel: async (owner: any, taskId: string) => {
      const task = tasksList.find(t => t.taskId === taskId && t.callerKey === owner.key);
      if (!task) throw new Error('任务不存在');
      task.status = 'cancelled';
      return task;
    },
    listForOwner: (owner: any) => tasksList.filter(t => t.callerKey === owner.key),
    list: () => tasksList,
    record: (..._args: any[]) => {},
    init: async (..._args: any[]) => {},
    revoke: async (reason: string) => {
      for (const t of tasksList) {
        if (t.status === 'queued') t.status = 'cancelled';
      }
    },
    revokeCaller: async (callerId: string, reason: string) => {
      for (const t of tasksList) {
        if (t.callerKey === callerId && t.status === 'queued') t.status = 'cancelled';
      }
    },
    forgetCaller: async (..._args: any[]) => {},
    cancelAll: async (..._args: any[]) => {
      for (const t of tasksList) {
        if (t.status === 'queued') t.status = 'cancelled';
      }
    },
    whenIdle: async (..._args: any[]) => {},
    handleAdminText: async (text: string, ..._args: any[]) => {
      const m = text.match(/允许\s*(\d+)/);
      if (m) {
        const id = m[1];
        const task = tasksList.find(t => (t.taskId === id || t.no === Number(id)) && t.status === 'queued');
        if (task) {
          task.status = 'completed';
          task.result = '合成：演练';
          task.approvedVia = 'remote';
          return '已批准';
        }
        return `没有待批准的任务 ${id}`;
      }
      return '未找到任务';
    }
  };
};

const freePort = async () => {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
};
type Reception = { status: string; suspended: boolean };
async function receptionHarness(t: TestContext, initial: Reception) {
  const dir = await mkdtemp(join(tmpdir(), 'kada-mcp-resume-'));
  const reception: Reception = { ...initial };
  const mcp = createOpenMcp({
    file: join(dir, 'open-mcp.json'),
    request: async () => ({}),
    reception: () => ({ status: reception.status, message: '', cycle: 0, jobs: [], config: { receptionSuspended: reception.suspended } }),
    pauseReception: async () => undefined,
    suspendReception: async value => { reception.suspended = value; },
  });
  t.after(async () => { await mcp.close(); await rm(dir, { recursive: true, force: true }); });
  await mcp.init();
  const s = await mcp.save({ enabled: true, port: await freePort() });
  const post = async (body: string) => { const r = await fetch(s.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.token}` }, body }); return { status: r.status, json: await r.json() }; };
  const control = async (action: string) => {
    const { json } = await post(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'reception_control', arguments: { action } } }));
    const result = json.result as { isError?: boolean; content: Array<{ text: string }> };
    return { isError: result.isError ?? false, body: JSON.parse(result.content[0].text) as { suspended: boolean; status: string; running: boolean; note: string } };
  };
  return { reception, control, post };
}

test('MCP 服务：需要密钥，列出 5 个工具，检索/状态/暂停可用，写入只进待审核', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'kada-mcp-'));
  const requests: Array<{ path: string; body?: Record<string, unknown> }> = [];
  let suspended = false;
  const mcp = createOpenMcp({
    file: join(dir, 'open-mcp.json'),
    request: async input => { requests.push({ path: input.path, body: input.body }); if (input.path === '/knowledge/search') return { status: 'matched', note: '', hits: [{ title: '价格', content: '298 元/30 天', source: '手册' }] }; if (input.path === '/knowledge') return { id: 'knowledge_1' }; return {}; },
    reception: () => ({ status: 'running', message: '', cycle: 3, jobs: [{ status: 'visually_confirmed', conversationName: 'A', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }], config: { receptionSuspended: suspended } }),
    pauseReception: async () => undefined,
    suspendReception: async value => { suspended = value; },
  });
  t.after(async () => { await mcp.close(); await rm(dir, { recursive: true, force: true }); });
  await mcp.init();
  await mcp.save({ enabled: true, port: 18811 });
  const s = mcp.state(); assert.equal(s.listening, true); assert.ok(s.token.length > 20);
  const call = async (body: unknown, auth = true) => { const r = await fetch(s.url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${s.token}` } : {}) }, body: JSON.stringify(body) }); return { status: r.status, json: r.status === 200 ? await r.json() : undefined }; };
  assert.equal((await call({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, false)).status, 401);
  const init = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '0' } } });
  assert.equal(init.json.result.serverInfo.name, 'kadadesk');
  const list = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.deepEqual(list.json.result.tools.map((x: { name: string }) => x.name), ['knowledge_search', 'knowledge_answer', 'reception_status', 'reception_control', 'knowledge_add']);
  const search = await call({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'knowledge_search', arguments: { query: '价格' } } });
  assert.match(search.json.result.content[0].text, /298/);
  const status = await call({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'reception_status', arguments: {} } });
  assert.equal(JSON.parse(status.json.result.content[0].text).today.replied, 1);
  await call({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'reception_control', arguments: { action: 'pause' } } });
  assert.equal(suspended, true);
  const add = await call({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'knowledge_add', arguments: { title: '发货', content: '3 天内发货' } } });
  assert.match(add.json.result.content[0].text, /pending_review/);
  assert.equal(requests.at(-1)?.path, '/knowledge'); assert.ok((requests.at(-1)?.body?.tags as string[]).includes('来源:MCP'));
  const unknown = await call({ jsonrpc: '2.0', id: 7, method: 'nope' });
  assert.equal(unknown.json.error.code, -32601);
  await mcp.save({ enabled: false }); assert.equal(mcp.state().listening, false);
});

test('恢复接待只解除暂停、从不启动接待：急停、人工暂停、需人工处理都不会被推翻', async t => {
  for (const status of ['paused', 'stopped', 'needs_attention']) {
    const x = await receptionHarness(t, { status, suspended: true });
    const { isError, body } = await x.control('resume');
    assert.equal(isError, false); assert.equal(x.reception.suspended, false); assert.equal(x.reception.status, status);
    assert.equal(body.running, false); assert.match(body.note, /不会替你启动接待/);
  }
});

test('接待正在运行时，恢复只解除暂停并如实报告；暂停在未运行时也会记住', async t => {
  const running = await receptionHarness(t, { status: 'running', suspended: true });
  const resumed = await running.control('resume');
  assert.equal(running.reception.suspended, false); assert.equal(resumed.body.running, true); assert.match(resumed.body.note, /已解除暂停/);
  const idle = await receptionHarness(t, { status: 'paused', suspended: false });
  const paused = await idle.control('pause');
  assert.equal(idle.reception.suspended, true); assert.equal(paused.body.running, false); assert.match(paused.body.note, /resume/);
});

test('协议：非对象消息与批量里的坏元素各自返回 -32600，不丢掉有效请求', async t => {
  const x = await receptionHarness(t, { status: 'paused', suspended: false });
  const scalar = await x.post('42');
  assert.equal(scalar.status, 200); assert.equal(scalar.json.id, null); assert.equal(scalar.json.error.code, -32600);
  const batch = await x.post(JSON.stringify([{ jsonrpc: '2.0', id: 5, method: 'tools/list' }, null]));
  assert.equal(batch.status, 200); assert.equal(batch.json.length, 2);
  assert.equal(batch.json.find((m: { id: unknown }) => m.id === 5).result.tools.length, 5);
  assert.equal(batch.json.find((m: { error?: unknown }) => m.error).error.code, -32600);
});

test('保存密钥的配置文件仅本人可读写（已有的宽权限文件也会收紧）', { skip: process.platform === 'win32' }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'kada-mcp-mode-'));
  const file = join(dir, 'open-mcp.json');
  await writeFile(file, JSON.stringify({ enabled: false, port: 18811, token: 'synthetic-token-value' }), { mode: 0o644 });
  const mcp = createOpenMcp({ file, request: async () => ({}), reception: () => undefined, pauseReception: async () => undefined, suspendReception: async () => undefined });
  t.after(async () => { await mcp.close(); await rm(dir, { recursive: true, force: true }); });
  await mcp.init();
  assert.equal((await stat(file)).mode & 0o777, 0o600);
});

type Job = { status: string; conversationName: string; createdAt: string; updatedAt: string; input?: string };
async function openHarness(t: TestContext, options: { jobs?: Job[]; answerLimit?: { max: number; windowMs: number }; file?: string } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'kada-mcp-open-'));
  const file = options.file ?? join(dir, 'open-mcp.json');
  const make = () => createOpenMcp({
    file,
    request: async input => input.path === '/copilot/reply' ? { baseReply: '合成草稿', knowledgeSources: [], intent: { kind: 'business' } } : input.path === '/knowledge/search' ? { status: 'matched', note: '', hits: [] } : {},
    reception: () => ({ status: 'running', message: '', cycle: 1, jobs: options.jobs ?? [], config: { receptionSuspended: false } }),
    pauseReception: async () => undefined,
    suspendReception: async () => undefined,
    ...(options.answerLimit ? { answerLimit: options.answerLimit } : {}),
  });
  const mcp = make();
  t.after(async () => { await mcp.close(); await rm(dir, { recursive: true, force: true }); });
  await mcp.init();
  const s = await mcp.save({ enabled: true, port: await freePort() });
  const rpc = async (method: string, params: Record<string, unknown> = {}) => { const r = await fetch(s.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }); return (await r.json()).result; };
  const call = (name: string, args: Record<string, unknown> = {}) => rpc('tools/call', { name, arguments: args }) as Promise<{ isError?: boolean; content: Array<{ text: string }> }>;
  return { mcp, make, rpc, call, file };
}

test('工具列表带只读 / 写入标注，客户端可据此决定是否需要审批', async t => {
  const x = await openHarness(t);
  const tools = (await x.rpc('tools/list')).tools as Array<{ name: string; annotations?: Record<string, boolean> }>;
  const hint = (name: string) => tools.find(tool => tool.name === name)?.annotations ?? {};
  assert.equal(hint('knowledge_search').readOnlyHint, true);
  assert.equal(hint('reception_status').readOnlyHint, true);
  assert.equal(hint('knowledge_answer').readOnlyHint, true); assert.equal(hint('knowledge_answer').openWorldHint, true);
  // Pausing stops customer service and resuming re-enables automatic replies, so clients must ask before calling it.
  assert.equal(hint('reception_control').readOnlyHint, false); assert.equal(hint('reception_control').destructiveHint, true); assert.equal(hint('reception_control').openWorldHint, true);
  assert.equal(hint('knowledge_add').readOnlyHint, false); assert.equal(hint('knowledge_add').destructiveHint, false);
});

test('看状态默认不返回客户原文，只有显式要求时才附上', async t => {
  const now = new Date().toISOString();
  const x = await openHarness(t, { jobs: [{ status: 'handoff', conversationName: '合成客户', createdAt: now, updatedAt: now, input: '合成原文：我想退款' }] });
  const plain = JSON.parse((await x.call('reception_status')).content[0].text);
  assert.equal(plain.open.length, 1); assert.equal(plain.open[0].conversation, '合成客户'); assert.ok(!('customer' in plain.open[0]));
  assert.ok(!JSON.stringify(plain).includes('退款'));
  const detailed = JSON.parse((await x.call('reception_status', { includeCustomerText: true })).content[0].text);
  assert.match(detailed.open[0].customer, /退款/);
});

test('「开放」页可以单独关闭工具：关闭后不在工具列表里，调用被拒绝，重启后仍然关闭', async t => {
  const x = await openHarness(t);
  await assert.rejects(x.mcp.save({ disabledTools: ['no_such_tool'] }), /未知工具/);
  const saved = await x.mcp.save({ disabledTools: ['reception_control', 'knowledge_answer'] });
  assert.deepEqual(saved.disabledTools, ['reception_control', 'knowledge_answer']);
  const names = ((await x.rpc('tools/list')).tools as Array<{ name: string }>).map(tool => tool.name);
  assert.deepEqual(names, ['knowledge_search', 'reception_status', 'knowledge_add']);
  const refused = await x.call('reception_control', { action: 'pause' });
  assert.equal(refused.isError, true); assert.match(refused.content[0].text, /已在咔哒「开放」页关闭/);
  await x.mcp.close();
  const reopened = x.make(); t.after(() => reopened.close()); await reopened.init();
  assert.deepEqual(reopened.state().disabledTools, ['reception_control', 'knowledge_answer']);
});

test('回复草稿有调用频率上限，超出后如实拒绝', async t => {
  const x = await openHarness(t, { answerLimit: { max: 2, windowMs: 60_000 } });
  for (let i = 0; i < 2; i++) assert.equal((await x.call('knowledge_answer', { text: '合成问题' })).isError ?? false, false);
  const third = await x.call('knowledge_answer', { text: '合成问题' });
  assert.equal(third.isError, true); assert.match(third.content[0].text, /太频繁/);
});

// The reply check (approval-bubble.ts) passes; its failures are tested separately.
const verified = async () => ({ verified: true, reason: '' });
type McpState = Awaited<ReturnType<ReturnType<typeof createOpenMcp>['save']>>;
async function appHarness(t: TestContext, options: { withTasks?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'kada-mcp-app-'));
  const notices: string[] = [];
  let mcp!: ReturnType<typeof createOpenMcp>;
  const tasks = createAppTasks({
    file: join(dir, 'app-tasks.json'), allowedApps: { synthetic: { label: '合成演练', remote: true } },
    notifyAdmin: (_kind: any, text: any) => { notices.push(text); return 'full'; },
    callerAllowed: (key: any) => mcp.state().clients.some(client => client.id === key && client.appTasks),
    authenticate: async () => true,
    run: async (task: any) => ({ status: 'completed', steps: [{ kind: 'synthetic', outcome: 'skipped' }], result: `合成：${task.instruction}` }),
    authenticator: { ready: () => true, paused: () => false, check: (code: any) => code === '246810' ? 'ok' : 'wrong', spend: () => undefined },
  });
  await tasks.init();
  mcp = createOpenMcp({
    file: join(dir, 'open-mcp.json'), request: async () => ({}), reception: () => undefined,
    pauseReception: async () => undefined, suspendReception: async () => undefined,
    ...(options.withTasks === false ? {} : { appTasks: { apps: () => ({ synthetic: '合成演练' }), request: tasks.request, status: tasks.status, cancel: tasks.cancel, revoke: tasks.revoke, revokeCaller: tasks.revokeCaller, forgetCaller: tasks.forgetCaller } }),
  });
  t.after(async () => { await mcp.close(); await tasks.cancelAll('测试结束', { quiet: true }); await tasks.whenIdle(); await rm(dir, { recursive: true, force: true }); });
  await mcp.init();
  let s: McpState = await mcp.save({ enabled: true, port: await freePort() });
  let hermes = '';
  const keyOf = (id: string) => id === 'default' ? s.token : mcp.clientKey(id);
  const post = async (key: string, method: string, params: Record<string, unknown> = {}) => fetch(s.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const call = async (method: string, params: Record<string, unknown> = {}, as = hermes) => (await (await post(keyOf(as), method, params)).json() as { result: Record<string, unknown> }).result;
  const names = async (as = hermes) => ((await call('tools/list', {}, as)).tools as Array<{ name: string }>).map(tool => tool.name);
  const tool = async (name: string, args: Record<string, unknown>, as = hermes) => {
    const result = await call('tools/call', { name, arguments: args }, as) as { isError?: boolean; content: Array<{ text: string }> };
    return { isError: result.isError ?? false, text: result.content[0].text };
  };
  const refresh = (next: McpState) => { s = next; return s; };
  const add = async (label: string, toolId?: string, allowed = true) => { refresh(await mcp.addClient({ label, tool: toolId })); const id = s.clients.at(-1)!.id; if (allowed) refresh(await mcp.setClientAppTasks(id, true)); return id; };
  const enable = async (value: boolean) => refresh(await mcp.save({ appTasks: value }));
  hermes = await add('Hermes', 'hermes');
  const request = async (as: string, requestId: string) => JSON.parse((await tool('app_task_request', { requestId, app: 'synthetic', instruction: '演练' }, as)).text) as { taskId: string; no: number };
  const statusOf = (taskId: string) => tasks.list().find(item => item.taskId === taskId)?.status;
  return { mcp, tasks, notices, post, call, names, tool, enable, add, refresh, keyOf, hermes, request, statusOf, dir, state: () => s };
}

test('应用操作工具默认隐藏且拒绝调用；开启后才出现', async t => {
  const h = await appHarness(t);
  assert.equal((await h.names()).some(name => name.startsWith('app_task_')), false);
  const refused = await h.tool('app_task_request', { requestId: 'a', app: 'synthetic', instruction: '测试' });
  assert.equal(refused.isError, true); assert.match(refused.text, /应用操作没有在咔哒「开放」页开启/);
  assert.equal((await h.enable(true)).appTasks, true);
  const tools = (await h.call('tools/list')).tools as Array<{ name: string; annotations: Record<string, boolean>; inputSchema: { properties: { app?: { enum: string[] } } } }>;
  const byName = new Map(tools.map(tool => [tool.name, tool]));
  assert.deepEqual(byName.get('app_task_request')?.annotations, { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true });
  assert.deepEqual(byName.get('app_task_request')?.inputSchema.properties.app?.enum, ['synthetic']);
  assert.equal(byName.get('app_task_status')?.annotations.readOnlyHint, true);
  assert.deepEqual(byName.get('app_task_cancel')?.annotations, { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  await assert.rejects(h.mcp.save({ appTasks: 'yes' as unknown as boolean }), /应用操作开关无效/);
});

test('没有任务模块时即使开关打开也不出现应用操作工具', async t => {
  const h = await appHarness(t, { withTasks: false });
  await h.enable(true);
  assert.equal((await h.names()).some(name => name.startsWith('app_task_')), false);
});

test('每个客户端用自己的密钥连接；默认密钥照常可用并计数；未知或已删除的密钥被拒绝；页面状态里没有密钥', async t => {
  const h = await appHarness(t);
  assert.match(h.hermes, /^hermes-[0-9a-f]{4}$/);
  assert.equal((await h.post(h.keyOf(h.hermes), 'tools/list')).status, 200);
  await h.tool('knowledge_search', { query: '价格' }, 'default');
  assert.equal(h.mcp.state().defaultCalls, 1); assert.ok(h.mcp.state().defaultLastCallAt);
  assert.equal((await h.post('x'.repeat(32), 'tools/list')).status, 401);
  const old = h.keyOf(h.hermes);
  assert.ok(!JSON.stringify(h.mcp.state()).includes(old)); assert.equal(h.mcp.state().clients[0].keyHint, old.slice(-4));
  h.refresh(await h.mcp.removeClient(h.hermes));
  assert.equal((await h.post(old, 'tools/list')).status, 401);
  await assert.rejects(h.mcp.removeClient(h.hermes), /客户端不存在/);
});

test('默认密钥永远不能提交应用任务；只有勾选了权限的客户端才能看到和调用应用工具', async t => {
  const h = await appHarness(t);
  await h.enable(true);
  assert.equal((await h.names('default')).some(name => name.startsWith('app_task_')), false);
  assert.match((await h.tool('app_task_request', { requestId: 'a', app: 'synthetic', instruction: '测试' }, 'default')).text, /默认密钥不能提交应用任务/);
  const codex = await h.add('Codex', 'codex', false);
  assert.equal((await h.names(codex)).some(name => name.startsWith('app_task_')), false);
  assert.match((await h.tool('app_task_request', { requestId: 'a', app: 'synthetic', instruction: '测试' }, codex)).text, /「Codex」没有应用操作权限/);
  h.refresh(await h.mcp.setClientAppTasks(codex, true));
  assert.ok((await h.names(codex)).includes('app_task_request'));
  assert.equal((await h.tool('app_task_request', { requestId: 'a', app: 'synthetic', instruction: '测试' }, codex)).isError, false);
});

test('应用任务经 MCP 排队、查询、取消；批准消息写明是哪个客户端，里面没有任何验证码', async t => {
  const h = await appHarness(t);
  await h.enable(true);
  const queued = await h.tool('app_task_request', { requestId: 'a', app: 'synthetic', instruction: '新建一条备忘：十点开会', maxSteps: 3 });
  assert.equal(queued.isError, false);
  const task = JSON.parse(queued.text) as { taskId: string; status: string; note: string; label: string };
  assert.equal(task.status, 'queued'); assert.equal(task.label, 'Hermes'); assert.match(task.note, /等待主人批准/);
  assert.match(h.notices[0], /^「Hermes」请求在「合成演练」执行任务 1/); assert.match(h.notices[0], /「允许 1」加验证器上的 6 位数/);
  assert.ok(!/\d{4,}/.test(h.notices[0])); assert.ok(!/\d{4,}/.test(task.note));
  const status = JSON.parse((await h.tool('app_task_status', { taskId: task.taskId })).text) as { status: string };
  assert.equal(status.status, 'queued');
  const cancelled = JSON.parse((await h.tool('app_task_cancel', { taskId: task.taskId })).text) as { status: string };
  assert.equal(cancelled.status, 'cancelled');
  const invalid = await h.tool('app_task_request', { requestId: 'b', app: 'terminal', instruction: '测试' });
  assert.equal(invalid.isError, true); assert.match(invalid.text, /不在允许列表/);
});

test('任务按客户端隔离：别的客户端查不到也取消不了', async t => {
  const h = await appHarness(t);
  await h.enable(true);
  const codex = await h.add('Codex', 'codex');
  const task = await h.request(h.hermes, 'a');
  assert.match((await h.tool('app_task_status', { taskId: task.taskId }, codex)).text, /任务不存在/);
  assert.match((await h.tool('app_task_cancel', { taskId: task.taskId }, codex)).text, /任务不存在/);
  assert.equal(h.statusOf(task.taskId), 'queued');
});

test('批准后的结果通过 app_task_status 返回给提交它的客户端', async t => {
  const h = await appHarness(t);
  await h.enable(true);
  const task = await h.request(h.hermes, 'a');
  assert.match((await h.tasks.handleAdminText('允许 1 246810', verified))!, /已批准/);
  await h.tasks.whenIdle();
  const done = JSON.parse((await h.tool('app_task_status', { taskId: task.taskId })).text) as { status: string; result: string; approvedVia: string };
  assert.equal(done.status, 'completed'); assert.equal(done.result, '合成：演练'); assert.equal(done.approvedVia, 'remote');
});

test('换密钥、收回权限、删除客户端都只撤销它自己的任务；更换默认密钥不影响任何任务', async t => {
  const h = await appHarness(t);
  await h.enable(true);
  const codex = await h.add('Codex', 'codex');
  let mine = await h.request(h.hermes, 'a');
  let theirs = await h.request(codex, 'b');
  h.refresh(await h.mcp.save({ regenerateToken: true }));
  assert.deepEqual([h.statusOf(mine.taskId), h.statusOf(theirs.taskId)], ['queued', 'queued']);
  const old = h.keyOf(h.hermes);
  h.refresh(await h.mcp.regenerateClientKey(h.hermes));
  assert.deepEqual([h.statusOf(mine.taskId), h.statusOf(theirs.taskId)], ['cancelled', 'queued']);
  assert.equal((await h.post(old, 'tools/list')).status, 401);
  mine = await h.request(h.hermes, 'c');
  h.refresh(await h.mcp.setClientAppTasks(codex, false));
  assert.deepEqual([h.statusOf(mine.taskId), h.statusOf(theirs.taskId)], ['queued', 'cancelled']);
  h.refresh(await h.mcp.setClientAppTasks(codex, true));
  theirs = await h.request(codex, 'd');
  h.refresh(await h.mcp.removeClient(h.hermes));
  assert.deepEqual([h.statusOf(mine.taskId), h.statusOf(theirs.taskId)], ['cancelled', 'queued']);
});

test('关闭应用操作或关闭开放服务会撤销所有客户端的任务', async t => {
  for (const change of [{ appTasks: false }, { enabled: false }]) {
    const h = await appHarness(t);
    await h.enable(true);
    const codex = await h.add('Codex', 'codex');
    const tasks = [await h.request(h.hermes, 'a'), await h.request(codex, 'b')];
    await h.mcp.save(change);
    assert.deepEqual(tasks.map(task => h.statusOf(task.taskId)), ['cancelled', 'cancelled'], JSON.stringify(change));
    assert.match((await h.tasks.handleAdminText('允许 1 246810', verified))!, /没有待批准的任务 1/);
  }
});

test('客户端名称、重名和数量受限；客户端单独存放，旧版改写开放设置也不会丢；重新加载后保留', async t => {
  const h = await appHarness(t);
  await h.enable(true);
  await assert.rejects(h.mcp.addClient({ label: '' }), /名称/);
  await assert.rejects(h.mcp.addClient({ label: '【咔哒】' }), /括号/);
  await assert.rejects(h.mcp.addClient({ label: ' hermes ' }), /已有名为「hermes」的客户端/);
  await assert.rejects(h.mcp.setClientAppTasks('nobody', true), /客户端不存在/);
  for (let i = h.state().clients.length; i < 20; i++) h.refresh(await h.mcp.addClient({ label: `工具${i}` }));
  await assert.rejects(h.mcp.addClient({ label: '多余' }), /最多 20 个/);
  const settings = JSON.parse(await readFile(join(h.dir, 'open-mcp.json'), 'utf8')) as Record<string, unknown>;
  assert.equal(settings.appTasks, true); assert.equal('clients' in settings, false);
  const stored = JSON.parse(await readFile(join(h.dir, 'open-mcp-clients.json'), 'utf8')) as { clients: Array<{ id: string }> };
  assert.equal(stored.clients.length, 20);
  assert.equal((await stat(join(h.dir, 'open-mcp-clients.json'))).mode & 0o777, process.platform === 'win32' ? (await stat(join(h.dir, 'open-mcp-clients.json'))).mode & 0o777 : 0o600);
  const hermesKey = h.keyOf(h.hermes);
  await h.mcp.close();
  // An older kadadesk rewrites open-mcp.json with only the fields it knows.
  await writeFile(join(h.dir, 'open-mcp.json'), JSON.stringify({ enabled: true, port: h.state().port, token: h.state().token }));
  const reloaded = createOpenMcp({ file: join(h.dir, 'open-mcp.json'), request: async () => ({}), reception: () => undefined, pauseReception: async () => undefined, suspendReception: async () => undefined });
  t.after(() => reloaded.close());
  await reloaded.init();
  const state = reloaded.state();
  assert.equal(state.clients.length, 20);
  assert.deepEqual([state.clients[0].id, state.clients[0].appTasks], [h.hermes, true]);
  assert.equal(reloaded.clientKey(h.hermes), hermesKey);
});

test('写盘失败时仍会撤销：旧密钥立刻失效、任务被取消，并把失败报给主人', { skip: process.platform === 'win32' }, async t => {
  const h = await appHarness(t);
  await h.enable(true);
  const task = await h.request(h.hermes, 'a');
  const old = h.keyOf(h.hermes);
  await rm(join(h.dir, 'open-mcp-clients.json')); await mkdir(join(h.dir, 'open-mcp-clients.json', 'blocker'), { recursive: true });
  await assert.rejects(h.mcp.regenerateClientKey(h.hermes));
  assert.equal(h.statusOf(task.taskId), 'cancelled');
  assert.equal((await h.post(old, 'tools/list')).status, 401);
});

test('带网页来源（Origin）的请求被拒绝；本机来源和不带 Origin 的照常', async t => {
  const h = await appHarness(t);
  const send = (origin?: string) => new Promise<number>((resolve, reject) => {
    const target = new URL(h.state().url);
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' });
    const req = httpRequest({ host: target.hostname, port: target.port, path: target.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Authorization: `Bearer ${h.keyOf(h.hermes)}`, ...(origin ? { Origin: origin } : {}) } }, res => { res.resume(); resolve(res.statusCode ?? 0); });
    req.on('error', reject); req.end(body);
  });
  assert.equal(await send('http://evil.example'), 403);
  assert.equal(await send('null'), 403);
  assert.equal(await send('http://localhost.evil.example'), 403);
  assert.equal(await send('http://127.0.0.1:3000'), 200);
  assert.equal(await send('http://localhost'), 200);
  assert.equal(await send(), 200);
});

test('换密钥或删除客户端时，还没传完的旧密钥请求一律拒绝，不会排上任务', async t => {
  for (const revoke of ['regenerate', 'remove'] as const) {
    const h = await appHarness(t);
    await h.enable(true);
    const target = new URL(h.state().url);
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'app_task_request', arguments: { requestId: 'late', app: 'synthetic', instruction: '旧密钥提交' } } });
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest({ host: target.hostname, port: target.port, path: target.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Authorization: `Bearer ${h.keyOf(h.hermes)}` } }, res => { res.resume(); resolve(res.statusCode ?? 0); });
      req.on('error', reject);
      req.write(body.slice(0, 10));
      setTimeout(() => { void (revoke === 'regenerate' ? h.mcp.regenerateClientKey(h.hermes) : h.mcp.removeClient(h.hermes)).then(() => req.end(body.slice(10)), reject); }, 100);
    });
    assert.equal(status, 401, revoke);
    assert.equal(h.tasks.list().length, 0, revoke);
  }
});
