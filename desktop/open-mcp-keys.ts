import { randomBytes, timingSafeEqual } from 'node:crypto';
import { hasHiddenCharacters, hasMimicBrackets } from './plain-text';

/** Named client keys for 开放. Each AI tool can get its own key, label and app-operation permission, so the owner sees
 *  who called, can revoke one tool alone, and grants app operation per tool. The original shared key stays as the
 *  default client so existing configs keep working, but it can never request app operation. */
/** configWrite: 可以修改设置 (settings, models, knowledge management, starting reception); skipConfirm: 允许不经确认修改设置,
 *  only effective together with configWrite. Both default off and the shared default key never has them. */
export interface OpenMcpClient { id: string; label: string; key: string; appTasks: boolean; configWrite: boolean; skipConfirm: boolean; createdAt: string }
export interface OpenMcpCaller { id: string; label: string; appTasks: boolean; configWrite: boolean; skipConfirm: boolean }

export const DEFAULT_CALLER: Readonly<OpenMcpCaller> = Object.freeze({ id: 'default', label: '开放接口', appTasks: false, configWrite: false, skipConfirm: false });
export const MAX_CLIENTS = 20;
/** Client records live in their own owner-only file next to open-mcp.json, so an older kadadesk that rewrites
 *  open-mcp.json without knowing about clients cannot wipe their keys. */
export const CLIENTS_FILE = 'open-mcp-clients.json';
const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
// Keys travel in an HTTP header and in configs: visible ASCII only.
const KEY = /^[\x21-\x7e]{16,200}$/;

export const newKey = () => randomBytes(24).toString('base64url');

export function validLabel(value: unknown) {
  const label = typeof value === 'string' ? value.trim() : '';
  if (!label) throw new Error('客户端名称不能为空');
  if (label.length > 30) throw new Error('客户端名称最多 30 个字');
  // The label is shown to the owner in WeChat approval requests.
  if (hasHiddenCharacters(label)) throw new Error('客户端名称里有不可见或控制字符');
  if (hasMimicBrackets(label)) throw new Error('客户端名称里不能有「」『』【】这类括号');
  return label;
}

const randomSuffix = () => randomBytes(2).toString('hex');

/** The id configs use (`--client <id>`): the tool's id plus a random suffix. An id is never handed out twice, so a
 *  deleted client's leftover config cannot act as a newer client, and nothing a deleted client left behind
 *  (tasks, lockout) can pass to one. */
export function clientId(taken: readonly string[], preferred?: string, suffix: () => string = randomSuffix) {
  const base = preferred && /^[a-z0-9][a-z0-9-]{0,24}$/.test(preferred) && preferred !== DEFAULT_CALLER.id ? preferred : 'client';
  for (let attempt = 0; attempt < 50; attempt++) { const id = `${base}-${suffix()}`; if (ID.test(id) && !taken.includes(id)) return id; }
  throw new Error('无法生成客户端编号，请重试');
}

/** Client records read from disk: invalid, duplicate (id or key) and default-key entries are dropped. A label that
 *  fails today's rules falls back to the id, so tightening the rules can never silently delete a key. */
export function sanitizeClients(value: unknown, defaultKey: string): OpenMcpClient[] {
  if (!Array.isArray(value)) return [];
  const kept: OpenMcpClient[] = [];
  for (const item of value) {
    if (kept.length >= MAX_CLIENTS) break;
    if (!item || typeof item !== 'object') continue;
    const { id, label, key, appTasks, configWrite, skipConfirm, createdAt } = item as Record<string, unknown>;
    if (typeof id !== 'string' || !ID.test(id) || id === DEFAULT_CALLER.id || typeof key !== 'string' || !KEY.test(key) || key === defaultKey) continue;
    if (kept.some(other => other.id === id || other.key === key)) continue;
    let safe = id;
    try { safe = validLabel(label); } catch { /* keep the key; show the id */ }
    kept.push({ id, label: safe, key, appTasks: appTasks === true, configWrite: configWrite === true, skipConfirm: configWrite === true && skipConfirm === true, createdAt: typeof createdAt === 'string' ? createdAt : new Date(0).toISOString() });
  }
  return kept;
}

const sameKey = (given: Buffer, key: string) => { const want = Buffer.from(key); return given.length === want.length && timingSafeEqual(given, want); };

/** The caller behind an Authorization header, or undefined when no key matches. */
export function identify(header: string | undefined, defaultKey: string, clients: readonly OpenMcpClient[]): OpenMcpCaller | undefined {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '');
  if (!match) return undefined;
  const given = Buffer.from(match[1]);
  if (defaultKey && sameKey(given, defaultKey)) return { ...DEFAULT_CALLER };
  const client = clients.find(item => sameKey(given, item.key));
  return client ? { id: client.id, label: client.label, appTasks: client.appTasks, configWrite: client.configWrite, skipConfirm: client.configWrite && client.skipConfirm } : undefined;
}
