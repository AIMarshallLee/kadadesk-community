import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelSetup, describeConfig, exportModelConfig, parseModelConfig, registerModelSetup } from './model-config-import';
type VisionSettings = any;

const SECRET = 'unit-import-secret-123';
test('config import accepts the new format, the older preset format, pasted text and base64 share strings', () => {
  const file = { kadadesk: 'model-config', version: 1, provider: 'qwen-cn', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', visionModel: 'qwen3-vl-plus', textModel: 'qwen-plus', apiKey: SECRET };
  const c = parseModelConfig(JSON.stringify(file));
  assert.equal(c.provider.id, 'qwen-cn'); assert.equal(c.visionModel, 'qwen3-vl-plus'); assert.equal(c.apiKey, SECRET);
  assert.doesNotMatch(JSON.stringify(describeConfig(c)), new RegExp(SECRET), 'what the card sees never has the key');
  assert.equal(parseModelConfig('服务人员发来的配置：\n' + JSON.stringify(file) + '\n谢谢').textModel, 'qwen-plus');
  assert.equal(parseModelConfig('kadadesk-model:' + Buffer.from(JSON.stringify(file)).toString('base64url')).provider.id, 'qwen-cn');
  const legacy = parseModelConfig(JSON.stringify({ kadadeskPreset: 1, name: '店里的模型', baseUrl: 'https://aihub-admin.aimix.pro/api-platform/v1', model: 'gemini-3.5-flash', apiKey: SECRET }));
  assert.equal(legacy.provider.id, 'pixmind'); assert.equal(legacy.visionModel, 'gemini-3.5-flash'); assert.equal(legacy.name, '店里的模型');
  assert.equal(parseModelConfig(JSON.stringify({ kadadeskPreset: 1, baseUrl: 'http://127.0.0.1:11434/v1', model: 'm' })).provider.id, 'ollama-local');
  assert.equal(parseModelConfig(JSON.stringify({ ...file, provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1' })).visionModel, '', 'text-only provider never gets a vision model');
  assert.equal(parseModelConfig(JSON.stringify({ ...file, provider: 'not-known', baseUrl: 'https://relay.example/v1' })).provider.id, 'custom');
});

test('config import rejects remote plain HTTP, credentials or query in the URL, operation paths and junk', () => {
  const base = { kadadesk: 'model-config', version: 1, provider: 'custom', visionModel: 'v', textModel: 't' };
  for (const baseUrl of ['http://relay.example/v1', 'https://user:pw@relay.example/v1', 'https://relay.example/v1?key=x', 'https://relay.example/v1/chat/completions', 'ftp://relay.example'])
    assert.throws(() => parseModelConfig(JSON.stringify({ ...base, baseUrl })), Error, baseUrl);
  assert.equal(parseModelConfig(JSON.stringify({ ...base, baseUrl: 'http://localhost:11434/v1' })).baseUrl, 'http://localhost:11434/v1');
  for (const junk of ['', 'hello', '[1,2]', JSON.stringify({ kadadesk: 'model-config', version: 2, provider: 'qwen-cn' }), JSON.stringify({ kadadeskPreset: 1, baseUrl: 'https://a.example/v1' }), 'x'.repeat(20001)])
    assert.throws(() => parseModelConfig(junk));
  try { parseModelConfig(JSON.stringify({ ...base, baseUrl: 'http://relay.example/v1', apiKey: SECRET })); } catch (e) { assert.doesNotMatch((e as Error).message, new RegExp(SECRET)); }
});

/** chat: how the tiny reply-model check answers (a status, or a JSON error body with a status). vision: the picture test. */
function fixture(models?: string[] | number, opts: { chat?: number | { status: number; body: unknown }; vision?: 'pass' | 'fail' } = {}) {
  const calls: any[] = []; const auth: string[] = [];
  const vision: VisionSettings = { activeId: 'qwen-cn', profiles: [{ id: 'qwen-cn', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3-vl-plus', hasKey: true }] };
  const setup = createModelSetup({
    fetch: async (url, init) => {
      auth.push(String((init?.headers as Record<string, string>)?.Authorization ?? ''));
      if (url.endsWith('/chat/completions')) {
        calls.push({ chat: JSON.parse(String(init?.body)).model });
        const c = opts.chat; if (c === undefined) return Response.json({ choices: [{ message: { content: '好' } }] });
        return typeof c === 'number' ? new Response('', { status: c }) : Response.json(c.body, { status: c.status });
      }
      calls.push({ list: url }); return typeof models === 'number' ? new Response('no', { status: models }) : models ? new Response(JSON.stringify({ data: models.map(id => ({ id })) })) : new Response('{}', { status: 404 });
    },
    visionSettings: async () => vision, textProvider: async () => ({ baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', temperature: 0.4, hasKey: true }),
    saveVision: async input => { calls.push({ vision: input }); }, saveText: async input => { calls.push({ text: input }); }, guard: async fn => fn(),
    ...(opts.vision ? { testVision: async (c: { model: string }) => { calls.push({ visionTest: c.model }); if (opts.vision === 'fail') throw new Error('图片测试未通过：模型名称或接口地址不对（HTTP 404）'); return { durationMs: 1200 }; } } : {}),
  });
  return { setup, calls, auth };
}

test('one-click setup lists models with the pasted key, picks both models, saves both, and never returns the key', async () => {
  const { setup, calls, auth } = fixture(['qwen-max', 'qwen3-vl-plus', 'qwen-plus', 'text-embedding-v4']);
  const r = await setup.setup({ provider: 'qwen-cn', apiKey: SECRET });
  assert.equal(r.ok, true); assert.equal(r.visionModel, 'qwen3-vl-plus'); assert.equal(r.textModel, 'qwen-plus'); assert.equal(r.listed, 4);
  assert.doesNotMatch(JSON.stringify(r), new RegExp(SECRET));
  assert.deepEqual(auth, [`Bearer ${SECRET}`, `Bearer ${SECRET}`], 'model list, then one tiny reply-model check');
  assert.deepEqual(calls.filter(c => c.chat).map(c => c.chat), ['qwen-plus']);
  assert.match(r.message, /都试过|试过/);
  assert.deepEqual(calls.find(c => c.vision).vision, { id: 'qwen-cn', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3-vl-plus', apiKey: SECRET });
  assert.deepEqual(calls.find(c => c.text).text, { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', temperature: 0.4, apiKey: SECRET });
});

test('one-click setup asks for a key, a model name, or reports a rejected key in plain words', async () => {
  assert.equal((await fixture([]).setup.setup({ provider: 'openai' })).needsKey, true);
  assert.equal((await fixture(401).setup.setup({ provider: 'openai', apiKey: SECRET })).needsKey, true);
  const none = fixture(['dall-e-3']); const r = await none.setup.setup({ provider: 'xai', apiKey: SECRET });
  assert.equal(r.needsModel, true); assert.equal(none.calls.some(c => c.vision || c.text), false, 'nothing saved');
  const named = fixture(); const n = await named.setup.setup({ provider: 'doubao-cn', apiKey: SECRET, visionModel: 'my-vision', textModel: 'my-text' });
  assert.equal(n.ok, true); assert.equal(named.calls.some(c => c.list), false, 'explicit names skip listing');
  const ds = fixture(['deepseek-chat']); const d = await ds.setup.setup({ provider: 'deepseek', apiKey: SECRET });
  assert.equal(d.visionSaved, false); assert.equal(d.textModel, 'deepseek-chat'); assert.equal(ds.calls.some(c => c.vision), false);
  const local = fixture(['llava:7b', 'qwen2.5:7b']); const l = await local.setup.setup({ provider: 'ollama-local' });
  assert.equal(l.ok, true); assert.equal(l.visionModel, 'llava:7b'); assert.equal(local.calls.find(c => c.text).text.apiKey, undefined, 'keyless local service');
  await assert.rejects(fixture().setup.setup({ provider: 'custom', apiKey: SECRET, baseUrl: 'http://relay.example/v1' }));
  await assert.rejects(fixture().setup.setup({ provider: 'nope' }));
});

test('import without a key asks for one, then saves; export never contains a key', async () => {
  const f = fixture(['glm-4.6v-flash', 'glm-4.7-flash']);
  const text = JSON.stringify({ kadadesk: 'model-config', version: 1, provider: 'zhipu-cn', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', visionModel: 'glm-4.6v-flash', textModel: 'glm-4.7-flash' });
  assert.equal((await f.setup.importConfig(text)).needsKey, true);
  const r = await f.setup.importConfig(text, SECRET); assert.equal(r.ok, true); assert.doesNotMatch(JSON.stringify(r), new RegExp(SECRET));
  const out = await f.setup.exportConfig();
  assert.deepEqual(out, { kadadesk: 'model-config', version: 1, provider: 'qwen-cn', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', visionModel: 'qwen3-vl-plus', textModel: 'deepseek-chat', textProvider: 'deepseek', textBaseUrl: 'https://api.deepseek.com/v1' });
  assert.equal(parseModelConfig(JSON.stringify(out)).text?.provider.id, 'deepseek', 'an export imports back');
  assert.throws(() => exportModelConfig({ activeId: 'qwen-cn', profiles: [{ id: 'qwen-cn', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'm', hasKey: false }] }, { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', hasKey: false }), /没有可导出/);
});

test('IPC registration: login key goes straight into setup and is not returned', async () => {
  const handlers = new Map<string, (...a: unknown[]) => Promise<unknown>>(); const f = fixture(['google/gemini-3.5-flash']);
  registerModelSetup({ handle: (c, fn) => handlers.set(c, fn), setup: f.setup, login: async () => SECRET });
  assert.deepEqual([...handlers.keys()].sort(), ['flowdesk:model:export', 'flowdesk:model:import', 'flowdesk:model:login', 'flowdesk:model:setup']);
  const r = await handlers.get('flowdesk:model:login')!('openrouter'); assert.doesNotMatch(JSON.stringify(r), new RegExp(SECRET));
  assert.equal(f.calls.find(c => c.vision).vision.apiKey, SECRET);
  await assert.rejects(handlers.get('flowdesk:model:login')!('other'));
});

test('one-click setup tries the reply model before saving: a failing model never replaces a working setup', async () => {
  const cases: Array<[number | { status: number; body: unknown }, RegExp]> = [
    [{ status: 429, body: { error: { message: 'You exceeded your current quota', type: 'insufficient_quota', code: 'insufficient_quota' } } }, /余额不足/],
    [{ status: 401, body: { error: { message: 'Incorrect API key provided: sk-abcdef123456', code: 'invalid_api_key' } } }, /Key 不对/],
    [404, /模型名称或接口地址不对/],
  ];
  for (const [chat, advice] of cases) {
    const f = fixture(['qwen-max', 'qwen3-vl-plus', 'qwen-plus'], { chat });
    const r = await f.setup.setup({ provider: 'qwen-cn', apiKey: SECRET });
    assert.equal(r.ok, false); assert.equal(r.textSaved, false); assert.equal(r.visionSaved, false);
    assert.match(r.message, /没有保存/); assert.match(r.message, advice); assert.match(r.message, /原来的设置保持不变/);
    assert.equal(f.calls.some(c => c.vision || c.text), false, 'nothing saved');
    assert.doesNotMatch(JSON.stringify(r), new RegExp(SECRET)); assert.doesNotMatch(r.message, /sk-abcdef/);
  }
  const retry = fixture(['qwen-plus', 'qwen3-vl-plus'], { chat: 400 }); // a model refusing max_tokens is asked once more without it
  assert.equal((await retry.setup.setup({ provider: 'qwen-cn', apiKey: SECRET })).ok, false); assert.equal(retry.calls.filter(c => c.chat).length, 2);
});

test('one-click setup tests the picture before saving it and says plainly what still works', async () => {
  const good = fixture(['qwen3-vl-plus', 'qwen-plus'], { vision: 'pass' }); const ok = await good.setup.setup({ provider: 'qwen-cn', apiKey: SECRET });
  assert.equal(ok.ok, true); assert.equal(ok.visionSaved, true); assert.equal(ok.visionTestMs, 1200); assert.equal(ok.visionProblem, undefined);
  const bad = fixture(['qwen3-vl-plus', 'qwen-plus'], { vision: 'fail' }); const half = await bad.setup.setup({ provider: 'qwen-cn', apiKey: SECRET });
  assert.equal(half.visionSaved, false, 'the screen-reading model in use is kept'); assert.equal(half.textSaved, true);
  assert.match(half.visionProblem!, /模型名称或接口地址不对/); assert.match(half.message, /写回复已换成.*能用/); assert.match(half.message, /看屏幕继续用原来的模型/);
  assert.equal(bad.calls.some(c => c.vision), false); assert.equal(bad.calls.filter(c => c.text).length, 1);
  const visionOnly = fixture(undefined, { vision: 'fail' }); const v = await visionOnly.setup.setup({ provider: 'doubao-cn', apiKey: SECRET, visionModel: 'my-vision', textModel: '' });
  assert.equal(v.textSaved, true, 'no text model name: the (working) model also writes replies'); assert.equal(v.visionSaved, false);
});
