import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { adminTagged, type DesktopReplyConfig } from '../shared/desktop-replies';
import { effectiveReviewMode, platformOf } from '../shared/platform-profiles';
export const visionPresets = [
  { id: 'zhipu-cn', region: 'cn', label: '智谱 GLM 视觉（免费模型）', protocol: 'openai-vision', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.6v-flash' },
  { id: 'qwen-cn', region: 'cn', label: '阿里云百炼 · 通义视觉', protocol: 'openai-vision', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3-vl-plus' },
  { id: 'doubao-cn', region: 'cn', label: '火山方舟 · 豆包视觉', protocol: 'openai-vision', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: '' },
  { id: 'custom-cn', region: 'cn', label: '其他国内视觉服务', protocol: 'openai-vision', baseUrl: '', model: '' },
  { id: 'siliconflow-cn', region: 'cn', label: '硅基流动 SiliconFlow（中转）', protocol: 'openai-vision', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen3-VL-32B-Instruct' },
  { id: 'gemini', region: 'global', label: 'Google Gemini', protocol: 'gemini-native', baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-3.8-flash' },
  { id: 'pixmind', region: 'global', label: 'PixMind 中转（OpenAI 兼容）', protocol: 'openai-vision', baseUrl: 'https://aihub-admin.aimix.pro/api-platform/v1', model: 'gemini-3.5-flash' },
  { id: 'openrouter', region: 'global', label: 'OpenRouter（全球聚合）', protocol: 'openai-vision', baseUrl: 'https://openrouter.ai/api/v1', model: 'google/gemini-3.5-flash' },
  { id: 'antigravity-local', region: 'global', label: 'Antigravity 本地反代', protocol: 'openai-vision', baseUrl: 'http://127.0.0.1:8045/v1', model: 'gemini-3.8-flash' },
  { id: 'kadadesk-builtin', region: 'cn', label: '内置模型版（授权即用，无需密钥）', protocol: 'openai-vision', baseUrl: '', model: 'gemini-3.5-flash' },
  { id: 'custom-global', region: 'global', label: '其他国际视觉服务 / 中转站', protocol: 'openai-vision', baseUrl: '', model: '' },
  { id: 'kimi-cn', region: 'cn', label: '月之暗面 Kimi', protocol: 'openai-vision', baseUrl: 'https://api.moonshot.cn/v1', model: '' },
  { id: 'minimax-cn', region: 'cn', label: 'MiniMax', protocol: 'openai-vision', baseUrl: 'https://api.minimaxi.com/v1', model: '' },
  { id: 'hunyuan-cn', region: 'cn', label: '腾讯混元', protocol: 'openai-vision', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', model: 'hunyuan-vision' },
  { id: 'qianfan-cn', region: 'cn', label: '百度千帆', protocol: 'openai-vision', baseUrl: 'https://qianfan.baidubce.com/v2', model: '' },
  { id: 'ollama-local', region: 'cn', label: '本机 Ollama', protocol: 'openai-vision', baseUrl: 'http://127.0.0.1:11434/v1', model: '' },
  { id: 'lmstudio-local', region: 'cn', label: '本机 LM Studio', protocol: 'openai-vision', baseUrl: 'http://127.0.0.1:1234/v1', model: '' },
  { id: 'gemini-openai', region: 'global', label: 'Google Gemini（OpenAI 兼容）', protocol: 'openai-vision', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.8-flash' },
  { id: 'openai', region: 'global', label: 'OpenAI', protocol: 'openai-vision', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'anthropic', region: 'global', label: 'Anthropic Claude（OpenAI 兼容）', protocol: 'openai-vision', baseUrl: 'https://api.anthropic.com/v1', model: '' },
  { id: 'xai', region: 'global', label: 'xAI Grok', protocol: 'openai-vision', baseUrl: 'https://api.x.ai/v1', model: '' },
  { id: 'groq', region: 'global', label: 'Groq', protocol: 'openai-vision', baseUrl: 'https://api.groq.com/openai/v1', model: '' },
  { id: 'together', region: 'global', label: 'Together AI', protocol: 'openai-vision', baseUrl: 'https://api.together.xyz/v1', model: '' },
] as const;
export type VisionProviderId = typeof visionPresets[number]['id'];
type VisionSettings = any;
import type { OpenMcpCaller } from './open-mcp-keys';

/** 开放 · 设置与模型 (docs/open-mcp.md): kadadesk's configuration for other AI tools. Every read is built from an
 *  allow-list and then stripped of secret-looking keys, so API keys, licence keys and tokens only ever appear as hasKey
 *  booleans. Writes need the per-client 「可以修改设置」 scope (never the shared default key); model or key changes,
 *  deleting or enabling knowledge, looser review/safety settings, customer-facing fixed texts, the admin contact and
 *  starting reception are confirmed by the owner on screen unless the owner ticked 「允许不经确认修改设置」 for that
 *  client. Nothing here sends a message, answers a held review, touches the licence, or lifts an emergency stop. Every
 *  write attempt (done, refused or failed) lands in the audit list on the 开放 page, without secrets. */

type Request = (input: { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; path: string; body?: Record<string, unknown> }) => Promise<unknown>;
type Outcome = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };
type ModelTest = { model?: string; message?: string; durationMs?: number };
type Pool = { enabled: boolean; baseUrl?: string; mainModel?: string; at?: string; models: Array<{ id: string; ms: number }>; tested?: number; running?: boolean; error?: string };
export type ReceptionView = { status: string; message: string; config: Record<string, unknown> } | undefined;
export interface OpenMcpSettingsDeps {
  /** Same path as the reception page's 保存: the controller validates with the UI's validator and refuses bad values. */
  saveReplyConfig(config: DesktopReplyConfig): Promise<unknown>;
  /** Starts reception with the saved configuration (refused after an emergency stop); absent hides action=start. */
  startReception?(): Promise<unknown>;
  stopReception?(): Promise<unknown>;
  vision: { settings(): Promise<VisionSettings>; save(input: unknown): Promise<VisionSettings>; saveBackup(input: unknown): Promise<VisionSettings>; clearBackup(): Promise<VisionSettings>; test(): Promise<ModelTest>; testBackup?(): Promise<ModelTest> };
  pool: { status(): Promise<Pool>; setEnabled(enabled: boolean): Promise<Pool>; refresh(): Promise<Pool> };
  displayMode?(): string;
}
export interface OpenMcpAuditEntry { at: string; callerId: string; caller: string; tool: string; summary: string; outcome: 'ok' | 'refused' | 'failed' }
export const AUDIT_FILE = 'open-mcp-audit.json';
export const AUDIT_MAX = 50;

/** Keys that never leave this module, at any depth. hasKey and keywordRules are not matched. */
const SECRET = /^(api_?key|key|keys|licen[cs]e_?key|token|access_?token|refresh_?token|app_?secret|secret|password|authorization|admin_?tag|machine_?id)$/i;
export function redact<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redact) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k]) => !SECRET.test(k)).map(([k, v]) => [k, redact(v)])) as T;
  return value;
}

export function createAuditLog(file: string) {
  let entries: OpenMcpAuditEntry[] = []; let writes: Promise<void> = Promise.resolve(); let seq = 0;
  const persist = () => { const data = JSON.stringify({ version: 1, entries }, null, 2); writes = writes.catch(() => undefined).then(async () => { await mkdir(dirname(file), { recursive: true }); const temp = `${file}.${process.pid}.${++seq}.tmp`; await writeFile(temp, data, { mode: 0o600 }); await chmod(temp, 0o600); await rename(temp, file); }); return writes; };
  return {
    async load() { try { const raw = JSON.parse(await readFile(file, 'utf8')); if (Array.isArray(raw?.entries)) entries = raw.entries.filter((e: OpenMcpAuditEntry) => e && typeof e.at === 'string' && typeof e.tool === 'string' && typeof e.summary === 'string').slice(0, AUDIT_MAX); } catch { /* none yet */ } },
    record(entry: Omit<OpenMcpAuditEntry, 'at'>) { entries = [{ at: new Date().toISOString(), ...entry, summary: entry.summary.slice(0, 300) }, ...entries].slice(0, AUDIT_MAX); return persist().catch(() => undefined); },
    list: () => entries.map(entry => ({ ...entry })),
    flush: () => writes.catch(() => undefined),
  };
}
export type AuditLog = ReturnType<typeof createAuditLog>;

const ro = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const rw = (destructive: boolean, idempotent = false, openWorld = false) => ({ readOnlyHint: false, destructiveHint: destructive, idempotentHint: idempotent, openWorldHint: openWorld });
const s = (description: string, maxLength = 200) => ({ type: 'string', maxLength, description });
const b = (description: string) => ({ type: 'boolean', description });
const e = (values: string[], description: string) => ({ type: 'string', enum: values, description });
const int = (minimum: number, maximum: number, description: string) => ({ type: 'integer', minimum, maximum, description });
const strings = (maxItems: number, description: string) => ({ type: 'array', maxItems, items: { type: 'string', maxLength: 200 }, description });
const obj = (properties: Record<string, unknown>, required: string[], description?: string) => ({ type: 'object', additionalProperties: false, properties, required, ...(description ? { description } : {}) });
const HHMM = 'HH:MM，咔哒所在时区';

/** Reception fields an AI tool may change, with the schema it sees. Everything else is refused by name. */
const RECEPTION_FIELDS: Record<string, unknown> = {
  application: e(['chat_app', 'wecom', 'qianniu', 'whatsapp', 'other', 'generic'], '聊天软件（平台）。other 是通用模式：每条回复都先给主人确认'),
  receptionMode: e(['inbox', 'selected'], 'inbox=自动接待所有新消息；selected=只接待 conversations 里启用的会话'),
  conversations: { type: 'array', maxItems: 30, description: '指定会话名单（receptionMode=selected 时使用）；名称须与聊天列表完全一致且不重复', items: obj({ id: s('唯一编号'), name: s('完整会话名'), enabled: b('是否接待'), kind: e(['direct', 'group'], '单聊或群聊') }, ['id', 'name', 'enabled']) },
  includeGroups: b('是否接待群聊（开启需主人确认）'), includedGroups: strings(20, '即使不接待群聊也接待的群（名称开头）'), excludedConversations: strings(300, '不接待的会话（完整名称）'),
  customerMarket: e(['unknown', 'domestic', 'international'], '客户市场'), replyLanguage: e(['zh-CN', 'en', 'auto'], '回复语言'), timezone: s('IANA 时区，例如 Asia/Shanghai', 64),
  adminContact: s('管理员联系人的备注名：接收提醒、审核草稿和每日小结（修改需主人确认）', 100),
  receptionHours: obj({ enabled: b('是否限定接待时段'), start: s(HHMM, 5), end: s(HHMM, 5), days: { type: 'array', items: int(0, 6, '0=周日'), maxItems: 7 } }, ['enabled', 'start', 'end', 'days'], '接待时段，可跨午夜'),
  dailySummaryAt: s(`每日小结发送时间（${HHMM}）；空字符串为关闭`, 5), weeklySummary: obj({ day: int(1, 7, '1=周一'), at: s(HHMM, 5) }, ['day', 'at'], '每周周报'),
  autoDiagnostics: b('接待需要人工处理时自动把诊断保存到「下载」'),
  persona: obj({ tone: e(['professional', 'friendly', 'brief'], '语气'), name: s('代表的店铺或品牌名', 60), intro: s('一段自我介绍/提示词，最多 600 字', 600) }, ['tone'], '人设与语气'),
  reviewMode: e(['off', 'new', 'risky', 'all'], '发送前给管理员审核：off 不审核、new 新客户、risky 退款投诉议价、all 全部（放宽需主人确认；通用模式始终全部审核）'),
  followUp: obj({ enabled: b('是否追问'), afterHours: int(1, 168, '客户多少小时没回复后追问'), text: s('追问话术（修改需主人确认）', 500), onlyReceptionHours: b('只在接待时段内追问') }, ['enabled', 'afterHours', 'text', 'onlyReceptionHours'], '一次性追问'),
  friendAccept: obj({ enabled: b('自动通过好友申请'), greeting: s('打招呼话术（修改需主人确认）', 500), maxPerDay: int(1, 50, '每天最多通过几位') }, ['enabled', 'greeting', 'maxPerDay']),
  humanPauseMinutes: int(5, 720, '主人亲自回复后，这个会话静默多少分钟'),
  keywordRules: { type: 'array', maxItems: 50, description: '关键词规则（修改固定回复需主人确认）', items: obj({ enabled: b('启用'), keywords: strings(20, '关键词'), action: e(['reply', 'handoff', 'tag'], 'reply 固定回复、handoff 转人工、tag 打标签'), text: s('固定回复', 1000), tag: s('标签', 30) }, ['enabled', 'keywords', 'action']) },
  knowledgeMode: e(['selected', 'retrieve'], 'selected=只用 knowledgeIds；retrieve=每条消息检索已审核知识'), knowledgeIds: strings(5000, '指定使用的知识 id（不限条数，建议不超过 200 条）'), workflowId: s('使用的话术/工作流 id；空字符串为不用'),
  mode: e(['manual', 'auto'], 'manual 只起草不发送；auto 自动发送（改为 auto 需主人确认）'), draftOnly: b('副驾草稿模式：打进输入框但不点发送（关闭需主人确认）'),
  pollSeconds: int(1, 3600, '多少秒看一次新消息'), maxRepliesPerHour: int(1, 500, '每小时最多回复几条'),
  humanDelay: b('拟人延时'), splitBubbles: b('长回复拆成多个气泡'), replyPendingOnStart: b('开始接待时回复还没回的消息'), autoResume: b('咔哒启动后自动恢复接待'),
  customerInquiryOnly: b('只回复产品/客户咨询'), submitWith: e(['click', 'enter', 'cmd+enter'], '发送方式'), inputMode: e(['pinyin', 'pico-paste'], '输入方式'),
  mediaAutoReply: s('客户发图片/文件/视频时先回的一句（修改需主人确认）；空字符串为只转人工', 500),
};
const BLOCKED: Record<string, string> = {
  receptionSuspended: '请用 reception_control 的 pause / resume', adminTag: '管理员暗号由咔哒生成，不能经开放接口设置',
  modelProtocol: '请用 models_set', replyModelMode: '请用 models_set', lightModel: '请用 models_set', routingModel: '请用 models_set',
  layout: '窗口区域需要在咔哒里校准', chat_appUnreadRegion: '消息徽标区域需要在咔哒里校准', rotation: '多账号轮巡要选择真实窗口，请在咔哒里设置',
  inputBackend: '键鼠执行方式请在咔哒里设置', chatExperience: '聊天场景请在咔哒里设置', cruiseMode: '旧版设置，已不再使用',
};
const PROVIDERS = visionPresets.map(p => p.id as string);
const visionInput = (description: string) => obj({ provider: e(PROVIDERS.filter(id => id !== 'kadadesk-builtin'), '服务商'), baseUrl: s('服务地址（Base URL）；不填用服务商默认地址', 500), model: s('模型名'), apiKey: s('密钥：只写入、不会返回；不填则沿用同一地址已保存的密钥', 1000) }, ['provider', 'model'], description);
const WORKFLOW = obj({ action: e(['create', 'update', 'delete'], '新建、修改或删除'), id: s('update / delete 时必填'), name: s('名称'), scenario: e(['service', 'community', 'sales', 'recruitment', 'content'], '场景'), description: s('描述', 500), instructions: s('话术/工作流说明（提示词）', 20000), greeting: s('问候语', 500), enabled: b('是否启用') }, ['action'], '话术/工作流');

const READ_TOOLS = [
  { name: 'settings_get', title: '读取咔哒全部设置', description: '返回当前生效的全部配置：接待配置、平台、审核方式、接待时段、管理员联系人、人设语气、话术/工作流、模型（画面识别主模型、回复文字模型、备用模型、自动挑选模型）、显示方式、授权状态。所有密钥只显示 hasKey 是否已保存。只读。', inputSchema: obj({}, []), annotations: ro },
  { name: 'models_get', title: '读取模型设置', description: '画面识别主模型、备用模型、回复文字模型、自动挑选模型状态和可选服务商。密钥只显示 hasKey。只读。', inputSchema: obj({}, []), annotations: ro },
  { name: 'knowledge_list', title: '列出知识库', description: '分页列出知识条目（含待审核），带审核状态和启用状态。只读。', inputSchema: obj({ status: e(['all', 'pending', 'enabled', 'disabled'], '筛选；默认 all'), query: s('按标题、问题或正文筛选'), offset: { type: 'integer', minimum: 0, default: 0 }, limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 } }, []), annotations: ro },
] as const;
const WRITE_TOOLS = [
  { name: 'settings_update', title: '修改咔哒设置', description: '部分修改接待配置（reception，与咔哒「接待」页使用同一校验，未知字段直接拒绝）、工作台名称（preferences）、新建/修改/删除一条话术工作流（workflow）。接待运行中不能修改，请先 reception_control action=stop。放宽审核、关闭草稿模式、改为自动发送、接待群聊、修改管理员联系人或发给客户的固定话术需主人在电脑上确认。', inputSchema: obj({ reception: obj(RECEPTION_FIELDS, [], '要修改的接待配置字段（只写要改的）'), preferences: obj({ workspaceName: s('工作台名称', 100), operatorName: s('操作员名称', 100) }, []), workflow: WORKFLOW }, []), annotations: rw(true) },
  { name: 'models_set', title: '修改模型设置', description: '设置画面识别主模型（vision）、备用模型（backup / clearBackup）、回复文字模型（text）、自动挑选模型开关（autoPool）、便宜模型（lightModel）和路由模型（routingModel）。apiKey 只写入、永不返回。换模型或密钥需主人在电脑上确认；更换回复文字模型的服务地址时必须同时给新密钥（已保存的密钥不会发往新地址）。', inputSchema: obj({ vision: visionInput('画面识别主模型'), backup: visionInput('备用模型（主模型限流或不可用时使用；须与主模型不同的服务商）'), clearBackup: b('清除备用模型'), text: obj({ baseUrl: s('OpenAI 兼容服务地址', 500), model: s('模型名'), temperature: { type: 'number', minimum: 0, maximum: 2 }, apiKey: s('密钥：只写入、不会返回', 1000) }, [], '回复文字模型'), autoPool: b('自动挑选模型（在同一服务里挑能读图且更快的模型）'), lightModel: s('简单识别用的便宜模型名；空字符串为都用主模型', 120), routingModel: e(['reply', 'vision'], '判断意图、挑知识用哪个模型') }, []), annotations: rw(true, true, true) },
  { name: 'models_test', title: '测试模型', description: 'target=main/backup 用咔哒生成的数字卡片测试画面识别（不截取聊天窗口）；text 测试回复文字模型连通；pool 重新检测自动挑选模型。会消耗模型调用。', inputSchema: obj({ target: e(['main', 'backup', 'text', 'pool'], '测试对象') }, ['target']), annotations: rw(false, true, true) },
  { name: 'knowledge_review', title: '审核待审知识', description: 'action=approve 审核通过并启用（会用于回复客户，需主人在电脑上确认）；reject 删除还没审核的条目。', inputSchema: obj({ ids: { ...strings(50, '知识 id'), minItems: 1 }, action: e(['approve', 'reject'], '通过或驳回') }, ['ids', 'action']), annotations: rw(true) },
  { name: 'knowledge_update', title: '修改知识', description: '修改一条知识；内容变化后会回到待审核。enabled=true 重新启用需主人确认，false 停用。', inputSchema: obj({ id: s('知识 id'), title: s('标题'), question: s('客户会怎么问', 2000), content: s('答案', 20000), tags: strings(20, '标签'), enabled: b('启用或停用') }, ['id']), annotations: rw(false, true) },
  { name: 'knowledge_delete', title: '删除知识', description: '永久删除一条知识（需主人在电脑上确认）。', inputSchema: obj({ id: s('知识 id') }, ['id']), annotations: rw(true, true) },
  { name: 'knowledge_import', title: '导入资料文本', description: '把一段资料或聊天记录整理成知识条目，全部进入待审核，审核后才会使用。', inputSchema: obj({ text: s('资料正文', 200000), sourceName: s('来源名称'), kind: e(['document', 'chat'], 'document 资料（默认）或 chat 聊天记录') }, ['text']), annotations: rw(false) },
] as const;
export const SETTINGS_READ_TOOL_NAMES: readonly string[] = READ_TOOLS.map(t => t.name);
export const SETTINGS_WRITE_TOOL_NAMES: readonly string[] = WRITE_TOOLS.map(t => t.name);
export const SETTINGS_TOOL_NAMES: readonly string[] = [...SETTINGS_READ_TOOL_NAMES, ...SETTINGS_WRITE_TOOL_NAMES];

const ID = /^[A-Za-z0-9_.:-]{1,200}$/;
const idOf = (value: unknown, what = 'id') => { if (typeof value !== 'string' || !ID.test(value)) throw new Error(`${what} 无效`); return value; };
const only = (value: unknown, keys: string[], where: string) => {
  if (value === undefined) return {} as Record<string, unknown>;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${where} 必须是对象`);
  const extra = Object.keys(value).find(k => !keys.includes(k)); if (extra) throw new Error(`${where} 里有未知参数：${extra}`);
  return value as Record<string, unknown>;
};
const host = (url: string) => { try { return new URL(url).host; } catch { return url; } };
const origin = (url: string) => { try { return new URL(url).origin; } catch { return url; } };
const short = (text: unknown, n = 40) => { const t = String(text ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
const REVIEW_LABEL: Record<string, string> = { off: '不审核', new: '新客户先审核', risky: '高风险先审核', all: '全部先审核' };
const reviewRank = (m: string) => m === 'all' ? 2 : m === 'off' ? 0 : 1;
/** The admin name without kadadesk's tag: the tag protects alerts and chat approvals, so no caller ever learns it. */
const adminName = (c: any) => adminTagged(c) ? c.adminContact!.trim().slice(c.adminTag!.length).replace(/^-/u, '') : (c.adminContact ?? '');

type Workspace = { knowledge: Array<{ id: string; title: string; content: string; question?: string; tags: string[]; enabled: boolean; reviewStatus?: string; source?: string; updatedAt: string; scenario?: string }>; workflows: Array<{ id: string; name: string; scenario: string; description: string; instructions: string; greeting: string; enabled: boolean; updatedAt: string }>; provider: { baseUrl: string; model: string; temperature: number; hasKey: boolean }; preferences: { workspaceName: string; operatorName: string } };
type Plan = { summary: string; confirm: string[]; run(): Promise<unknown> };

export function createSettingsTools(options: {
  deps: OpenMcpSettingsDeps; request: Request; reception(): ReceptionView; audit: AuditLog;
  /** Owner confirmation on screen (Touch ID or a native dialog); absent means confirmable actions are refused. */
  confirmOwner?(reason: string): Promise<void>;
  /** Live scopes of a caller, read again after a confirmation: a scope removed meanwhile cancels the write. */
  scopes(callerId: string): { configWrite: boolean; skipConfirm: boolean } | undefined;
  confirmTimeoutMs?: number;
}) {
  const { deps, request } = options;
  const text = (value: unknown): Outcome => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(redact(value), null, 2) }] });
  const failed = (message: string): Outcome => ({ content: [{ type: 'text', text: message }], isError: true });
  const workspace = async () => await request({ method: 'GET', path: '/state' }) as Workspace;
  const replyConfig = () => { const r = options.reception(); if (!r) throw new Error('自动接待模块未就绪'); return r; };
  let confirming = false;

  const confirm = async (caller: OpenMcpCaller, reasons: string[]) => {
    if (!reasons.length || options.scopes(caller.id)?.skipConfirm) return;
    if (!options.confirmOwner) throw new Error(`需要主人在电脑上确认（${reasons.join('；')}），但这台电脑现在不能弹出确认`);
    if (confirming) throw new Error('已有一个修改在等主人确认，请等它结束后再试');
    confirming = true; let timer: NodeJS.Timeout | undefined;
    try {
      const timeoutMs = options.confirmTimeoutMs ?? 120_000;
      await Promise.race([options.confirmOwner(`「${caller.label}」请求：${reasons.join('；')}`.slice(0, 300)), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`主人没有在 ${Math.round(timeoutMs / 1000)} 秒内确认，已放弃这次修改`)), timeoutMs); })]);
    } catch (cause) { throw new Error(`主人没有确认：${cause instanceof Error ? cause.message : String(cause)}`); }
    finally { clearTimeout(timer); confirming = false; }
    if (!options.scopes(caller.id)?.configWrite) throw new Error(`确认期间「${caller.label}」的修改设置权限已被收回`);
  };

  const modelsView = async () => {
    const [v, pool, ws] = await Promise.all([deps.vision.settings(), deps.pool.status(), workspace()]);
    const config = options.reception()?.config ?? {};
    const label = (id: string) => visionPresets.find(p => p.id === id)?.label ?? id;
    const profile = (id?: string) => { const p = v.profiles.find((x: any) => x.id === id); return p ? { provider: p.id, label: label(p.id), baseUrl: p.baseUrl, model: p.model, hasKey: p.hasKey } : undefined; };
    return {
      vision: { main: profile(v.activeId), backup: v.backupId ? profile(v.backupId) : null, profiles: v.profiles.filter((p: any) => p.model).map((p: any) => profile(p.id)) },
      text: { baseUrl: ws.provider.baseUrl, model: ws.provider.model, temperature: ws.provider.temperature, hasKey: ws.provider.hasKey },
      modelProtocol: config.modelProtocol ?? 'openai-vision', replyModelMode: config.replyModelMode ?? 'vision', lightModel: config.lightModel ?? '', routingModel: config.routingModel ?? 'reply',
      autoPool: { enabled: pool.enabled, models: pool.models, ...(pool.at ? { at: pool.at } : {}), ...(pool.tested !== undefined ? { tested: pool.tested } : {}), running: pool.running === true, ...(pool.error ? { error: pool.error } : {}) },
      providers: visionPresets.map(p => ({ provider: p.id, label: p.label, baseUrl: p.baseUrl, model: p.model, ...(p.id === 'kadadesk-builtin' ? { note: '内置模型版请在咔哒里一键开启' } : {}) })),
    };
  };

  const settingsView = async (caller: OpenMcpCaller) => {
    const r = replyConfig(); const config = r.config as Partial<DesktopReplyConfig>;
    const [ws, models, license] = await Promise.all([workspace(), modelsView(), (request({ method: 'GET', path: '/license/status' }) as Promise<{ status?: Record<string, unknown> }>).catch(() => undefined)]);
    const { layout: _l, chat_appUnreadRegion: _w, adminTag: _t, ...visible } = config; if (visible.adminContact !== undefined) visible.adminContact = adminName(config);
    const platform = platformOf(config);
    const scopes = options.scopes(caller.id);
    const l = license?.status;
    return {
      reception: { status: r.status, message: r.message, running: r.status === 'running', suspended: config.receptionSuspended === true },
      platform: { application: config.application ?? 'chat_app', id: platform.id, label: platform.label, forcedReview: platform.forceReview },
      review: { configured: config.reviewMode ?? 'off', effective: effectiveReviewMode(config) ?? 'off' },
      adminContact: adminName(config), adminTagged: adminTagged(config as any),
      config: visible,
      workspace: { preferences: { workspaceName: ws.preferences.workspaceName, operatorName: ws.preferences.operatorName }, knowledge: { total: ws.knowledge.length, pending: ws.knowledge.filter(k => k.reviewStatus === 'pending').length, enabled: ws.knowledge.filter(k => k.enabled).length } },
      workflows: ws.workflows.map(w => ({ id: w.id, name: w.name, scenario: w.scenario, enabled: w.enabled, selected: w.id === config.workflowId, description: w.description, greeting: w.greeting, instructions: w.instructions.slice(0, 4000) })),
      models, displayMode: deps.displayMode?.() ?? 'unknown',
      license: l ? { licensed: l.licensed === true, ...(typeof l.plan === 'string' ? { plan: l.plan } : {}), ...(typeof l.expiry === 'string' ? { expiry: l.expiry } : {}), trialUsed: l.trialUsed, trialLimit: l.trialLimit } : { unavailable: true },
      you: { label: caller.label, configWrite: scopes?.configWrite === true, skipConfirm: scopes?.skipConfirm === true },
      writable: Object.keys(RECEPTION_FIELDS),
    };
  };

  const knowledgeList = async (args: Record<string, unknown>) => {
    only(args, ['status', 'query', 'offset', 'limit'], '参数');
    const status = args.status === undefined ? 'all' : String(args.status); if (!['all', 'pending', 'enabled', 'disabled'].includes(status)) throw new Error('status 必须是 all、pending、enabled 或 disabled');
    const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
    const offset = Math.max(0, Math.floor(Number(args.offset ?? 0)) || 0), limit = Math.min(50, Math.max(1, Math.floor(Number(args.limit ?? 20)) || 20));
    const rows = (await workspace()).knowledge.filter(k => status === 'all' || (status === 'pending' ? k.reviewStatus === 'pending' : status === 'enabled' ? k.enabled : !k.enabled))
      .filter(k => !query || [k.title, k.question ?? '', k.content].some(v => v.toLowerCase().includes(query)));
    return { total: rows.length, offset, limit, items: rows.slice(offset, offset + limit).map(k => ({ id: k.id, title: k.title, question: k.question ?? '', content: k.content.slice(0, 2000), tags: k.tags, enabled: k.enabled, review: k.reviewStatus === 'pending' ? 'pending' : 'approved', source: k.source ?? '', updatedAt: k.updatedAt })) };
  };

  // ---- write plans: validate, say what changes and what needs the owner, then run ----
  const receptionPlan = (input: Record<string, unknown>) => {
    let patch = input;
    const r = replyConfig();
    if (r.status === 'running') throw new Error('接待正在运行：请先用 reception_control action=stop 停止接待，改完再 start');
    for (const key of Object.keys(patch)) { if (BLOCKED[key]) throw new Error(`${key} 不能经开放接口修改：${BLOCKED[key]}`); if (!(key in RECEPTION_FIELDS)) throw new Error(`未知设置项：${key}`); }
    const before = r.config as Partial<DesktopReplyConfig>;
    // The shown (untagged) admin name sent back unchanged keeps the saved, tagged one; any other name is saved untagged.
    if (typeof patch.adminContact === 'string' && adminTagged(before as any) && patch.adminContact.trim() === adminName(before)) patch = { ...patch, adminContact: before.adminContact };
    const next = { ...before, ...patch } as DesktopReplyConfig;
    const reasons: string[] = [];
    const was = effectiveReviewMode(before) ?? 'off', now = effectiveReviewMode(next) ?? 'off';
    if (was !== now && (reviewRank(now) < reviewRank(was) || reviewRank(now) === 1 && reviewRank(was) === 1)) reasons.push(`把发送前审核从「${REVIEW_LABEL[was]}」改为「${REVIEW_LABEL[now]}」`);
    if (before.draftOnly === true && next.draftOnly !== true) reasons.push('关闭副驾草稿模式（之后会自动点击发送）');
    if (before.mode !== 'auto' && next.mode === 'auto') reasons.push('改为自动发送模式');
    if (before.includeGroups !== true && next.includeGroups === true) reasons.push('开始接待群聊');
    if ((before.adminContact ?? '') !== (next.adminContact ?? '')) reasons.push(`把管理员联系人改为「${short(next.adminContact, 30) || '（无）'}」（提醒和审核会发给它，不带暗号）`);
    const fixed = (c: Partial<DesktopReplyConfig>) => JSON.stringify([(c.keywordRules ?? []).filter(k => k.action === 'reply').map(k => [k.keywords, k.text]), c.followUp?.text ?? '', c.friendAccept?.greeting ?? '', c.mediaAutoReply ?? null]);
    if (fixed(before) !== fixed(next)) reasons.push('修改直接发给客户的固定话术（关键词回复、追问、好友招呼或图片文件回复）');
    return { next, reasons, summary: `接待配置：${Object.keys(patch).join('、')}` };
  };
  const workflowPlan = (input: Record<string, unknown>): Plan => {
    const w = only(input, ['action', 'id', 'name', 'scenario', 'description', 'instructions', 'greeting', 'enabled'], 'workflow');
    const { action, id, ...fields } = w;
    if (action === 'create') return { summary: `新建话术「${short(fields.name, 30)}」`, confirm: [], run: () => request({ method: 'POST', path: '/workflows', body: fields }) };
    if (action === 'update') { const wid = idOf(id, '话术 id'); return { summary: `修改话术 ${wid}：${Object.keys(fields).join('、') || '无字段'}`, confirm: [], run: () => request({ method: 'PUT', path: `/workflows/${encodeURIComponent(wid)}`, body: fields }) }; }
    if (action === 'delete') { const wid = idOf(id, '话术 id'); return { summary: `删除话术 ${wid}`, confirm: [], run: () => request({ method: 'DELETE', path: `/workflows/${encodeURIComponent(wid)}` }) }; }
    throw new Error('workflow.action 必须是 create、update 或 delete');
  };

  const settingsUpdate = async (args: Record<string, unknown>): Promise<Plan> => {
    only(args, ['reception', 'preferences', 'workflow'], '参数');
    const steps: Plan[] = [];
    if (args.reception !== undefined) {
      if (!args.reception || typeof args.reception !== 'object' || Array.isArray(args.reception)) throw new Error('reception 必须是对象');
      const patch = args.reception as Record<string, unknown>; // each key is checked by name in receptionPlan
      if (!Object.keys(patch).length) throw new Error('reception 里没有要修改的字段');
      const { next, reasons, summary } = receptionPlan(patch);
      steps.push({ summary, confirm: reasons, run: () => deps.saveReplyConfig(next) });
    }
    if (args.preferences !== undefined) {
      const p = only(args.preferences, ['workspaceName', 'operatorName'], 'preferences');
      steps.push({ summary: `工作台：${Object.keys(p).join('、')}`, confirm: [], run: async () => { const ws = await workspace(); return request({ method: 'PUT', path: '/settings', body: { preferences: { workspaceName: p.workspaceName ?? ws.preferences.workspaceName, operatorName: p.operatorName ?? ws.preferences.operatorName } } }); } });
    }
    if (args.workflow !== undefined) steps.push(workflowPlan(args.workflow as Record<string, unknown>));
    if (!steps.length) throw new Error('没有要修改的内容：请给 reception、preferences 或 workflow');
    return { summary: steps.map(x => x.summary).join('；'), confirm: steps.flatMap(x => x.confirm), run: async () => { const done: string[] = []; for (const step of steps) { try { await step.run(); done.push(step.summary); } catch (cause) { throw new Error(`${cause instanceof Error ? cause.message : String(cause)}${done.length ? `（已完成：${done.join('；')}）` : ''}`); } } return { ok: true, done }; } };
  };

  const visionArgs = (value: unknown, where: string) => {
    const v = only(value, ['provider', 'baseUrl', 'model', 'apiKey'], where);
    const preset = visionPresets.find(p => p.id === v.provider); if (!preset) throw new Error(`${where}.provider 无效`);
    if (preset.id === 'kadadesk-builtin') throw new Error('内置模型版要用授权卡密，请在咔哒「设置 → 模型」里一键开启');
    if (typeof v.model !== 'string' || !v.model.trim()) throw new Error(`${where}.model 不能为空`);
    if (v.apiKey !== undefined && typeof v.apiKey !== 'string') throw new Error(`${where}.apiKey 必须是文字`);
    const baseUrl = typeof v.baseUrl === 'string' && v.baseUrl.trim() ? v.baseUrl.trim() : preset.baseUrl;
    if (!baseUrl) throw new Error(`${where}.baseUrl 不能为空：这个服务商没有默认地址`);
    const apiKey = typeof v.apiKey === 'string' && v.apiKey.trim() ? v.apiKey.trim() : undefined;
    return { input: { id: preset.id, baseUrl, model: v.model.trim(), ...(apiKey ? { apiKey } : {}) }, describe: `${preset.label} · ${v.model.trim()}（${host(baseUrl)}）${apiKey ? '并更换密钥' : ''}` };
  };
  const modelsSet = async (args: Record<string, unknown>): Promise<Plan> => {
    only(args, ['vision', 'backup', 'clearBackup', 'text', 'autoPool', 'lightModel', 'routingModel'], '参数');
    const steps: Plan[] = [];
    if (args.vision !== undefined) { const v = visionArgs(args.vision, 'vision'); steps.push({ summary: `画面识别主模型 → ${v.describe}`, confirm: [`把画面识别主模型改为 ${v.describe}`], run: () => deps.vision.save(v.input) }); }
    if (args.backup !== undefined && args.clearBackup === true) throw new Error('backup 和 clearBackup 不能同时给');
    if (args.backup !== undefined) { const v = visionArgs(args.backup, 'backup'); steps.push({ summary: `备用模型 → ${v.describe}`, confirm: [`把备用模型改为 ${v.describe}`], run: () => deps.vision.saveBackup(v.input) }); }
    if (args.clearBackup === true) steps.push({ summary: '清除备用模型', confirm: ['清除备用模型'], run: () => deps.vision.clearBackup() });
    if (args.text !== undefined) {
      const t = only(args.text, ['baseUrl', 'model', 'temperature', 'apiKey'], 'text'); const ws = await workspace(); const current = ws.provider;
      const baseUrl = typeof t.baseUrl === 'string' && t.baseUrl.trim() ? t.baseUrl.trim() : current.baseUrl, model = typeof t.model === 'string' && t.model.trim() ? t.model.trim() : current.model;
      const temperature = t.temperature === undefined ? current.temperature : t.temperature;
      if (t.apiKey !== undefined && typeof t.apiKey !== 'string') throw new Error('text.apiKey 必须是文字');
      const apiKey = typeof t.apiKey === 'string' && t.apiKey.trim() ? t.apiKey.trim() : undefined;
      // A saved key is never pointed at a new origin: the caller must bring the key for the new service itself.
      if (!apiKey && current.hasKey && origin(baseUrl) !== origin(current.baseUrl)) throw new Error('更换回复文字模型的服务地址时必须同时提供新密钥（text.apiKey）：咔哒不会把已保存的密钥发往新地址');
      const describe = `${model}（${host(baseUrl)}）${apiKey ? '并更换密钥' : ''}`;
      steps.push({ summary: `回复文字模型 → ${describe}`, confirm: [`把回复文字模型改为 ${describe}`], run: () => request({ method: 'PUT', path: '/settings', body: { provider: { baseUrl, model, temperature, ...(apiKey ? { apiKey } : {}) } } }) });
    }
    if (args.autoPool !== undefined) { if (typeof args.autoPool !== 'boolean') throw new Error('autoPool 必须是 true 或 false'); const on = args.autoPool; steps.push({ summary: `自动挑选模型 → ${on ? '开' : '关'}`, confirm: [], run: () => deps.pool.setEnabled(on) }); }
    if (args.lightModel !== undefined || args.routingModel !== undefined) {
      if (args.lightModel !== undefined && typeof args.lightModel !== 'string') throw new Error('lightModel 必须是文字');
      const patch = { ...(args.lightModel !== undefined ? { lightModel: String(args.lightModel).trim() } : {}), ...(args.routingModel !== undefined ? { routingModel: args.routingModel } : {}) };
      if (replyConfig().status === 'running') throw new Error('接待正在运行：请先用 reception_control action=stop 停止接待');
      steps.push({ summary: `便宜/路由模型：${Object.entries(patch).map(([k, v]) => `${k}=${v || '（空）'}`).join('、')}`, confirm: [], run: () => deps.saveReplyConfig({ ...replyConfig().config, ...patch } as unknown as DesktopReplyConfig) });
    }
    if (!steps.length) throw new Error('没有要修改的模型设置');
    return { summary: steps.map(x => x.summary).join('；'), confirm: steps.flatMap(x => x.confirm), run: async () => { const done: string[] = []; for (const step of steps) { try { await step.run(); done.push(step.summary); } catch (cause) { throw new Error(`${cause instanceof Error ? cause.message : String(cause)}${done.length ? `（已完成：${done.join('；')}）` : ''}`); } } return { ok: true, done, models: await modelsView() }; } };
  };
  const modelsTest = async (args: Record<string, unknown>): Promise<Plan> => {
    only(args, ['target'], '参数');
    const pick = (r: unknown) => { const x = (r ?? {}) as Record<string, unknown>; return { ok: x.ok !== false, ...(typeof x.model === 'string' ? { model: x.model } : {}), ...(typeof x.message === 'string' ? { message: x.message } : {}), ...(typeof x.durationMs === 'number' ? { durationMs: x.durationMs } : {}) }; };
    switch (args.target) {
      case 'main': return { summary: '测试画面识别主模型', confirm: [], run: async () => pick(await deps.vision.test()) };
      case 'backup': return { summary: '测试备用模型', confirm: [], run: async () => { if (!deps.vision.testBackup) throw new Error('这台电脑上不能测试备用模型'); return pick(await deps.vision.testBackup()); } };
      case 'text': return { summary: '测试回复文字模型', confirm: [], run: async () => pick(await request({ method: 'POST', path: '/provider/test' })) };
      case 'pool': return { summary: '重新检测自动挑选模型', confirm: [], run: () => deps.pool.refresh() };
      default: throw new Error('target 必须是 main、backup、text 或 pool');
    }
  };

  const knowledgeById = async (ids: string[]) => { const ws = await workspace(); return ids.map(id => { const k = ws.knowledge.find(item => item.id === id); if (!k) throw new Error(`知识不存在：${id}`); return k; }); };
  const knowledgeReview = async (args: Record<string, unknown>): Promise<Plan> => {
    only(args, ['ids', 'action'], '参数');
    if (!Array.isArray(args.ids) || !args.ids.length || args.ids.length > 50) throw new Error('ids 需要 1–50 个知识 id');
    const ids = [...new Set(args.ids.map(id => idOf(id, '知识 id')))]; const items = await knowledgeById(ids);
    const notPending = items.find(k => k.reviewStatus !== 'pending'); if (notPending) throw new Error(`「${notPending.title}」不是待审核条目`);
    const titles = items.map(k => short(k.title, 20)).join('、');
    if (args.action === 'approve') return { summary: `审核通过 ${ids.length} 条：${titles}`, confirm: [`审核通过并启用 ${ids.length} 条知识（会用于回复客户）：${titles}`], run: async () => { await request({ method: 'POST', path: '/knowledge/review', body: { ids, approved: true } }); return { ok: true, approved: ids }; } };
    if (args.action === 'reject') return { summary: `驳回 ${ids.length} 条待审核：${titles}`, confirm: [], run: async () => { for (const id of ids) await request({ method: 'DELETE', path: `/knowledge/${encodeURIComponent(id)}` }); return { ok: true, rejected: ids }; } };
    throw new Error('action 必须是 approve 或 reject');
  };
  const knowledgeUpdate = async (args: Record<string, unknown>): Promise<Plan> => {
    const { id, ...fields } = only(args, ['id', 'title', 'question', 'content', 'tags', 'enabled'], '参数'); const kid = idOf(id, '知识 id');
    if (!Object.keys(fields).length) throw new Error('没有要修改的字段');
    if (fields.enabled !== undefined && typeof fields.enabled !== 'boolean') throw new Error('enabled 必须是 true 或 false');
    const [item] = await knowledgeById([kid]);
    return { summary: `修改知识「${short(item.title, 30)}」：${Object.keys(fields).join('、')}`, confirm: fields.enabled === true && !item.enabled ? [`重新启用知识「${short(item.title, 30)}」（会用于回复客户）`] : [], run: async () => { const r = await request({ method: 'PUT', path: `/knowledge/${encodeURIComponent(kid)}`, body: fields }) as { reviewStatus?: string; enabled?: boolean }; return { ok: true, id: kid, review: r?.reviewStatus === 'pending' ? 'pending' : 'approved', enabled: r?.enabled === true, ...(r?.reviewStatus === 'pending' ? { note: '内容有变化，已回到待审核' } : {}) }; } };
  };
  const knowledgeDelete = async (args: Record<string, unknown>): Promise<Plan> => {
    only(args, ['id'], '参数'); const kid = idOf(args.id, '知识 id'); const [item] = await knowledgeById([kid]);
    return { summary: `删除知识「${short(item.title, 30)}」`, confirm: [`永久删除知识「${short(item.title, 30)}」`], run: async () => { await request({ method: 'DELETE', path: `/knowledge/${encodeURIComponent(kid)}` }); return { ok: true, deleted: kid }; } };
  };
  const knowledgeImport = async (args: Record<string, unknown>): Promise<Plan> => {
    only(args, ['text', 'sourceName', 'kind'], '参数');
    const body = typeof args.text === 'string' ? args.text.trim() : ''; if (!body) throw new Error('text 不能为空'); if (body.length > 200_000) throw new Error('text 最多 20 万字，请分批导入');
    if (args.kind !== undefined && args.kind !== 'document' && args.kind !== 'chat') throw new Error('kind 必须是 document 或 chat');
    const sourceName = typeof args.sourceName === 'string' && args.sourceName.trim() ? args.sourceName.trim().slice(0, 100) : 'MCP 导入';
    return { summary: `导入资料「${short(sourceName, 30)}」（${body.length} 字）`, confirm: [], run: async () => {
      const preview = await request({ method: 'POST', path: '/knowledge/import/preview', body: { text: body, textKind: args.kind ?? 'document', sourceName } }) as { previewId: string; rows: Array<{ rowId: string; title: string; content: string; tags?: string[]; question?: string; aliases?: string[]; scenario?: string; errors: string[]; duplicateOf?: string }>; warnings: string[] };
      const rows = preview.rows.filter(r => !r.errors.length && !r.duplicateOf).map(r => ({ rowId: r.rowId, title: r.title, content: r.content, tags: [...new Set([...(r.tags ?? []), '来源:MCP'])].slice(0, 20), ...(r.question ? { question: r.question } : {}), ...(r.aliases ? { aliases: r.aliases } : {}), ...(r.scenario ? { scenario: r.scenario } : {}) }));
      const skipped = preview.rows.length - rows.length;
      if (!rows.length) return { ok: false, created: 0, skipped, note: '没有可导入的新条目（都有错误或已存在）', warnings: preview.warnings };
      const done = await request({ method: 'POST', path: '/knowledge/import/commit', body: { confirm: true, previewId: preview.previewId, rows } }) as { created: Array<{ id: string; title: string }>; skipped: number };
      return { ok: true, created: done.created.length, ids: done.created.map(k => k.id), skipped: skipped + done.skipped, note: '已进入待审核队列，审核后才会用于回复', warnings: preview.warnings };
    } };
  };
  const PLANS: Record<string, (args: Record<string, unknown>) => Promise<Plan>> = { settings_update: settingsUpdate, models_set: modelsSet, models_test: modelsTest, knowledge_review: knowledgeReview, knowledge_update: knowledgeUpdate, knowledge_delete: knowledgeDelete, knowledge_import: knowledgeImport };

  /** Runs one guarded write and records it: refused without the scope, confirmed when needed, failures reported plainly. */
  const guarded = async (caller: OpenMcpCaller, tool: string, plan: () => Promise<Plan>): Promise<Outcome> => {
    const note = (outcome: OpenMcpAuditEntry['outcome'], summary: string) => options.audit.record({ callerId: caller.id, caller: caller.label, tool, summary, outcome });
    if (!options.scopes(caller.id)?.configWrite) {
      await note('refused', '没有修改设置权限');
      return failed(caller.id === 'default' ? '默认密钥不能修改设置：请在咔哒「开放」页为这个工具添加客户端，并勾选「可以修改设置」' : `「${caller.label}」没有修改设置权限：请在咔哒「开放」页勾选「可以修改设置」`);
    }
    let p: Plan;
    try { p = await plan(); } catch (cause) { const message = cause instanceof Error ? cause.message : String(cause); await note('failed', `参数无效：${message}`); return failed(message); }
    try { await confirm(caller, p.confirm); } catch (cause) { const message = cause instanceof Error ? cause.message : String(cause); await note('refused', `${p.summary}（${message}）`); return failed(message); }
    try { const result = await p.run(); await note('ok', p.summary); return text(result ?? { ok: true }); }
    catch (cause) { const message = cause instanceof Error ? cause.message : String(cause); await note('failed', `${p.summary}（${message}）`); return failed(message); }
  };

  return {
    readTools: () => READ_TOOLS.map(t => ({ ...t })),
    writeTools: () => WRITE_TOOLS.map(t => ({ ...t })),
    async call(name: string, args: Record<string, unknown>, caller: OpenMcpCaller): Promise<Outcome | undefined> {
      try {
        if (name === 'settings_get') return text(await settingsView(caller));
        if (name === 'models_get') return text(await modelsView());
        if (name === 'knowledge_list') return text(await knowledgeList(args));
      } catch (cause) { return failed(cause instanceof Error ? cause.message : String(cause)); }
      const plan = PLANS[name];
      return plan ? guarded(caller, name, () => plan(args)) : undefined;
    },
    /** reception_control start / stop: the scope, the owner's confirmation for start, and the audit. */
    reception(action: 'start' | 'stop', caller: OpenMcpCaller, describe: () => unknown): Promise<Outcome> {
      return guarded(caller, `reception_control.${action}`, async () => {
        const run = action === 'start' ? deps.startReception : deps.stopReception;
        if (!run) throw new Error(`这台电脑上不能经开放接口${action === 'start' ? '开始' : '停止'}接待`);
        if (action === 'start' && replyConfig().status === 'running') return { summary: '开始接待（已在运行）', confirm: [], run: async () => describe() };
        return action === 'start'
          ? { summary: '开始接待', confirm: ['开始自动接待：咔哒会接管键盘鼠标，并按保存的配置自动回复客户'], run: async () => { await run(); return describe(); } }
          : { summary: '停止接待', confirm: [], run: async () => { await run(); return describe(); } };
      });
    },
    /** Audit entries for pause/resume and knowledge_add, which stay open to every caller. */
    note: (caller: OpenMcpCaller, tool: string, summary: string, outcome: OpenMcpAuditEntry['outcome'] = 'ok') => options.audit.record({ callerId: caller.id, caller: caller.label, tool, summary, outcome }),
  };
}
