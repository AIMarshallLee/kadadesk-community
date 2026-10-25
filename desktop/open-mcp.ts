import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { chmod, readFile, rename, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
export interface AppTaskView { taskId: string; status: string; result?: string; error?: string; remoteApproval?: boolean; [key: string]: any }
export type AppTaskCaller = any;
import { CLIENTS_FILE, DEFAULT_CALLER, MAX_CLIENTS, clientId, identify, newKey, sanitizeClients, validLabel, type OpenMcpCaller, type OpenMcpClient } from './open-mcp-keys';
import { AUDIT_FILE, SETTINGS_READ_TOOL_NAMES, SETTINGS_TOOL_NAMES, SETTINGS_WRITE_TOOL_NAMES, createAuditLog, createSettingsTools, type OpenMcpAuditEntry, type OpenMcpSettingsDeps, type ReceptionView } from './open-mcp-settings';

/** 开放（MCP）: kadadesk's knowledge and reception exposed to other AI tools over the Model Context Protocol.
 *  Streamable-HTTP JSON-RPC on 127.0.0.1 only, bearer token required, plain JSON responses (no SSE), five tools.
 *  No tool picks a recipient or text, and none starts reception: reception_control only sets or lifts the pause
 *  (config.receptionSuspended, honoured in every reception mode), so it can never undo an operator or emergency stop.
 *  A running reception auto-replies as configured in kadadesk once the pause is lifted; knowledge_add only queues review.
 *  Clients limited to stdio reach this server through `kadadesk-mcp.cjs --open` (see mcp-stdio.ts).
 *  Each AI tool can get its own key (open-mcp-keys.ts); the original shared key remains the default client.
 *  App tasks (app_task_*) are offered only to a named client the owner allowed while 应用操作 is on; they only queue
 *  work that the owner then approves at the desk or from the admin WeChat chat (app-tasks.ts). Requests from a web
 *  page (a non-loopback Origin) are refused, so DNS rebinding cannot reach the server even with a leaked key.
 *  设置与模型 (open-mcp-settings.ts): every caller may read the configuration with secrets redacted; a named client the
 *  owner allowed 「可以修改设置」 may change settings, models and knowledge and start or stop reception, with the risky
 *  changes confirmed on screen. Every write is listed in the audit on the 开放 page. */

export interface OpenMcpSettings { enabled: boolean; port: number; token: string; disabledTools: string[]; appTasks: boolean; clients: OpenMcpClient[] }
/** What the page sees of a client: never the key itself, only its last four characters. */
export interface OpenMcpClientState extends Omit<OpenMcpClient, 'key'> { keyHint: string; calls: number; lastCallAt?: string }
export interface OpenMcpState extends Omit<OpenMcpSettings, 'clients'> { listening: boolean; url: string; error?: string; calls: number; lastCallAt?: string; defaultCalls: number; defaultLastCallAt?: string; clients: OpenMcpClientState[]; settingsTools: boolean; audit: OpenMcpAuditEntry[] }

interface Deps {
  file: string;
  request(input: { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; path: string; body?: Record<string, unknown> }): Promise<unknown>;
  reception(): { status: string; message: string; cycle: number; jobs: Array<{ status: string; conversationName: string; createdAt: string; updatedAt: string; input?: string; reply?: string }>; config: { receptionSuspended?: boolean; timezone?: string } } | undefined;
  pauseReception(): Promise<unknown>;
  suspendReception(suspended: boolean): Promise<unknown>;
  /** Ceiling for quota-consuming reply drafts; defaults to 30 per hour. */
  answerLimit?: { max: number; windowMs: number };
  /** App-task queue; absent (for example when its ledger failed to load) keeps the app tools hidden. */
  appTasks?: {
    apps(): Record<string, string>;
    request(caller: AppTaskCaller, input: Record<string, unknown>): Promise<AppTaskView>;
    status(caller: AppTaskCaller, taskId: string): AppTaskView;
    cancel(caller: AppTaskCaller, taskId: string): Promise<AppTaskView>;
    /** Cancels queued and running tasks without messaging WeChat. */
    revoke(reason: string): Promise<void>;
    /** Cancels one caller's queued and running tasks without messaging WeChat. */
    revokeCaller(key: string, reason: string): Promise<void>;
    /** Drops a deleted caller's lockout record. */
    forgetCaller?(key: string): Promise<void>;
  };
  /** Settings, models and knowledge management (open-mcp-settings.ts); absent keeps those tools hidden. */
  settings?: OpenMcpSettingsDeps;
  /** The owner's on-screen confirmation (Touch ID or a native dialog), as for app operation. */
  confirmOwner?(reason: string): Promise<void>;
}

const PROTOCOL = '2025-03-26';
const TOOLS = [
  { name: 'knowledge_search', title: '检索业务知识', description: '按客户问题检索咔哒里已审核、已启用的业务知识，返回最匹配的条目（标题、正文、来源）。只读。', inputSchema: { type: 'object', properties: { query: { type: 'string', description: '客户的问题或关键词' }, limit: { type: 'integer', minimum: 1, maximum: 10, default: 5 } }, required: ['query'] }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'knowledge_answer', title: '生成客服回复草稿', description: '用咔哒的知识库和话术，为一条客户消息生成可直接发出的回复草稿（消耗咔哒的试用/授权额度）。不会发送。', inputSchema: { type: 'object', properties: { text: { type: 'string', description: '客户消息原文' }, history: { type: 'array', description: '可选：此前的对话，[{role:"customer"|"agent", text}]', items: { type: 'object', properties: { role: { type: 'string' }, text: { type: 'string' } }, required: ['role', 'text'] } } }, required: ['text'] }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
  { name: 'reception_status', title: '自动接待状态', description: '当前自动接待是否在运行、今日回复/转人工/不确定的条数、待处理任务（默认不含客户原文）。只读。', inputSchema: { type: 'object', properties: { includeCustomerText: { type: 'boolean', default: false, description: '为 true 时附上待处理客户最近一句原文（最多 120 字）。原文会进入调用方 AI 的模型，默认不附。' } } }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'reception_control', title: '控制自动接待', description: 'action=pause 暂停自动回复和追问（不打断正在发送的消息；客户消息不再自动回复，也不会被打开）；resume 只解除这个暂停，不会启动接待；status 同 reception_status。start（按咔哒保存的配置开始接待，需主人在电脑上确认）和 stop（停止接待）只给有「可以修改设置」权限的客户端，急停后不能经开放接口重新开始。都不能指定发送对象或内容。', inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['pause', 'resume', 'status', 'start', 'stop'] } }, required: ['action'] }, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true } },
  { name: 'knowledge_add', title: '新增待审核知识', description: '把一条问答加入咔哒知识库的待审核队列；需要在咔哒里人工审核后才会被使用。', inputSchema: { type: 'object', properties: { title: { type: 'string' }, question: { type: 'string', description: '客户会怎么问' }, content: { type: 'string', description: '对客户说的答案' }, tags: { type: 'array', items: { type: 'string' } } }, required: ['title', 'content'] }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
] as const;
const TOOL_NAMES: readonly string[] = [...TOOLS.map(tool => tool.name), ...SETTINGS_TOOL_NAMES];
const APP_TOOL_NAMES: readonly string[] = ['app_task_request', 'app_task_status', 'app_task_cancel'];
const appTools = (apps: Record<string, string>) => [
  { name: 'app_task_request', title: '请求操作电脑应用', description: `请咔哒在主人允许的应用里执行一个短任务。只排队，不会立即执行：主人在电脑前用系统身份认证批准，或在管理员通知中用手机验证器批准后才执行，10 分钟内没批准就作废。返回 taskId，用 app_task_status 查询进度和结果。可用应用：${Object.entries(apps).map(([id, label]) => `${id}（${label}）`).join('、')}。`, inputSchema: { type: 'object', properties: { requestId: { type: 'string', maxLength: 120, description: '调用方生成的唯一编号；重复提交同一编号返回同一个任务' }, app: { type: 'string', enum: Object.keys(apps) }, instruction: { type: 'string', maxLength: 300, description: '一行普通文字，说明要做什么' }, maxSteps: { type: 'integer', minimum: 1, maximum: 10, default: 10 } }, required: ['requestId', 'app', 'instruction'] }, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true } },
  { name: 'app_task_status', title: '查询应用任务', description: '查询本调用方提交的应用任务：状态、步骤和结果。只读。', inputSchema: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'] }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'app_task_cancel', title: '取消应用任务', description: '取消本调用方提交的、还在排队或执行中的应用任务。', inputSchema: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'] }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
];
const LOCAL_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?$/i;
const localOrigin = (origin: string | string[] | undefined) => origin === undefined || (typeof origin === 'string' && LOCAL_ORIGIN.test(origin));
const knownTools = (value: unknown) => Array.isArray(value) ? [...new Set(value.filter((name): name is string => typeof name === 'string' && TOOL_NAMES.includes(name)))] : [];

export function createOpenMcp(deps: Deps) {
  let settings: OpenMcpSettings = { enabled: false, port: 8811, token: '', disabledTools: [], appTasks: false, clients: [] };
  let answerCalls: number[] = [];
  let server: Server | undefined; let listening = false; let error: string | undefined; let calls = 0; let lastCallAt: string | undefined;
  const usage = new Map<string, { calls: number; lastCallAt: string }>();
  const clientsFile = join(dirname(deps.file), CLIENTS_FILE);
  const audit = createAuditLog(join(dirname(deps.file), AUDIT_FILE));
  const scopes = (id: string) => { const client = settings.clients.find(item => item.id === id); return client ? { configWrite: client.configWrite, skipConfirm: client.configWrite && client.skipConfirm } : undefined; };
  const settingsTools = deps.settings ? createSettingsTools({ deps: deps.settings, request: deps.request, reception: () => deps.reception() as ReceptionView, audit, scopes, ...(deps.confirmOwner ? { confirmOwner: deps.confirmOwner } : {}) }) : undefined;
  let writes: Promise<void> = Promise.resolve(); let writeSeq = 0;

  const load = async () => {
    try { const raw = JSON.parse(await readFile(deps.file, 'utf8')); if (raw && typeof raw === 'object' && typeof raw.enabled === 'boolean' && Number.isInteger(raw.port) && raw.port > 1024 && raw.port < 65536 && typeof raw.token === 'string') settings = { enabled: raw.enabled, port: raw.port, token: raw.token, disabledTools: knownTools(raw.disabledTools), appTasks: raw.appTasks === true, clients: [] }; } catch { /* first run */ }
    if (!settings.token) settings.token = newKey();
    try { const raw = JSON.parse(await readFile(clientsFile, 'utf8')); settings = { ...settings, clients: sanitizeClients(raw?.clients, settings.token) }; } catch { /* no clients yet */ }
  };
  // Keys are local credentials: each file is written owner-only to a unique temp file and renamed over the old one,
  // one write at a time, so readers (the stdio bridge) never see a partial file and overlapping saves cannot collide.
  const writeOwnerOnly = async (file: string, data: string) => { const temp = `${file}.${process.pid}.${++writeSeq}.tmp`; await writeFile(temp, data, { mode: 0o600 }); await chmod(temp, 0o600); await rename(temp, file); };
  const persist = () => {
    const { clients, ...rest } = settings;
    const main = JSON.stringify(rest, null, 2), keys = JSON.stringify({ version: 1, clients }, null, 2);
    const write = writes.catch(() => undefined).then(async () => { await mkdir(dirname(deps.file), { recursive: true }); await writeOwnerOnly(deps.file, main); await writeOwnerOnly(clientsFile, keys); });
    writes = write;
    return write;
  };
  const unauthorized = (res: ServerResponse) => { res.writeHead(401, { 'WWW-Authenticate': 'Bearer', 'Content-Type': 'application/json' }); res.end('{"error":"unauthorized"}'); };
  const json = (res: ServerResponse, status: number, body: unknown) => { const text = JSON.stringify(body); res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) }); res.end(text); };
  const readBody = (req: IncomingMessage) => new Promise<string>((resolve, reject) => { let size = 0; const chunks: Buffer[] = []; req.on('data', (c: Buffer) => { size += c.length; if (size > 512 * 1024) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); }); req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); req.on('error', reject); });

  const text = (value: unknown) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
  const failed = (message: string) => ({ content: [{ type: 'text', text: message }], isError: true });
  const today = (at: string, timezone?: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: timezone || 'Asia/Shanghai', dateStyle: 'short' }).format(new Date(at)) === new Intl.DateTimeFormat('zh-CN', { timeZone: timezone || 'Asia/Shanghai', dateStyle: 'short' }).format(new Date());

  // Pause and resume only toggle config.receptionSuspended and report the real reception state; neither starts reception.
  const controlReception = async (suspended: boolean) => {
    await deps.suspendReception(suspended);
    const s = deps.reception(); const status = s?.status ?? 'unavailable'; const running = status === 'running';
    const detail = `${status}${s?.message ? `：${s.message}` : ''}`;
    const note = suspended
      ? (running ? '已暂停自动回复：客户消息不再自动回复，也不会被打开，追问同样暂停；不打断正在发送的消息。发送 resume 解除。' : `已记下暂停：接待当前没有在运行（${detail}）；之后在咔哒里开始接待也不会自动回复，直到发送 resume。`)
      : (running ? '已解除暂停：接待正在运行，会按咔哒保存的配置自动回复客户。' : `已解除暂停，但接待当前没有在运行（${detail}）；resume 不会替你启动接待：需要在咔哒里开始接待，或由有「可以修改设置」权限的客户端调用 action=start。`);
    return text({ suspended, status, running, note });
  };

  // App tools need the master switch, the queue, and a named client the owner allowed; the shared default key never.
  const appRefusal = (caller: OpenMcpCaller) => {
    if (!settings.appTasks || !deps.appTasks) return '应用操作没有在咔哒「开放」页开启';
    if (caller.id === DEFAULT_CALLER.id) return '默认密钥不能提交应用任务：请在咔哒「开放」页为这个工具添加客户端，并勾选「可以提交应用任务」';
    if (!caller.appTasks) return `「${caller.label}」没有应用操作权限：请在咔哒「开放」页勾选「可以提交应用任务」`;
    return undefined;
  };
  const receptionStatus = (args: Record<string, unknown>) => {
    const s = deps.reception(); if (!s) return { status: 'unavailable', note: '自动接待模块未就绪' };
    const tz = s.config.timezone; const jobs = s.jobs.filter(j => today(j.createdAt, tz));
    const count = (status: string) => jobs.filter(j => j.status === status).length;
    return { status: s.status, suspended: s.config.receptionSuspended === true, message: s.message, cycle: s.cycle, today: { replied: count('visually_confirmed'), uncertain: count('uncertain'), handoff: count('handoff'), failed: count('failed'), pending: count('queued') + count('ready') + count('generating') }, open: s.jobs.filter(j => ['uncertain', 'handoff', 'queued', 'ready'].includes(j.status)).slice(0, 10).map(j => ({ conversation: j.conversationName, status: j.status, at: j.updatedAt, ...(args.includeCustomerText === true ? { customer: (j.input ?? '').slice(0, 120) } : {}) })) };
  };
  // Settings tools: reads for every caller, writes listed only for a client with 「可以修改设置」 (calls are refused anyway).
  const settingsList = (caller: OpenMcpCaller) => settingsTools ? [...settingsTools.readTools(), ...(scopes(caller.id)?.configWrite ? settingsTools.writeTools() : [])] : [];
  const taskId = (args: Record<string, unknown>) => { const id = args.taskId; if (typeof id !== 'string' || !id || id.length > 100) throw new Error('taskId 无效'); return id; };
  const callTool = async (name: string, args: Record<string, unknown>, caller: OpenMcpCaller) => {
    const owner: AppTaskCaller = { key: caller.id, label: caller.label };
    switch (name) {
      case 'app_task_request': {
        const task = await deps.appTasks!.request(owner, args);
        if (task.status !== 'queued') return text(task);
        return text({ ...task, note: task.remoteApproval === false ? '已排队，等待主人在电脑前批准（这个任务不能远程批准）。用 app_task_status 查询结果。' : '已排队，等待主人批准：主人可在电脑前批准，或用手机验证器批准。用 app_task_status 查询结果。' });
      }
      case 'app_task_status': return text(deps.appTasks!.status(owner, taskId(args)));
      case 'app_task_cancel': return text(await deps.appTasks!.cancel(owner, taskId(args)));
      case 'knowledge_search': {
        const query = String(args.query ?? '').trim(); if (!query) return failed('query 不能为空');
        const result = await deps.request({ method: 'POST', path: '/knowledge/search', body: { query, scenario: 'all' } }) as { hits: Array<{ title: string; content: string; source?: string; score?: number }>; status: string; note: string };
        const limit = Math.min(10, Math.max(1, Number(args.limit ?? 5) || 5));
        return text({ status: result.status, note: result.note, hits: result.hits.slice(0, limit).map(h => ({ title: h.title, content: h.content, source: h.source ?? '' })) });
      }
      case 'knowledge_answer': {
        const message = String(args.text ?? '').trim(); if (!message) return failed('text 不能为空');
        const limit = deps.answerLimit ?? { max: 30, windowMs: 3_600_000 };
        const since = Date.now() - limit.windowMs; answerCalls = answerCalls.filter(at => at > since);
        if (answerCalls.length >= limit.max) return failed(`回复草稿调用太频繁：每 ${Math.round(limit.windowMs / 60_000)} 分钟最多 ${limit.max} 次，请稍后再试。`);
        answerCalls = [...answerCalls, Date.now()];
        const history = Array.isArray(args.history) ? (args.history as Array<{ role: string; text: string }>).filter(h => h && typeof h.text === 'string').slice(-20).map(h => ({ direction: h.role === 'agent' ? 'outgoing' : 'incoming', text: String(h.text).slice(0, 2000), stamp: '' })) : [];
        const result = await deps.request({ method: 'POST', path: '/copilot/reply', body: { text: message, history, allowModel: true, scenario: 'all' } }) as { baseReply: string; knowledgeSources: Array<{ title: string }>; intent?: { kind: string } };
        return text({ reply: result.baseReply, knowledge: result.knowledgeSources.map(k => k.title), intent: result.intent?.kind ?? '' });
      }
      case 'reception_status': return text(receptionStatus(args));
      case 'reception_control': {
        const action = String(args.action ?? '');
        if (action === 'pause' || action === 'resume') { const result = await controlReception(action === 'pause'); void settingsTools?.note(caller, 'reception_control', action === 'pause' ? '暂停自动回复' : '解除暂停'); return result; }
        if (action === 'status') return text(receptionStatus({}));
        if (action === 'start' || action === 'stop') return settingsTools ? settingsTools.reception(action, caller, () => receptionStatus({})) : failed(`这台电脑上不能经开放接口${action === 'start' ? '开始' : '停止'}接待`);
        return failed('action 必须是 pause、resume、status、start 或 stop');
      }
      case 'knowledge_add': {
        const title = String(args.title ?? '').trim(), content = String(args.content ?? '').trim(); if (!title || !content) return failed('title 和 content 不能为空');
        const tags = Array.isArray(args.tags) ? (args.tags as unknown[]).filter(t => typeof t === 'string').slice(0, 10) : [];
        const created = await deps.request({ method: 'POST', path: '/knowledge', body: { title, content, question: typeof args.question === 'string' ? args.question : '', tags: [...new Set([...tags, '来源:MCP'])], scenario: 'all', source: 'MCP' } }) as { id: string };
        void settingsTools?.note(caller, 'knowledge_add', `新增待审核知识「${title.slice(0, 30)}」`);
        return text({ id: created.id, status: 'pending_review', note: '已加入待审核队列，在咔哒「知识」里审核后才会启用。' });
      }
      default: {
        const result = SETTINGS_TOOL_NAMES.includes(name) ? await settingsTools?.call(name, args, caller) : undefined;
        return result ?? failed(SETTINGS_TOOL_NAMES.includes(name) ? '设置工具在这台电脑上不可用' : `未知工具：${name}`);
      }
    }
  };

  const rpc = async (message: { id?: unknown; method?: string; params?: Record<string, unknown> }, caller: OpenMcpCaller) => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } };
    const { id, method, params = {} } = message;
    const reply = (result: unknown) => ({ jsonrpc: '2.0', id, result });
    const fail = (code: number, msg: string) => ({ jsonrpc: '2.0', id, error: { code, message: msg } });
    try {
      switch (method) {
        case 'initialize': return reply({ protocolVersion: PROTOCOL, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'kadadesk', title: '咔哒工作台', version: '1.0.0' }, instructions: `咔哒工作台：检索已审核的业务知识、生成客服回复草稿、查看自动接待，暂停或解除暂停自动回复。工具不能指定发送对象或内容；解除暂停后，正在运行的接待会按咔哒保存的配置自动回复客户。${settingsTools ? 'settings_get / models_get / knowledge_list 读取全部设置（密钥只显示是否已保存）。' : ''}${settingsTools && scopes(caller.id)?.configWrite ? '你可以修改设置：settings_update、models_set、models_test、knowledge_review/update/delete/import，reception_control start/stop；换模型或密钥、删除或启用知识、放宽审核、改固定话术和开始接待需要主人在电脑上确认，所有修改都会记在咔哒「开放」页。' : ''}${appRefusal(caller) ? '' : '应用操作已开启：app_task_request 只排队，主人批准后才执行，用 app_task_status 取结果。'}` });
        case 'ping': return reply({});
        case 'tools/list': return reply({ tools: [...[...TOOLS, ...settingsList(caller)].filter(tool => !settings.disabledTools.includes(tool.name)), ...(appRefusal(caller) ? [] : appTools(deps.appTasks!.apps()))] });
        case 'tools/call': {
          const name = String(params.name ?? ''); const args = (params.arguments ?? {}) as Record<string, unknown>;
          calls++; lastCallAt = new Date().toISOString(); usage.set(caller.id, { calls: (usage.get(caller.id)?.calls ?? 0) + 1, lastCallAt });
          if (settings.disabledTools.includes(name)) return reply(failed(`该工具已在咔哒「开放」页关闭：${name}`));
          const refusal = APP_TOOL_NAMES.includes(name) ? appRefusal(caller) : undefined;
          if (refusal) return reply(failed(refusal));
          try { return reply(await callTool(name, args, caller)); }
          catch (cause) { return reply(failed(cause instanceof Error ? cause.message : String(cause))); }
        }
        default:
          if (method?.startsWith('notifications/')) return undefined;
          return fail(-32601, `Method not found: ${method}`);
      }
    } catch (cause) { return fail(-32603, cause instanceof Error ? cause.message : String(cause)); }
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/mcp') { json(res, 404, { error: 'not found' }); return; }
    if (!localOrigin(req.headers.origin)) { json(res, 403, { error: 'origin not allowed' }); return; }
    const caller = identify(req.headers.authorization, settings.token, settings.clients);
    if (!caller) { unauthorized(res); return; }
    if (req.method === 'GET') { json(res, 405, { error: 'SSE stream not offered; POST JSON-RPC to /mcp' }); return; }
    if (req.method === 'DELETE') { res.writeHead(204); res.end(); return; }
    if (req.method !== 'POST') { json(res, 405, { error: 'method not allowed' }); return; }
    const parseError = () => json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    let body: string;
    try { body = await readBody(req); } catch { parseError(); return; }
    // Identify again once the body is in: a key replaced or removed while the request was still arriving no longer
    // counts. From here to queuing a task nothing awaits, so a later revocation always finds and cancels that task.
    const current = identify(req.headers.authorization, settings.token, settings.clients);
    if (!current || current.id !== caller.id) { unauthorized(res); return; }
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { parseError(); return; }
    const messages = Array.isArray(parsed) ? parsed : [parsed];
    const responses = (await Promise.all(messages.map(m => rpc(m as { id?: unknown; method?: string; params?: Record<string, unknown> }, current)))).filter(Boolean);
    if (!responses.length) { res.writeHead(202); res.end(); return; }
    json(res, 200, Array.isArray(parsed) ? responses : responses[0]);
  };

  const stop = () => new Promise<void>(resolve => { const s = server; server = undefined; listening = false; if (!s) return resolve(); s.close(() => resolve()); });
  const start = () => new Promise<void>(resolve => {
    error = undefined;
    const s = createServer((req, res) => { handle(req, res).catch(cause => { try { json(res, 500, { error: cause instanceof Error ? cause.message : 'internal error' }); } catch { /* closed */ } }); });
    s.requestTimeout = 15_000; s.headersTimeout = 10_000; // a request cannot keep an old key alive for minutes
    s.on('error', cause => { error = cause instanceof Error ? cause.message : String(cause); listening = false; server = undefined; resolve(); });
    s.listen(settings.port, '127.0.0.1', () => { server = s; listening = true; resolve(); });
  });
  const apply = async () => { await stop(); if (settings.enabled) await start(); };

  const state = (): OpenMcpState => {
    const { clients, ...rest } = settings;
    const byDefault = usage.get(DEFAULT_CALLER.id);
    return {
      ...rest, defaultCalls: byDefault?.calls ?? 0, ...(byDefault ? { defaultLastCallAt: byDefault.lastCallAt } : {}),
      clients: clients.map(({ key, ...client }) => { const used = usage.get(client.id); return { ...client, keyHint: key.slice(-4), calls: used?.calls ?? 0, ...(used ? { lastCallAt: used.lastCallAt } : {}) }; }),
      listening, url: `http://127.0.0.1:${settings.port}/mcp`, ...(error ? { error } : {}), calls, ...(lastCallAt ? { lastCallAt } : {}),
      settingsTools: !!settingsTools, audit: audit.list(),
    };
  };
  const findClient = (id: unknown) => { const client = settings.clients.find(item => item.id === id); if (!client) throw new Error('客户端不存在'); return client; };
  const replaceClient = (client: OpenMcpClient, next: OpenMcpClient | undefined) => { settings = { ...settings, clients: next ? settings.clients.map(item => item === client ? next : item) : settings.clients.filter(item => item !== client) }; };
  return {
    async init() { await load(); await audit.load(); await persist(); await apply(); },
    state,
    async save(input: Partial<OpenMcpSettings> & { regenerateToken?: boolean; clientScope?: { id: string; configWrite?: boolean; skipConfirm?: boolean } }) {
      if (input.clientScope !== undefined) {
        // Per-client 修改设置 scope. Granting either right takes the owner's confirmation where one is available.
        const { id, configWrite, skipConfirm } = input.clientScope ?? {} as never;
        if ((configWrite !== undefined && typeof configWrite !== 'boolean') || (skipConfirm !== undefined && typeof skipConfirm !== 'boolean')) throw new Error('修改设置权限无效');
        const client = findClient(id);
        const next = { ...client, configWrite: configWrite ?? client.configWrite }; next.skipConfirm = next.configWrite && (skipConfirm ?? client.skipConfirm);
        if ((next.configWrite && !client.configWrite) || (next.skipConfirm && !client.skipConfirm)) await deps.confirmOwner?.(next.skipConfirm && !client.skipConfirm ? `允许「${client.label}」不经确认修改咔哒设置` : `允许「${client.label}」修改咔哒设置`);
        replaceClient(findClient(id), next);
      }
      const before = { enabled: settings.enabled, appTasks: settings.appTasks, port: settings.port };
      if (input.enabled !== undefined) { if (typeof input.enabled !== 'boolean') throw new Error('开关无效'); settings.enabled = input.enabled; }
      if (input.port !== undefined) { if (!Number.isInteger(input.port) || input.port < 1025 || input.port > 65535) throw new Error('端口须在 1025–65535 之间'); settings.port = input.port; }
      if (input.regenerateToken) settings.token = newKey();
      if (input.disabledTools !== undefined) {
        if (!Array.isArray(input.disabledTools)) throw new Error('工具开关无效');
        const unknown = input.disabledTools.find(name => typeof name !== 'string' || !TOOL_NAMES.includes(name));
        if (unknown !== undefined) throw new Error(`未知工具：${String(unknown)}`);
        settings.disabledTools = [...new Set(input.disabledTools)];
      }
      if (input.appTasks !== undefined) { if (typeof input.appTasks !== 'boolean') throw new Error('应用操作开关无效'); settings.appTasks = input.appTasks; }
      // Switching app operation or 开放 off withdraws everything already queued or running, even if the write fails.
      // The default key never owns app tasks, so replacing it withdraws nothing.
      const revoked = before.appTasks && !settings.appTasks ? '主人关闭了应用操作' : before.enabled && !settings.enabled ? '主人关闭了开放服务' : undefined;
      // Only the switch and the port need a restart; other changes apply per request without dropping connections.
      const restart = before.enabled !== settings.enabled || before.port !== settings.port;
      try { await persist(); if (restart) await apply(); } finally { if (revoked) await deps.appTasks?.revoke(revoked); }
      return state();
    },
    async addClient(input: { label: unknown; tool?: unknown }) {
      if (settings.clients.length >= MAX_CLIENTS) throw new Error(`最多 ${MAX_CLIENTS} 个客户端`);
      const label = validLabel(input?.label);
      // Approval requests name the client, so two clients may not share a name.
      if (settings.clients.some(item => item.label.toLowerCase() === label.toLowerCase())) throw new Error(`已有名为「${label}」的客户端，请换个名称`);
      const id = clientId(settings.clients.map(item => item.id), typeof input?.tool === 'string' ? input.tool : undefined);
      settings = { ...settings, clients: [...settings.clients, { id, label, key: newKey(), appTasks: false, configWrite: false, skipConfirm: false, createdAt: new Date().toISOString() }] };
      await persist(); return state();
    },
    async removeClient(id: string) {
      const client = findClient(id);
      replaceClient(client, undefined); usage.delete(client.id);
      // Memory already refuses the key; revoke even when the write fails, and still report the failure.
      try { await persist(); } finally { await deps.appTasks?.revokeCaller(client.id, '客户端已删除'); await deps.appTasks?.forgetCaller?.(client.id); }
      return state();
    },
    async regenerateClientKey(id: string) {
      const client = findClient(id);
      replaceClient(client, { ...client, key: newKey() });
      try { await persist(); } finally { await deps.appTasks?.revokeCaller(client.id, '客户端密钥已更换'); }
      return state();
    },
    async setClientAppTasks(id: string, allowed: boolean) {
      if (typeof allowed !== 'boolean') throw new Error('应用操作权限无效');
      const client = findClient(id);
      replaceClient(client, { ...client, appTasks: allowed });
      try { await persist(); } finally { if (!allowed) await deps.appTasks?.revokeCaller(client.id, '已收回应用操作权限'); }
      return state();
    },
    /** Main process only (copying a key when no bridge exists); the page never receives keys. */
    clientKey(id: string) { return findClient(id).key; },
    async close() { await stop(); await audit.flush(); },
  };
}
