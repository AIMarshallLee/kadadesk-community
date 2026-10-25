import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMcpClient, resultText } from './mcp-client';

// A fake MCP server speaking newline-delimited JSON-RPC on stdio. It refuses tools/list until the client has sent
// notifications/initialized, never answers `slow`, and exits on `crash`.
const FAKE_SERVER = String.raw`
import { createInterface } from 'node:readline';
let initialized = false;
const out = m => process.stdout.write(JSON.stringify(m) + '\n');
createInterface({ input: process.stdin }).on('line', line => {
  const m = JSON.parse(line);
  if (m.method === 'notifications/initialized') { initialized = true; return; }
  if (m.id === undefined) return;
  const reply = result => out({ jsonrpc: '2.0', id: m.id, result });
  if (m.method === 'initialize') return reply({ protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' } });
  if (!initialized) return out({ jsonrpc: '2.0', id: m.id, error: { code: -32002, message: 'not initialized' } });
  if (m.method === 'tools/list') return reply({ tools: [
    { name: 'lookup_order', description: '查订单', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
    { name: 'create_booking', description: '登记预约', inputSchema: { type: 'object', properties: { date: { type: 'string' }, name: { type: 'string' } } } },
  ] });
  if (m.method === 'tools/call') {
    const { name, arguments: a } = m.params;
    if (name === 'slow') return;
    if (name === 'crash') process.exit(3);
    if (name === 'broken') return reply({ content: [{ type: 'text', text: 'no such order' }], isError: true });
    return reply({ content: [{ type: 'text', text: '订单 ' + a.query + '：已发货' }] });
  }
  out({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } });
});
`;

async function fakeStdio(t: test.TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'kadadesk-mcp-client-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const script = join(dir, 'fake-mcp.mjs'); await writeFile(script, FAKE_SERVER, 'utf8');
  return { transport: 'stdio' as const, command: process.execPath, args: [script] };
}

test('stdio: initialize handshake, tools/list and tools/call against a fake local server', async t => {
  const client = createMcpClient(await fakeStdio(t), { timeoutMs: 5000 });
  t.after(() => client.close());
  const tools = await client.listTools();
  assert.deepEqual(tools.map(x => x.name), ['lookup_order', 'create_booking']);
  assert.equal(tools[0]!.description, '查订单');
  assert.deepEqual(await client.callTool('lookup_order', { query: 'A100' }), { text: '订单 A100：已发货', isError: false });
  assert.equal((await client.callTool('broken', {})).isError, true);
});

test('stdio: a silent tool times out, and a crashed server is restarted on the next call', async t => {
  const client = createMcpClient(await fakeStdio(t), { timeoutMs: 400 });
  t.after(() => client.close());
  await assert.rejects(client.callTool('slow', {}), /没有响应/);
  await assert.rejects(client.callTool('crash', {}), /退出/);
  assert.equal((await client.callTool('lookup_order', { query: 'B2' })).text, '订单 B2：已发货');
});

test('stdio: a missing command fails with a plain message', async () => {
  const client = createMcpClient({ transport: 'stdio', command: join(tmpdir(), 'no-such-kadadesk-mcp-command') }, { timeoutMs: 2000 });
  await assert.rejects(client.listTools(), /找不到启动命令|启动失败|退出/);
  client.close();
});

test('streamable HTTP: session id is kept, JSON and SSE replies are both read', async t => {
  const seen: Array<{ method: string; session?: string }> = [];
  const body = (req: IncomingMessage) => new Promise<string>(r => { let s = ''; req.on('data', c => { s += c; }); req.on('end', () => r(s)); });
  const server = createServer(async (req, res) => {
    if (req.method === 'DELETE') { res.writeHead(204); res.end(); return; }
    const m = JSON.parse(await body(req)); seen.push({ method: m.method, session: req.headers['mcp-session-id'] as string | undefined });
    if (m.id === undefined) { res.writeHead(202); res.end(); return; }
    if (m.method === 'initialize') { res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'sess-1' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-03-26', capabilities: {} } })); return; }
    if (m.method === 'tools/list') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'weather', inputSchema: { type: 'object', properties: { city: { type: 'string' } } } }] } })); return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: {} })}\n\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: '晴' }] } })}\n\n`);
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const client = createMcpClient({ transport: 'http', url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp` }, { timeoutMs: 3000 });
  assert.deepEqual((await client.listTools()).map(x => x.name), ['weather']);
  assert.deepEqual(await client.callTool('weather', { city: '杭州' }), { text: '晴', isError: false });
  client.close();
  assert.deepEqual(seen.map(s => s.method), ['initialize', 'notifications/initialized', 'tools/list', 'tools/call']);
  assert.equal(seen[0]!.session, undefined);
  assert.ok(seen.slice(1).every(s => s.session === 'sess-1'), 'session id sent back after initialize');
});

test('result text: text items, else structured content', () => {
  assert.deepEqual(resultText({ content: [{ type: 'text', text: 'a' }, { type: 'image', data: 'x' }, { type: 'text', text: 'b' }] }), { text: 'a\nb', isError: false });
  assert.equal(resultText({ content: [], structuredContent: { ok: 1 } }).text, '{"ok":1}');
});
