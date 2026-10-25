/** Diagnostic exports use closed vocabularies. Never serialize raw errors or application state. */
import { safeModelTiming } from './model-timing';

const macNativeCodes = ['MAC_SCREEN_PERMISSION', 'MAC_ACCESSIBILITY_PERMISSION', 'MAC_SESSION_UNAVAILABLE', 'MAC_WINDOW_UNAVAILABLE', 'MAC_WINDOW_AMBIGUOUS', 'MAC_CAPTURE_EMPTY', 'MAC_ACTIVATE_FAILED', 'MAC_UNSUPPORTED_OPERATION', 'MAC_NATIVE_FAILED'] as const;
export const diagnosticCodes = [...macNativeCodes, 'CAPTURE_EMPTY', 'SCAN_FAILED', 'UNKNOWN', 'AUTH', 'PERMISSION', 'BALANCE', 'RATE_LIMIT', 'MODEL_UNAVAILABLE', 'TIMEOUT', 'NETWORK', 'FOCUS', 'INPUT_BUSY', 'VISION', 'HARDWARE', 'STORAGE', 'CANCELLED', 'INVALID_CONFIG', 'STARTED'] as const;
export type DiagnosticCode = typeof diagnosticCodes[number];

/** What the help file tells the owner to do with it (one sentence, shown in the app and at the top of the file). */
export const SUPPORT_HINT = '把这个文件发给技术支持，不包含客户聊天内容和密钥。';
export const diagnosticScopes = ['app', 'workspace', 'model', 'knowledge', 'reception', 'hardware', 'input', 'other'] as const;
export type DiagnosticScope = typeof diagnosticScopes[number];
export interface DiagnosticEntry { at: string; scope: DiagnosticScope; code: DiagnosticCode }
export interface DiagnosticBridge {
  report(): Promise<string>;
  copy(): Promise<string>;
  save(): Promise<{ saved: boolean }>;
  feedback?(description: string): Promise<{ file: string; opened: boolean }>;
  record(scope: DiagnosticScope, code: DiagnosticCode): Promise<void>;
}

export function diagnosticScope(channel: string): DiagnosticScope {
  if (/vision|provider|model/.test(channel)) return 'model';
  if (/knowledge|import/.test(channel)) return 'knowledge';
  if (/replies/.test(channel)) return 'reception';
  if (/usb|firmware/.test(channel)) return 'hardware';
  if (/companion|cu:|paste/.test(channel)) return 'input';
  if (/request|state|settings/.test(channel)) return 'workspace';
  return 'other';
}

export function diagnosticCode(value: unknown): DiagnosticCode {
  const text = (value instanceof Error ? value.message : typeof value === 'string' ? value : '').slice(0, 6000);
  const macCode = macNativeCodes.find(code => new RegExp(`\\b${code}\\b`).test(text));
  if (macCode) return macCode;
  if (text.includes('[CAPTURE_EMPTY]')) return 'CAPTURE_EMPTY';
  if (/\b401\b|认证失败|密钥无效/i.test(text)) return 'AUTH';
  if (/\b403\b|无权限|permission denied/i.test(text)) return 'PERMISSION';
  if (/\b402\b|余额|额度已用尽/i.test(text)) return 'BALANCE';
  if (/\b429\b|限流/i.test(text)) return 'RATE_LIMIT';
  if (/\b50[0234]\b|模型不存在/i.test(text)) return 'MODEL_UNAVAILABLE';
  if (/timeout|timed out|超时/i.test(text)) return 'TIMEOUT';
  if (/fetch failed|network|ECONN|网络/i.test(text)) return 'NETWORK';
  if (/focus|失焦|前台/i.test(text)) return 'FOCUS';
  if (/键鼠|input busy|正在执行|请先暂停|请等待/i.test(text)) return 'INPUT_BUSY';
  if (/识别|识图|transcript|画面/i.test(text)) return 'VISION';
  if (/USB|皮卡|硬件|firmware/i.test(text)) return 'HARDWARE';
  if (/保存失败|保存不可用|ENOSPC|EACCES/i.test(text)) return 'STORAGE';
  // A stopped outcome is not evidence of who cancelled or why a scan failed.
  if (text.endsWith('会话扫描未完成，已停止操作。请检查窗口、会话名称和校准区域后重试。')) return 'SCAN_FAILED';
  if (/cancel|aborted|取消/i.test(text)) return 'CANCELLED';
  if (/配置|校准|参数/i.test(text)) return 'INVALID_CONFIG';
  return 'UNKNOWN';
}

const obj = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {};
const count = (v: unknown) => Array.isArray(v) ? v.length : 0;
const enumValue = (v: unknown, allowed: readonly string[]) => typeof v === 'string' && allowed.includes(v) ? v : 'unknown';
const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
const time = (v: unknown) => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(v) && Number.isFinite(Date.parse(v)) ? v : 'unknown';

export function validDiagnosticEntry(v: unknown): v is DiagnosticEntry {
  const e = obj(v); return time(e.at) !== 'unknown' && diagnosticScopes.includes(e.scope) && diagnosticCodes.includes(e.code);
}

export function safeEnvironment(v: unknown) {
  const e = obj(v); const short = (x: unknown) => typeof x === 'string' && /^[\w.\- ]{1,40}$/.test(x) ? x : 'unknown';
  return {
    os: short(e.os), arch: enumValue(e.arch, ['arm64', 'x64', 'ia32']), locale: short(e.locale), darkMode: e.darkMode === true,
    displays: (Array.isArray(e.displays) ? e.displays : []).slice(0, 4).map(d => ({ width: number(obj(d).width), height: number(obj(d).height), scale: typeof obj(d).scale === 'number' ? Math.round(obj(d).scale * 100) / 100 : 0, primary: obj(d).primary === true })),
    chatWindow: { width: number(obj(e.chatWindow).width), height: number(obj(e.chatWindow).height) }
  };
}

export function safeSettings(v: unknown) {
  const c = obj(v), on = (x: unknown) => x === true, set = (x: unknown) => typeof x === 'string' && x.trim().length > 0;
  return {
    receptionMode: enumValue(c.receptionMode, ['inbox', 'selected']), mode: enumValue(c.mode, ['manual', 'auto']), inputBackend: enumValue(c.inputBackend, ['usb', 'software', 'windows']), inputMode: enumValue(c.inputMode, ['pico-paste', 'pico-type', 'software', 'paste', 'type']),
    modelProtocol: enumValue(c.modelProtocol, ['gemini-native', 'openai-vision', 'deepseek']), replyModelMode: enumValue(c.replyModelMode, ['vision', 'separate']), knowledgeMode: enumValue(c.knowledgeMode, ['selected', 'retrieve']), reviewMode: enumValue(c.reviewMode, ['off', 'new', 'risky', 'all']), submitWith: enumValue(c.submitWith, ['click', 'enter', 'cmd+enter']),
    autoResume: on(c.autoResume), humanDelay: on(c.humanDelay), splitBubbles: on(c.splitBubbles), cruiseMode: on(c.cruiseMode), draftOnly: on(c.draftOnly), customerInquiryOnly: on(c.customerInquiryOnly), replyPendingOnStart: on(c.replyPendingOnStart), autoDiagnostics: on(c.autoDiagnostics), receptionSuspended: on(c.receptionSuspended),
    pollSeconds: number(c.pollSeconds), maxRepliesPerHour: number(c.maxRepliesPerHour), humanPauseMinutes: number(c.humanPauseMinutes), conversations: count(c.conversations), keywordRules: count(c.keywordRules), knowledgeSelected: count(c.knowledgeIds),
    receptionHours: !!c.receptionHours, rotation: { enabled: on(obj(c.rotation).enabled), windows: count(obj(c.rotation).targets), minutesEach: number(obj(c.rotation).minutesEach) }, followUp: on(obj(c.followUp).enabled), friendAccept: on(obj(c.friendAccept).enabled),
    dailySummary: set(c.dailySummaryAt), weeklySummary: !!c.weeklySummary, lightModelSet: set(c.lightModel), mediaAutoReplySet: set(c.mediaAutoReply), personaSet: !!c.persona
  };
}

function receptionSummary(r: Record<string, any>, now: Date) {
  const since = now.getTime() - 24 * 3600000, statuses: Record<string, number> = {}, codes: Record<string, number> = {};
  for (const j of Array.isArray(r.jobs) ? r.jobs : []) {
    const at = Date.parse(obj(j).createdAt); if (!(at >= since)) continue;
    const st = enumValue(obj(j).status, ['queued', 'generating', 'ready', 'sending', 'visually_confirmed', 'uncertain', 'handoff', 'failed']);
    statuses[st] = (statuses[st] ?? 0) + 1;
    if (st !== 'visually_confirmed') { const c = diagnosticCode(obj(j).detail); codes[c] = (codes[c] ?? 0) + 1; }
  }
  for (const e of Array.isArray(r.events) ? r.events : []) {
    const at = Date.parse(obj(e).at); if (!(at >= since) || !['deferred', 'handoff', 'retry', 'error'].includes(obj(e).type)) continue;
    const c = diagnosticCode(obj(e).detail); codes[c] = (codes[c] ?? 0) + 1;
  }
  const today = obj(obj(r.usage)[now.toISOString().slice(0, 10)]);
  return {
    last24h: statuses, topProblems: Object.entries(codes).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([code, n]) => ({ code, n })), today: { replies: number(today.replies), reads: number(today.reads) },
    receptionMode: enumValue(obj(r.config).receptionMode, ['inbox', 'selected']), inputMode: enumValue(obj(r.config).inputMode, ['pico-paste', 'pico-type', 'software', 'paste', 'type']), firstReplyAt: time(r.firstReplyAt)
  };
}

export function buildDiagnosticReport(input: { version: string; build: string; platform: string; workspace?: unknown; replies?: unknown; modelTiming?: unknown; environment?: unknown; entries: DiagnosticEntry[]; storageOk: boolean; now?: Date }): string {
  const w = obj(input.workspace), r = obj(input.replies), c = obj(r.config), p = obj(w.provider);
  const safeVersion = (s: string) => /^[\d.]+$/.test(s) ? s : 'unknown';
  const safeBuild = /^\d{8}-trial\.\d+$/.test(input.build) ? input.build : 'unknown';
  const events = (Array.isArray(r.events) ? r.events : []).slice(0, 30).map(e => ({ at: time(obj(e).at), type: enumValue(obj(e).type, ['handoff', 'error', 'deferred', 'resume', 'config', 'start', 'stop', 'pause', 'scan', 'confirmed', 'sent', 'generated']), code: diagnosticCode(obj(e).detail) }));
  const jobs = (Array.isArray(r.jobs) ? r.jobs : []).slice(0, 15).map(j => ({ status: enumValue(obj(j).status, ['queued', 'generating', 'ready', 'copied', 'sending', 'visually_confirmed', 'uncertain', 'handoff', 'failed']), createdAt: time(obj(j).createdAt), code: diagnosticCode(obj(j).detail) }));
  const report = {
    schema: 1, generatedAt: (input.now ?? new Date()).toISOString(), version: safeVersion(input.version), build: safeBuild, platform: enumValue(input.platform, ['win32', 'darwin', 'linux', 'browser']), logStorage: input.storageOk ? 'ok' : 'unavailable', workspaceAvailable: !!input.workspace, modelConfigured: p.hasKey === true, knowledgeItems: count(w.knowledge), tasks: count(w.tasks),
    reception: { available: !!input.replies, status: enumValue(r.status, ['running', 'paused', 'stopped', 'needs_attention']), busy: r.busy === true, cycle: number(r.cycle), lastScanAt: time(r.lastScanAt), reason: diagnosticCode(r.message), backend: enumValue(c.inputBackend, ['usb', 'software', 'windows']), mode: enumValue(c.mode, ['manual', 'auto']), pollSeconds: number(c.pollSeconds), configuredConversations: count(c.conversations) },
    environment: safeEnvironment(input.environment), summary: receptionSummary(r, input.now ?? new Date()), recentErrors: input.entries.filter(validDiagnosticEntry).slice(-50).map(e => ({ at: time(e.at), scope: e.scope, code: e.code })), events, jobs, modelTiming: safeModelTiming(input.modelTiming)
  };
  return '咔哒诊断日志（可复制给服务人员）\n已排除密钥、客户身份、聊天正文、截图、知识正文和本机路径。未自动上传。\n请另附：你做了什么、希望出现什么、实际出现什么。\n\n' + JSON.stringify(report, null, 2);
}
