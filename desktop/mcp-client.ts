import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { PluginServer } from '../shared/plugins';

/**
 * Minimal MCP client for 工具插件: initialize, tools/list and tools/call over stdio (newline-delimited JSON-RPC, as
 * desktop/mcp-stdio.ts speaks it) or streamable HTTP (POST JSON-RPC; the reply is JSON or an SSE stream; the
 * Mcp-Session-Id from initialize is sent back, as desktop/open-mcp.ts expects). Every request has a timeout; a dead
 * stdio server is restarted on the next call. Nothing here decides whether a tool may run — see desktop/plugins.ts.
 */
export const MCP_PROTOCOL = '2025-03-26';
export interface McpTool { name: string; description?: string; inputSchema?: unknown }
export interface McpCallResult { text: string; isError: boolean }
export interface McpClient { listTools(signal?: AbortSignal): Promise<McpTool[]>; callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpCallResult>; close(): void }
export interface McpClientOptions { timeoutMs?: number; clientVersion?: string; spawnImpl?: typeof spawn; fetchImpl?: typeof fetch }
const MAX_MESSAGE = 4 * 1024 * 1024;

export class McpError extends Error { constructor(message: string) { super(message); this.name = 'McpError'; } }
type Rpc = { jsonrpc: '2.0'; id?: number | string | null; result?: any; error?: { code: number; message: string } };

function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>, ms: number, outer?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new McpError(`工具 ${Math.round(ms / 1000)} 秒没有响应`)), ms);
  const relay = () => controller.abort(outer?.reason ?? new McpError('已取消'));
  if (outer?.aborted) relay(); else outer?.addEventListener('abort', relay, { once: true });
  return new Promise<T>((resolve, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
    work(controller.signal).then(resolve, reject);
  }).finally(() => { clearTimeout(timer); outer?.removeEventListener('abort', relay); });
}

/** Text of a tools/call result: its text items, else its structured content as JSON. */
export function resultText(result: any): McpCallResult {
  const content = Array.isArray(result?.content) ? result.content : [];
  const texts = content.filter((c: any) => c && c.type === 'text' && typeof c.text === 'string').map((c: any) => c.text as string);
  const text = texts.length ? texts.join('\n') : result?.structuredContent !== undefined ? JSON.stringify(result.structuredContent) : content.length ? JSON.stringify(content) : '';
  return { text, isError: result?.isError === true };
}
const tools = (result: any): McpTool[] => (Array.isArray(result?.tools) ? result.tools : []).filter((t: any) => t && typeof t.name === 'string' && t.name.length <= 120).slice(0, 100)
  .map((t: any) => ({ name: t.name, ...(typeof t.description === 'string' ? { description: t.description.slice(0, 500) } : {}), ...(t.inputSchema && typeof t.inputSchema === 'object' ? { inputSchema: t.inputSchema } : {}) }));

abstract class BaseClient implements McpClient {
  protected nextId = 1; protected ready?: Promise<void>;
  constructor(protected timeoutMs: number, protected version: string) {}
  protected abstract send(message: object, signal: AbortSignal, expectReply: boolean): Promise<Rpc | undefined>;
  protected abstract reset(): void;
  abstract close(): void;
  protected async rpc(method: string, params: object, signal?: AbortSignal) {
    return withTimeout(async s => {
      const reply = await this.send({ jsonrpc: '2.0', id: this.nextId++, method, params }, s, true);
      if (!reply) throw new McpError('工具没有返回结果');
      if (reply.error) throw new McpError(`工具返回错误：${String(reply.error.message ?? '').slice(0, 200)}`);
      return reply.result;
    }, this.timeoutMs, signal);
  }
  protected init(signal?: AbortSignal) {
    this.ready ??= (async () => {
      const result = await this.rpc('initialize', { protocolVersion: MCP_PROTOCOL, capabilities: {}, clientInfo: { name: 'kadadesk', title: '咔哒', version: this.version } }, signal);
      if (!result || typeof result !== 'object') throw new McpError('工具没有完成初始化');
      await withTimeout(s => this.send({ jsonrpc: '2.0', method: 'notifications/initialized' }, s, false), this.timeoutMs, signal);
    })().catch(error => { this.ready = undefined; this.reset(); throw error; });
    return this.ready;
  }
  async listTools(signal?: AbortSignal) { await this.init(signal); return tools(await this.rpc('tools/list', {}, signal)); }
  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal) { await this.init(signal); return resultText(await this.rpc('tools/call', { name, arguments: args }, signal)); }
}

class StdioClient extends BaseClient {
  private child?: ChildProcessWithoutNullStreams; private pending = new Map<number | string, (reply: Rpc) => void>();
  constructor(private server: Extract<PluginServer, { transport: 'stdio' }>, timeoutMs: number, version: string, private spawnImpl: typeof spawn) { super(timeoutMs, version); }
  private start() {
    if (this.child && this.child.exitCode === null && !this.child.killed) return this.child;
    const child = this.spawnImpl(this.server.command, this.server.args ?? [], { cwd: this.server.cwd, env: { ...process.env, ...(this.server.env ?? {}) }, stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true }) as ChildProcessWithoutNullStreams;
    this.child = child; this.ready = undefined;
    child.stderr.on('data', () => { /* a server's own log; never shown or stored */ });
    child.stdin.on('error', () => { /* reported through exit */ });
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on('line', line => {
      if (line.length > MAX_MESSAGE || !line.trim()) return;
      let parsed: unknown; try { parsed = JSON.parse(line); } catch { return; }
      for (const m of Array.isArray(parsed) ? parsed : [parsed]) { const msg = m as Rpc; if (msg && msg.jsonrpc === '2.0' && msg.id !== undefined && msg.id !== null && ('result' in msg || 'error' in msg)) { const done = this.pending.get(msg.id); if (done) { this.pending.delete(msg.id); done(msg); } } }
    });
    const gone = (why: string) => { if (this.child === child) { this.child = undefined; this.ready = undefined; } for (const [id, done] of this.pending) { this.pending.delete(id); done({ jsonrpc: '2.0', id, error: { code: -32000, message: why } }); } };
    child.on('error', error => gone(`工具启动失败：${(error as NodeJS.ErrnoException).code === 'ENOENT' ? '找不到启动命令' : error.message}`));
    child.on('exit', () => gone('工具进程已退出'));
    return child;
  }
  protected send(message: { id?: number }, signal: AbortSignal, expectReply: boolean) {
    const child = this.start();
    return new Promise<Rpc | undefined>((resolve, reject) => {
      if (expectReply && message.id !== undefined) {
        this.pending.set(message.id, resolve);
        signal.addEventListener('abort', () => { this.pending.delete(message.id!); reject(signal.reason); }, { once: true });
      }
      child.stdin.write(JSON.stringify(message) + '\n', error => { if (error) { this.pending.delete(message.id!); reject(new McpError('无法发送给工具')); } else if (!expectReply) resolve(undefined); });
    });
  }
  protected reset() { const c = this.child; this.child = undefined; try { c?.kill(); } catch { /* gone */ } }
  close() { this.reset(); }
}

class HttpClient extends BaseClient {
  private session?: string;
  constructor(private server: Extract<PluginServer, { transport: 'http' }>, timeoutMs: number, version: string, private fetchImpl: typeof fetch) { super(timeoutMs, version); }
  protected async send(message: { id?: number }, signal: AbortSignal, expectReply: boolean): Promise<Rpc | undefined> {
    const headers: Record<string, string> = { ...(this.server.headers ?? {}), 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': MCP_PROTOCOL };
    if (this.session) headers['Mcp-Session-Id'] = this.session;
    let response: Response;
    try { response = await this.fetchImpl(this.server.url, { method: 'POST', body: JSON.stringify(message), headers, redirect: 'error', signal }); }
    catch (error) { if (signal.aborted) throw signal.reason; throw new McpError('连不上工具服务'); }
    const session = response.headers.get('mcp-session-id'); if (session && /^[\x21-\x7e]{1,200}$/.test(session)) this.session = session;
    if (!expectReply) { await response.body?.cancel().catch(() => {}); if (response.status >= 400) throw new McpError(`工具服务拒绝了请求（HTTP ${response.status}）`); return undefined; }
    if (response.status === 404 && this.session) { this.session = undefined; this.ready = undefined; }
    if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new McpError(`工具服务拒绝了请求（HTTP ${response.status}）`); }
    const type = response.headers.get('content-type') ?? '';
    const text = await readCapped(response);
    const match = (m: unknown) => !!m && typeof m === 'object' && (m as Rpc).id === message.id;
    if (type.includes('text/event-stream')) {
      for (const block of text.split(/\r?\n\r?\n/)) {
        const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n');
        if (!data) continue; let parsed: unknown; try { parsed = JSON.parse(data); } catch { continue; }
        const found = (Array.isArray(parsed) ? parsed : [parsed]).find(match); if (found) return found as Rpc;
      }
      throw new McpError('工具服务没有返回结果');
    }
    let parsed: unknown; try { parsed = JSON.parse(text); } catch { throw new McpError('工具服务返回了看不懂的内容'); }
    const found = (Array.isArray(parsed) ? parsed : [parsed]).find(match);
    if (!found) throw new McpError('工具服务没有返回结果');
    return found as Rpc;
  }
  protected reset() { this.session = undefined; }
  close() { const session = this.session; this.session = undefined; if (session) void this.fetchImpl(this.server.url, { method: 'DELETE', headers: { ...(this.server.headers ?? {}), 'Mcp-Session-Id': session }, redirect: 'error', signal: AbortSignal.timeout(2000) }).catch(() => {}); }
}

async function readCapped(response: Response) {
  const reader = response.body?.getReader(); if (!reader) return '';
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_MESSAGE) { await reader.cancel().catch(() => {}); throw new McpError('工具服务返回的内容太大'); } chunks.push(value); }
  return Buffer.concat(chunks).toString('utf8');
}

export function createMcpClient(server: PluginServer, options: McpClientOptions = {}): McpClient {
  const timeout = options.timeoutMs ?? 8000, version = options.clientVersion ?? '1.0.0';
  return server.transport === 'stdio' ? new StdioClient(server, timeout, version, options.spawnImpl ?? spawn) : new HttpClient(server, timeout, version, options.fetchImpl ?? fetch);
}
