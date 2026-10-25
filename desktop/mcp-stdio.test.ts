import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createOpenMcp } from './open-mcp';
import { defaultDataDirectory, forwardOpenMcpLine } from './mcp-stdio';
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
    revoke: async (_reason: string) => {
      for (const t of tasksList) {
        if (t.status === 'queued') t.status = 'cancelled';
      }
    },
    revokeCaller: async (callerId: string, _reason: string) => {
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
          task.result = `合成：${task.instruction}`;
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
// The reply check (approval-bubble.ts) passes; its failures are tested separately.
const verified = async () => ({ verified: true, reason: '' });
const rpc = (id: number, method: string, params: Record<string, unknown> = {}) => JSON.stringify({ jsonrpc: '2.0', id, method, params });
const initialize = (id: number) => rpc(id, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'synthetic-client', version: '0' } });
const initialized = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' });

async function openServer(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'kada-open-stdio-'));
  const mcp = createOpenMcp({
    file: join(dir, 'open-mcp.json'),
    request: async input => input.path === '/knowledge/search' ? { status: 'matched', note: '', hits: [{ title: '合成价格', content: '合成条目 100 元', source: '合成手册' }] } : {},
    reception: () => undefined,
    pauseReception: async () => undefined, suspendReception: async () => undefined,
  });
  t.after(async () => { await mcp.close(); await rm(dir, { recursive: true, force: true }); });
  await mcp.init();
  await mcp.save({ enabled: true, port: await freePort() });
  return { dir, mcp };
}

test('MCP stdio 默认数据目录与 Electron userData 一致（Windows / macOS / Linux）', () => {
  assert.equal(defaultDataDirectory('win32', { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'C:\\Users\\a'), 'C:\\Users\\a\\AppData\\Roaming\\FlowDesk');
  assert.equal(defaultDataDirectory('win32', {}, 'C:\\Users\\a'), 'C:\\Users\\a\\AppData\\Roaming\\FlowDesk');
  assert.equal(defaultDataDirectory('darwin', {}, ['/', 'Users', '/'].join('') + 'a'), ['/', 'Users', '/'].join('') + 'a/Library/Application Support/FlowDesk');
  assert.equal(defaultDataDirectory('linux', { XDG_CONFIG_HOME: '/x' }, '/home/a'), '/x/FlowDesk');
  assert.equal(defaultDataDirectory('linux', {}, '/home/a'), '/home/a/.config/FlowDesk');
});

test('开放 stdio 桥：从本机配置读取密钥并原样转发 JSON-RPC；重新生成密钥后自动跟随', async t => {
  const { dir, mcp } = await openServer(t);
  const init = JSON.parse(await forwardOpenMcpLine(initialize(1), dir) as string);
  assert.equal(init.id, 1); assert.equal(init.result.serverInfo.name, 'kadadesk');
  assert.equal(await forwardOpenMcpLine(initialized, dir), null);
  const list = JSON.parse(await forwardOpenMcpLine(rpc(2, 'tools/list'), dir) as string);
  assert.equal(list.result.tools.length, 5);
  await mcp.save({ regenerateToken: true });
  const hit = JSON.parse(await forwardOpenMcpLine(rpc(3, 'tools/call', { name: 'knowledge_search', arguments: { query: '价格' } }), dir) as string);
  assert.equal(hit.id, 3); assert.match(hit.result.content[0].text, /合成条目/);
});

test('开放 stdio 桥 → 应用任务：经桥提交只排队，管理员通知批准后经桥取回结果（合成执行器，不调用模型）', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'kada-open-stdio-app-'));
  const notices: string[] = [];
  let mcp!: ReturnType<typeof createOpenMcp>;
  const tasks = createAppTasks({ file: join(dir, 'app-tasks.json'), allowedApps: { synthetic: { label: '合成演练', remote: true } }, callerAllowed: (key: any) => mcp.state().clients.some(client => client.id === key && client.appTasks), notifyAdmin: (_kind: any, text: any) => { notices.push(text); return 'full'; }, authenticate: async () => false, run: async (task: any) => ({ status: 'completed', steps: [{ kind: 'synthetic', outcome: 'skipped' }], result: `合成：${task.instruction}` }), authenticator: { ready: () => true, paused: () => false, check: (code: any) => code === '135790' ? 'ok' : 'wrong', spend: () => undefined } });
  await tasks.init();
  mcp = createOpenMcp({ file: join(dir, 'open-mcp.json'), request: async () => ({}), reception: () => undefined, pauseReception: async () => undefined, suspendReception: async () => undefined, appTasks: { apps: () => ({ synthetic: '合成演练' }), request: tasks.request, status: tasks.status, cancel: tasks.cancel, revoke: tasks.revoke, revokeCaller: tasks.revokeCaller } });
  t.after(async () => { await mcp.close(); await tasks.cancelAll('测试结束'); await tasks.whenIdle(); await rm(dir, { recursive: true, force: true }); });
  await mcp.init(); await mcp.save({ enabled: true, port: await freePort(), appTasks: true });
  const hermes = (await mcp.addClient({ label: 'Hermes', tool: 'hermes' })).clients[0].id; await mcp.setClientAppTasks(hermes, true);
  const call = async (id: number, name: string, args: Record<string, unknown>) => JSON.parse(JSON.parse(await forwardOpenMcpLine(rpc(id, 'tools/call', { name, arguments: args }), dir, hermes) as string).result.content[0].text);
  const queued = await call(1, 'app_task_request', { requestId: 'voice-1', app: 'synthetic', instruction: '演练：新建备忘' });
  assert.equal(queued.status, 'queued');
  assert.match(notices[0], /「允许 1」加验证器上的 6 位数/); assert.ok(!notices[0].includes('135790'));
  assert.match((await tasks.handleAdminText('允许 1 135790', verified))!, /已批准/);
  await tasks.whenIdle();
  const done = await call(2, 'app_task_status', { taskId: queued.taskId });
  assert.equal(done.status, 'completed'); assert.equal(done.approvedVia, 'remote'); assert.equal(done.result, '合成：演练：新建备忘');
  assert.equal(done.label, 'Hermes');
});

test('开放 stdio 桥按 --client 使用该客户端自己的密钥，换密钥后自动跟随；未知客户端返回明确错误', async t => {
  const { dir, mcp } = await openServer(t);
  const hermes = (await mcp.addClient({ label: 'Hermes', tool: 'hermes' })).clients[0].id;
  const search = (id: number, client?: string) => forwardOpenMcpLine(rpc(id, 'tools/call', { name: 'knowledge_search', arguments: { query: '价格' } }), dir, client);
  assert.match(JSON.parse(await search(1, hermes) as string).result.content[0].text, /合成条目/);
  assert.equal(mcp.state().clients[0].calls, 1);
  await mcp.regenerateClientKey(hermes);
  assert.match(JSON.parse(await search(2, hermes) as string).result.content[0].text, /合成条目/);
  assert.equal(mcp.state().clients[0].calls, 2);
  await search(3);
  assert.equal(mcp.state().clients[0].calls, 2);
  const unknown = JSON.parse(await search(4, 'nobody') as string);
  assert.equal(unknown.id, 4); assert.match(unknown.error.message, /没有名为「nobody」的客户端/);
});

test('开放 stdio 桥：未开启、连不上、密钥不符、坏 JSON 都按请求 id 返回明确错误，不伪造结果', async t => {
  const { dir, mcp } = await openServer(t);
  const file = join(dir, 'open-mcp.json');
  const settings = JSON.parse(await readFile(file, 'utf8'));
  await writeFile(file, JSON.stringify({ ...settings, token: 'not-the-running-token' }));
  const mismatch = JSON.parse(await forwardOpenMcpLine(rpc(7, 'tools/list'), dir) as string);
  assert.equal(mismatch.id, 7); assert.match(mismatch.error.message, /密钥/);
  await writeFile(file, JSON.stringify(settings));
  await mcp.close();
  const unreachable = JSON.parse(await forwardOpenMcpLine(rpc(8, 'tools/list'), dir) as string);
  assert.equal(unreachable.id, 8); assert.match(unreachable.error.message, /无法连接/);
  await mcp.save({ enabled: false });
  const disabled = JSON.parse(await forwardOpenMcpLine(rpc(9, 'tools/list'), dir) as string);
  assert.equal(disabled.id, 9); assert.match(disabled.error.message, /未开启/);
  await mkdir(join(dir, 'empty'));
  const noSettings = JSON.parse(await forwardOpenMcpLine(rpc(10, 'tools/list'), join(dir, 'empty')) as string);
  assert.equal(noSettings.id, 10); assert.match(noSettings.error.message, /未开启/);
  const noDirectory = JSON.parse(await forwardOpenMcpLine(rpc(11, 'tools/list'), join(dir, 'absent')) as string);
  assert.equal(noDirectory.id, 11); assert.match(noDirectory.error.message, /数据目录/);
  await writeFile(file, JSON.stringify({ ...settings, enabled: true, token: 'bad token\u0007' }));
  const badToken = JSON.parse(await forwardOpenMcpLine(rpc(12, 'tools/list'), dir) as string);
  assert.equal(badToken.id, 12); assert.match(badToken.error.message, /配置无效/); assert.ok(!badToken.error.message.includes('bad token'));
  assert.equal(await forwardOpenMcpLine(initialized, join(dir, 'absent')), null);
  const invalid = JSON.parse(await forwardOpenMcpLine('{not json', dir) as string);
  assert.equal(invalid.id, null); assert.equal(invalid.error.code, -32700);
  const oversized = JSON.parse(await forwardOpenMcpLine('x'.repeat(600 * 1024), dir) as string);
  assert.equal(oversized.id, null); assert.equal(oversized.error.code, -32600);
});

const built = fileURLToPath(new URL('../desktop-build/kadadesk-mcp.cjs', import.meta.url));
for (const [label, args] of [['源码', ['--import', 'tsx', fileURLToPath(new URL('./kadadesk-mcp-cli.ts', import.meta.url))]], ['构建产物 kadadesk-mcp.cjs', [built]]] as const) test(`kadadesk-mcp 命令行 --open（${label}）：stdout 只有 JSON-RPC 行（不混入横幅或日志）`, { skip: label !== '源码' && !existsSync(built) && '尚未运行 npm run build:desktop' }, async t => {
  const { dir } = await openServer(t);
  const child = spawn(process.execPath, [...args, '--open', '--data-dir', dir], { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { child.kill(); });
  const lines: string[] = [];
  const reader = createInterface({ input: child.stdout });
  const twoReplies = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CLI did not answer in time: ' + JSON.stringify(lines))), 20000);
    reader.on('line', line => { lines.push(line); if (lines.length === 2) { clearTimeout(timer); resolve(); } });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`CLI exited early (${code})`)); });
  });
  child.stdin.write([initialize(1), initialized, rpc(2, 'tools/list')].join('\n') + '\n');
  await twoReplies;
  const messages = lines.map(line => JSON.parse(line));
  assert.deepEqual(messages.map(m => m.id).sort(), [1, 2]);
  assert.equal(messages.find(m => m.id === 2).result.tools.length, 5);
});

test('kadadesk-mcp 命令行 --open --client：用该客户端连接；编号不合法时只在 stderr 说明并退出', async t => {
  const { dir, mcp } = await openServer(t);
  const hermes = (await mcp.addClient({ label: 'Hermes', tool: 'hermes' })).clients[0].id;
  const cli = ['--import', 'tsx', fileURLToPath(new URL('./kadadesk-mcp-cli.ts', import.meta.url))];
  const cwd = fileURLToPath(new URL('..', import.meta.url));
  const child = spawn(process.execPath, [...cli, '--open', '--client', hermes, '--data-dir', dir], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { child.kill(); });
  const reader = createInterface({ input: child.stdout });
  const reply = new Promise<string>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('CLI did not answer in time')), 20000); reader.once('line', line => { clearTimeout(timer); resolve(line); }); });
  child.stdin.write(rpc(1, 'tools/call', { name: 'knowledge_search', arguments: { query: '价格' } }) + '\n');
  assert.match(JSON.parse(await reply).result.content[0].text, /合成条目/);
  assert.equal(mcp.state().clients[0].calls, 1);
  const bad = spawn(process.execPath, [...cli, '--open', '--client', 'Bad Name', '--data-dir', dir], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  bad.stdout.on('data', chunk => { stdout += chunk; }); bad.stderr.on('data', chunk => { stderr += chunk; });
  const timer = setTimeout(() => bad.kill(), 20000);
  const code = await new Promise<number | null>(resolve => bad.once('exit', resolve));
  clearTimeout(timer);
  assert.notEqual(code, 0); assert.equal(stdout, ''); assert.match(stderr, /--client/);
});
