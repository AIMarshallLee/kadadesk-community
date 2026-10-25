import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import { createInterface } from 'node:readline';
import { CLIENTS_FILE } from './open-mcp-keys';

/** Stdio side of kadadesk's MCP servers: the default data directory, and the `--open` bridge for clients that can only
 *  spawn a command. The bridge forwards every JSON-RPC line to the local 开放 server (http://127.0.0.1:<port>/mcp),
 *  re-reading port and key from open-mcp.json for each request: client configs carry no key and a regenerated key
 *  applies at once. `--client <id>` picks that named client's key instead of the default one. Only JSON-RPC
 *  messages are ever written to stdout. */

const MAX_LINE_BYTES = 512 * 1024; // the 开放 server's own request limit
const REQUEST_TIMEOUT_MS = 120_000; // knowledge_answer waits for the reply model
const NOT_ENABLED = '咔哒「开放」MCP 服务未开启：请打开咔哒，在「开放」页勾选「开启 MCP 服务」后重试。';

/** The directory Electron uses as kadadesk's userData: <appData>/FlowDesk. */
export function defaultDataDirectory(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env, home = homedir()) {
  if (platform === 'win32') return win32.join(env.APPDATA || win32.join(home, 'AppData', 'Roaming'), 'FlowDesk');
  if (platform === 'darwin') return posix.join(home, 'Library', 'Application Support', 'FlowDesk');
  return posix.join(env.XDG_CONFIG_HOME || posix.join(home, '.config'), 'FlowDesk');
}

class BridgeError extends Error {}
type Endpoint = { url: string; port: number; token: string };

async function readEndpoint(directory: string, client?: string): Promise<Endpoint> {
  let raw: { enabled?: unknown; port?: unknown; token?: unknown } | null;
  try { raw = JSON.parse(await readFile(join(directory, 'open-mcp.json'), 'utf8')); }
  catch {
    const exists = await stat(directory).then(info => info.isDirectory(), () => false);
    throw new BridgeError(exists ? NOT_ENABLED : `找不到咔哒的数据目录：${directory}（请检查 --data-dir，或在「开放」页重新复制配置）。`);
  }
  if (raw?.enabled !== true) throw new BridgeError(NOT_ENABLED);
  const { port } = raw;
  let token = raw.token;
  if (client) {
    let entry: { key?: unknown } | undefined;
    try {
      const stored = JSON.parse(await readFile(join(directory, CLIENTS_FILE), 'utf8')) as { clients?: unknown };
      entry = Array.isArray(stored?.clients) ? stored.clients.find(item => !!item && typeof item === 'object' && (item as { id?: unknown }).id === client) as { key?: unknown } | undefined : undefined;
    } catch { entry = undefined; }
    if (!entry) throw new BridgeError(`咔哒「开放」里没有名为「${client}」的客户端：请在「开放」页重新复制这个工具的配置。`);
    token = entry.key;
  }
  // Only visible ASCII is a valid header value; anything else is a damaged file, reported without echoing the key.
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1025 || port > 65535 || typeof token !== 'string' || !/^[\x21-\x7e]+$/.test(token)) {
    throw new BridgeError('咔哒「开放」配置无效：请在「开放」页重新保存或重新生成密钥。');
  }
  return { url: `http://127.0.0.1:${port}/mcp`, port, token };
}

async function post(endpoint: Endpoint, body: string) {
  try {
    return await fetch(endpoint.url, {
      method: 'POST', body, redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { Authorization: `Bearer ${endpoint.token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    });
  } catch (cause) {
    if ((cause as Error)?.name === 'TimeoutError') throw new BridgeError('等待咔哒响应超时：请先在咔哒里确认任务状态，再决定是否重试。');
    throw new BridgeError(`无法连接咔哒「开放」MCP 服务（127.0.0.1:${endpoint.port}）：请确认咔哒正在运行并已开启 MCP 服务。`);
  }
}

const isJsonRpc = (value: unknown) => !!value && typeof value === 'object' && (value as { jsonrpc?: unknown }).jsonrpc === '2.0';

async function relay(response: Response): Promise<string | null> {
  if (response.status === 202) return null; // accepted notification
  if (response.status === 401) throw new BridgeError('咔哒拒绝了连接密钥：请确认 --data-dir 指向正在运行的咔哒的数据目录（在「开放」页重新复制配置即可）。');
  let parsed: unknown;
  try { parsed = JSON.parse(await response.text()); } catch { parsed = undefined; }
  if (Array.isArray(parsed) ? parsed.length > 0 && parsed.every(isJsonRpc) : isJsonRpc(parsed)) return JSON.stringify(parsed);
  throw new BridgeError(`咔哒「开放」服务返回了无法识别的响应（HTTP ${response.status}）。`);
}

/** One JSON-RPC error per request in the payload; notifications get no reply. */
function errorReply(payload: unknown, message: string) {
  const ids = (Array.isArray(payload) ? payload : [payload]).filter(m => !!m && typeof m === 'object' && 'id' in m).map(m => (m as { id: unknown }).id);
  const errors = ids.map(id => ({ jsonrpc: '2.0', id, error: { code: -32000, message } }));
  if (!errors.length) return null;
  return JSON.stringify(Array.isArray(payload) ? errors : errors[0]);
}

/** Forwards one stdio line. Resolves to the line to write back, or null when nothing is owed; never rejects. */
export async function forwardOpenMcpLine(line: string, directory: string, client?: string): Promise<string | null> {
  if (!line.trim()) return null;
  if (Buffer.byteLength(line) > MAX_LINE_BYTES) return JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request too large' } });
  let payload: unknown;
  try { payload = JSON.parse(line); } catch { return JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
  try { return await relay(await post(await readEndpoint(directory, client), line)); }
  catch (cause) { return errorReply(payload, cause instanceof BridgeError ? cause.message : `咔哒「开放」MCP 桥接失败：${cause instanceof Error ? cause.message : String(cause)}`); }
}

export function serveOpenMcpStdio(directory: string, client?: string, input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout) {
  const lines = createInterface({ input, terminal: false, crlfDelay: Infinity });
  lines.on('line', line => { void forwardOpenMcpLine(line, directory, client).then(reply => { if (reply) output.write(reply + '\n'); }); });
}
