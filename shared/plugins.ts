/**
 * 插件中心 v1: manifest format (kadadesk-plugin.json), validation and the plain-words labels the 插件 page shows.
 * Pure module: used by the main process (desktop/plugins.ts) and the renderer (src/PluginsPage.tsx).
 * Safety rules: nothing a plugin brings goes live without the owner's existing review; no plugin replies to
 * customers directly; tools that write need the owner's approval every time; tool output is untrusted data.
 */
export const PLUGIN_PERMISSIONS = ['knowledge.read', 'knowledge.suggest', 'reception.status', 'model.call', 'notify.owner', 'tools.read', 'tools.write', 'customer.reply'] as const;
export type PluginPermission = typeof PLUGIN_PERMISSIONS[number];
export type PluginKind = 'content' | 'tool' | 'automation';

export const PERMISSION_LABELS: Record<PluginPermission, string> = {
  'knowledge.read': '读取你已审核的业务资料',
  'knowledge.suggest': '往知识库里放待审核的内容（你审核通过后才会用）',
  'reception.status': '知道接待情况：有新消息、转人工时，能看到客户发来的文字',
  'model.call': '使用你配置的模型（会产生模型费用）',
  'notify.owner': '给你发提醒（电脑通知，或发到管理员聊天）',
  'tools.read': '用只读工具查信息（比如订单、物流），查到的内容只作参考资料',
  'tools.write': '用会写入的工具（比如改订单、登记预约），每次都要你点同意',
  'customer.reply': '直接回复客户（这一版不开放：装了也不会生效）',
};
export const KIND_LABELS: Record<PluginKind, string> = { content: '内容包', tool: '工具', automation: '自动化' };

export interface PluginKnowledgeItem { question: string; answer: string; title?: string; tags?: string[] }
export interface PluginStyle { name: string; instructions: string; greeting?: string; tone?: 'professional' | 'friendly' | 'brief' }
export interface PluginContent { knowledge?: PluginKnowledgeItem[]; scripts?: PluginKnowledgeItem[]; style?: PluginStyle }
export type PluginServer = { transport: 'stdio'; command: string; args?: string[]; env?: Record<string, string>; cwd?: string } | { transport: 'http'; url: string; headers?: Record<string, string> };

export type AutomationTrigger =
  | { type: 'first-message' }
  | { type: 'keyword'; keywords: string[] }
  | { type: 'daily'; time: string }
  | { type: 'handoff' };
export type AutomationAction =
  | { type: 'notify'; text?: string }
  | { type: 'admin'; text?: string }
  | { type: 'tool'; plugin: string; tool: string }
  | { type: 'csv' };
export interface AutomationRule { id: string; name?: string; enabled?: boolean; when: AutomationTrigger; then: AutomationAction[] }

export interface PluginManifest {
  id: string; name: string; version: string; author: string; description: string;
  kind: PluginKind; permissions: PluginPermission[];
  content?: PluginContent; server?: PluginServer; rules?: AutomationRule[];
}

export const TRIGGER_LABELS: Record<AutomationTrigger['type'], string> = { 'first-message': '新客户第一次来消息', keyword: '客户消息含关键词', daily: '每天某个时间', handoff: '转人工时' };
export const ACTION_LABELS: Record<AutomationAction['type'], string> = { notify: '通知我（电脑通知）', admin: '发给管理员聊天', tool: '调用工具插件的工具', csv: '记一条到本地表格' };

/** Tool marking set by the owner: read-only tools may be used automatically; everything else asks each time. */
export interface PluginToolSetting { name: string; description: string; inputSchema?: unknown; mode: 'read' | 'write'; triggers: string[] }
export interface PluginView {
  manifest: PluginManifest; enabled: boolean; installedAt: string; updatedAt: string; lastError?: string; failures: number;
  tools: PluginToolSetting[]; local?: boolean; dataFile?: string; created: { knowledge: number; workflows: number };
}
export interface PluginApproval { id: string; pluginId: string; pluginName: string; tool: string; input: string; reason: string; askedAt: string }
export type EvolutionKind = 'gap' | 'phrase' | 'automation';
export interface EvolutionSuggestion { id: string; kind: EvolutionKind; title: string; detail: string; question?: string; draft?: string; edited?: string; keyword?: string; count: number }
export interface EvolutionView { lastRunAt?: string; suggestions: EvolutionSuggestion[] }
export interface PluginsView { plugins: PluginView[]; approvals: PluginApproval[]; undo?: { label: string; at: string }; evolution: EvolutionView }
export interface PluginPreview { manifest: PluginManifest; permissions: Array<{ id: PluginPermission; label: string }>; warnings: string[]; replaces?: string }
export interface PluginsBridge {
  state(): Promise<PluginsView>;
  preview(text: string): Promise<PluginPreview>;
  install(text: string, consent: boolean): Promise<PluginsView>;
  setEnabled(id: string, enabled: boolean): Promise<PluginsView>;
  uninstall(id: string): Promise<PluginsView>;
  undo(): Promise<PluginsView>;
  refreshTools(id: string): Promise<PluginsView>;
  setTool(id: string, tool: string, input: { mode: 'read' | 'write'; triggers: string[] }): Promise<PluginsView>;
  saveRules(id: string, rules: AutomationRule[]): Promise<PluginsView>;
  createAutomation(name: string): Promise<PluginsView>;
  /** Approve (runs the write tool once) or refuse; `result` is the start of what the tool returned. */
  answerApproval(id: string, approve: boolean): Promise<{ view: PluginsView; result: string }>;
  evolution(): Promise<PluginsView>;
  adopt(id: string): Promise<PluginsView>;
  dismiss(id: string): Promise<PluginsView>;
}

export class PluginManifestError extends Error { constructor(message: string) { super(message); this.name = 'PluginManifestError'; } }
const fail = (message: string): never => { throw new PluginManifestError(message); };
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, label: string, max: number, required = true): string => {
  if (v === undefined && !required) return '';
  if (typeof v !== 'string' || (required && !v.trim()) || v.length > max) fail(`${label}无效（必填，最多 ${max} 个字）`);
  return (v as string).trim();
};
const strList = (v: unknown, label: string, maxItems: number, maxLen: number): string[] => {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > maxItems || v.some(x => typeof x !== 'string' || !x.trim() || x.length > maxLen)) fail(`${label}无效`);
  return [...new Set((v as string[]).map(x => x.trim()))];
};
const strMap = (v: unknown, label: string): Record<string, string> | undefined => {
  if (v === undefined) return undefined;
  if (!isObject(v) || Object.keys(v).length > 30 || Object.entries(v).some(([k, x]) => !/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(k) || typeof x !== 'string' || x.length > 2000)) fail(`${label}无效`);
  return { ...(v as Record<string, string>) };
};
export const PLUGIN_ID = /^[a-z0-9][a-z0-9-]{1,47}$/;
const KEYS: Record<PluginKind, string> = { content: 'content', tool: 'server', automation: 'rules' };

function items(v: unknown, label: string): PluginKnowledgeItem[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || !v.length || v.length > 500) fail(`${label}要是 1～500 条问答`);
  return (v as unknown[]).map((raw, i) => {
    if (!isObject(raw)) fail(`${label}第 ${i + 1} 条无效`);
    const r = raw as Record<string, unknown>;
    const tags = strList(r.tags, `${label}第 ${i + 1} 条的标签`, 10, 50);
    return { question: str(r.question, `${label}第 ${i + 1} 条的问题`, 500), answer: str(r.answer, `${label}第 ${i + 1} 条的回答`, 4000), ...(r.title !== undefined ? { title: str(r.title, `${label}第 ${i + 1} 条的标题`, 200) } : {}), ...(tags.length ? { tags } : {}) };
  });
}

export function validRule(raw: unknown, index = 0): AutomationRule {
  const n = `第 ${index + 1} 条规则`;
  if (!isObject(raw)) fail(`${n}无效`);
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(r.id) ? r.id : fail(`${n}缺少编号（id）`);
  const w = isObject(r.when) ? r.when : fail(`${n}缺少「当…」`);
  let when: AutomationTrigger;
  if (w.type === 'first-message' || w.type === 'handoff') when = { type: w.type };
  else if (w.type === 'keyword') { const keywords = strList(w.keywords, `${n}的关键词`, 20, 30); if (!keywords.length) fail(`${n}至少要一个关键词`); when = { type: 'keyword', keywords }; }
  else if (w.type === 'daily') { const time = typeof w.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(w.time) ? w.time : fail(`${n}的时间要写成 09:00 这样`); when = { type: 'daily', time }; }
  else return fail(`${n}的「当…」不认识：只能是新客户首次来消息、含关键词、每天某时、转人工时`);
  if (!Array.isArray(r.then) || !r.then.length || r.then.length > 5) fail(`${n}要有 1～5 个「就…」`);
  const then = (r.then as unknown[]).map((a): AutomationAction => {
    if (!isObject(a)) return fail(`${n}的「就…」无效`);
    if (a.type === 'notify' || a.type === 'admin') return { type: a.type, ...(a.text !== undefined ? { text: str(a.text, `${n}的提醒文字`, 300) } : {}) };
    if (a.type === 'tool') return { type: 'tool', plugin: typeof a.plugin === 'string' && PLUGIN_ID.test(a.plugin) ? a.plugin : fail(`${n}要写工具插件的编号`), tool: str(a.tool, `${n}的工具名`, 120) };
    if (a.type === 'csv') return { type: 'csv' };
    return fail(`${n}的「就…」不认识：只能是通知我、发给管理员聊天、调用工具、记到本地表格`);
  });
  return { id, ...(r.name !== undefined ? { name: str(r.name, `${n}的名字`, 60) } : {}), ...(r.enabled === false ? { enabled: false } : {}), when, then };
}

/** Permission an automation rule needs for its trigger and each action; missing ones are reported, never granted. */
export function rulePermissions(rule: AutomationRule): PluginPermission[] {
  const need = new Set<PluginPermission>();
  if (rule.when.type !== 'daily') need.add('reception.status');
  for (const a of rule.then) if (a.type === 'notify' || a.type === 'admin') need.add('notify.owner'); else if (a.type === 'tool') need.add('tools.read');
  return [...need];
}

/** Parses and checks a kadadesk-plugin.json. Unknown permissions, unknown kinds and fields of another kind are refused. */
export function validateManifest(input: unknown): PluginManifest {
  let raw = input;
  if (typeof raw === 'string') { if (raw.length > 2_000_000) fail('插件文件太大（最多 2MB）'); try { raw = JSON.parse(raw.replace(/^﻿/, '')); } catch { fail('插件文件不是有效的 JSON'); } }
  if (!isObject(raw)) fail('插件文件格式不对');
  const m = raw as Record<string, unknown>;
  const id = typeof m.id === 'string' && PLUGIN_ID.test(m.id) ? m.id : fail('插件编号（id）只能用小写字母、数字和短横线，2～48 个字符');
  const kind = m.kind === 'content' || m.kind === 'tool' || m.kind === 'automation' ? m.kind : fail('插件类型（kind）只能是 content、tool 或 automation');
  if (!Array.isArray(m.permissions) || m.permissions.length > PLUGIN_PERMISSIONS.length) fail('权限（permissions）要写成列表');
  const unknown = (m.permissions as unknown[]).filter(p => !PLUGIN_PERMISSIONS.includes(p as PluginPermission));
  if (unknown.length) fail(`不认识的权限：${unknown.map(String).join('、').slice(0, 100)}`);
  const permissions = [...new Set(m.permissions as PluginPermission[])];
  for (const other of Object.keys(KEYS) as PluginKind[]) if (other !== kind && m[KEYS[other]] !== undefined) fail(`「${KIND_LABELS[kind]}」插件不能带 ${KEYS[other]} 字段`);
  const base = { id, name: str(m.name, '插件名称', 60), version: str(m.version, '版本号', 30), author: str(m.author, '作者', 60), description: str(m.description, '简介', 500), kind, permissions } as PluginManifest;
  if (kind === 'content') {
    const c = isObject(m.content) ? m.content : fail('内容包要有 content 字段');
    const knowledge = items(c.knowledge, '知识包'), scripts = items(c.scripts, '话术包');
    let style: PluginStyle | undefined;
    if (c.style !== undefined) {
      if (!isObject(c.style)) fail('回复风格包无效');
      const s = c.style as Record<string, unknown>;
      if (s.tone !== undefined && !['professional', 'friendly', 'brief'].includes(s.tone as string)) fail('回复语气只能是 professional、friendly 或 brief');
      style = { name: str(s.name, '风格名称', 60), instructions: str(s.instructions, '风格说明', 4000), ...(s.greeting !== undefined ? { greeting: str(s.greeting, '开场白', 500) } : {}), ...(s.tone !== undefined ? { tone: s.tone as PluginStyle['tone'] } : {}) };
    }
    if (!knowledge && !scripts && !style) fail('内容包至少要有知识（knowledge）、话术（scripts）或回复风格（style）之一');
    if (!permissions.includes('knowledge.suggest')) fail('内容包需要 knowledge.suggest 权限（内容先放进待审核）');
    return { ...base, content: { ...(knowledge ? { knowledge } : {}), ...(scripts ? { scripts } : {}), ...(style ? { style } : {}) } };
  }
  if (kind === 'tool') {
    const s = isObject(m.server) ? m.server : fail('工具插件要有 server 字段（stdio 命令或 http 地址）');
    if (!permissions.includes('tools.read') && !permissions.includes('tools.write')) fail('工具插件需要 tools.read 或 tools.write 权限');
    if (s.transport === 'stdio') {
      const command = str(s.command, '启动命令', 500); if (/[\r\n\0]/.test(command)) fail('启动命令无效');
      const args = strList(s.args, '启动参数', 40, 1000), env = strMap(s.env, '环境变量'), cwd = s.cwd === undefined ? undefined : str(s.cwd, '工作目录', 500);
      return { ...base, server: { transport: 'stdio', command, ...(args.length ? { args } : {}), ...(env ? { env } : {}), ...(cwd ? { cwd } : {}) } };
    }
    if (s.transport === 'http') {
      const url = str(s.url, '服务地址', 1000); let parsed: URL | undefined; try { parsed = new URL(url); } catch { /* checked below */ }
      if (!parsed || !(parsed.protocol === 'https:' || (parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname))) || parsed.username || parsed.password) fail('服务地址要用 https://，只有本机地址可以用 http://');
      const headers = strMap(s.headers, '请求头');
      return { ...base, server: { transport: 'http', url: parsed!.toString(), ...(headers ? { headers } : {}) } };
    }
    return fail('server.transport 只能是 stdio 或 http');
  }
  if (!Array.isArray(m.rules) || !m.rules.length || m.rules.length > 50) fail('自动化插件要有 1～50 条规则（rules）');
  const rules = (m.rules as unknown[]).map((r, i) => validRule(r, i));
  if (new Set(rules.map(r => r.id)).size !== rules.length) fail('规则编号（id）不能重复');
  for (const r of rules) { const missing = rulePermissions(r).filter(p => !permissions.includes(p) && !(p === 'tools.read' && permissions.includes('tools.write'))); if (missing.length) fail(`规则「${r.name ?? r.id}」需要权限：${missing.join('、')}`); }
  return { ...base, rules };
}

/** What the install dialog warns about, in plain words. */
export function manifestWarnings(m: PluginManifest): string[] {
  const out: string[] = [];
  if (m.permissions.includes('customer.reply')) out.push('这个插件要「直接回复客户」的权限。这一版不开放这个权限，装了也不会生效，回复仍由咔哒按你的接待设置处理。');
  if (m.server?.transport === 'stdio') out.push(`这个插件会在你的电脑上运行命令：${[m.server.command, ...(m.server.args ?? [])].join(' ').slice(0, 200)}。只装你信得过的插件。`);
  if (m.server?.transport === 'http') out.push(`这个插件会连接：${m.server.url}。触发关键词时，客户那条消息的文字会发给它。`);
  if (m.kind === 'content') out.push('内容会先放进「待审核」，你审核启用后咔哒才会用。');
  if (m.permissions.includes('model.call')) out.push('使用模型会产生费用（按你配置的模型计费）。');
  return out;
}

/** The single string argument a tool takes, if its input schema is exactly one string property; otherwise undefined. */
export function singleStringParam(schema: unknown): string | undefined {
  if (!isObject(schema) || (schema.type !== undefined && schema.type !== 'object') || !isObject(schema.properties)) return undefined;
  const keys = Object.keys(schema.properties); if (keys.length !== 1) return undefined;
  const prop = (schema.properties as Record<string, unknown>)[keys[0]!];
  if (!isObject(prop) || prop.type !== 'string') return undefined;
  const required = Array.isArray(schema.required) ? schema.required : [];
  return required.every(r => r === keys[0]) ? keys[0] : undefined;
}
