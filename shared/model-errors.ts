import { focusLossDetail } from './focus-error';
import { productMessage } from './product-copy';
export const isTrialEndpoint = (_url?: string) => false;
export const TRIAL_REPLY_LIMIT = 0;
/** Removes anything that looks like a credential from provider text: OpenAI-style sk-…, Bearer tokens, relay keys,
 *  Zhipu id.secret, Baidu bce-v3/…, Google AIza…, kadadesk trial keys and long opaque tokens. */
export function scrubSecrets(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\bbce-v3\/[-_A-Za-z0-9./+=]{6,}/g, '')
    .replace(/\bAIza[-_A-Za-z0-9]{20,}/g, '')
    .replace(/\bkadatrial_[-_A-Za-z0-9]+/g, '')
    .replace(/\b[0-9a-f]{32}\.[A-Za-z0-9]{8,}/gi, '')
    .replace(/\bBearer\s*[-_A-Za-z0-9.]{6,}/gi, '')
    .replace(/\b(sk-|pm_live|pm_test)[-_A-Za-z0-9.]{6,}/g, '')
    .replace(/\b[-_A-Za-z0-9]{40,}\b/g, '');
}
/** The provider's own short reason (e.g. Zhipu {"error":{"code":"1302","message":"…并发数过高…"}}), cleaned for display:
 *  at most 80 characters, no URLs, nothing that looks like a key. Undefined when the body has none. */
export function providerReason(body: unknown): string | undefined {
  const first = Array.isArray(body) ? body[0] : body; // Gemini's OpenAI endpoint wraps the error in a one-item list.
  const e = (first as { error?: unknown } | null)?.error ?? first;
  const raw = typeof e === 'string' ? e : typeof (e as { message?: unknown })?.message === 'string' ? (e as { message: string }).message : undefined;
  const code = errorCode(body);
  if (!raw) return undefined;
  const text = scrubSecrets(raw).replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!text) return undefined;
  return code ? `${text}（代码 ${code.slice(0, 32)}）` : text;
}
/** The provider's error code (or OpenAI-style type when there is no code), as text. */
export function errorCode(body: unknown): string | undefined {
  const first = Array.isArray(body) ? body[0] : body;
  const e = (first as { error?: unknown } | null)?.error ?? first;
  if (!e || typeof e !== 'object') return undefined;
  const { code, type } = e as { code?: unknown; type?: unknown };
  const value = typeof code === 'string' || typeof code === 'number' ? String(code) : typeof type === 'string' ? type : undefined;
  return value && /^[\w.-]{1,40}$/.test(value) ? value : undefined;
}
/** Reads at most `max` bytes of an error response; returns the parsed JSON object, or undefined. */
export async function readErrorBody(response: { body?: ReadableStream<Uint8Array> | null }, max = 4096): Promise<unknown> {
  try {
    const reader = response.body?.getReader(); if (!reader) return undefined;
    const chunks: Uint8Array[] = []; let bytes = 0;
    while (bytes < max) { const part = await reader.read(); if (part.done) break; chunks.push(part.value); bytes += part.value.byteLength; }
    void reader.cancel().catch(() => {});
    const all = new Uint8Array(Math.min(bytes, max)); let at = 0;
    for (const c of chunks) { const piece = c.subarray(0, Math.max(0, all.length - at)); all.set(piece, at); at += piece.length; }
    const text = new TextDecoder().decode(all).trim();
    if (!text) return undefined;
    // Only a structured {error:{message,code}} is the provider's reason; plain text and HTML pages (proxies, gateways)
    // are never shown.
    try { const value = JSON.parse(text); return value && typeof value === 'object' ? value : undefined; } catch { return undefined; }
  } catch { return undefined; }
}

/**
 * What went wrong with a model call, in terms of what the owner has to do. The advice sentences below are also the
 * markers that let later layers (reception loop, alerts, plain talk) recognise the problem from the error text.
 */
export type ModelFailureKind = 'license' | 'trial-exhausted' | 'trial-unavailable' | 'trial-key' | 'trial-busy' | 'trial-down' | 'balance' | 'key' | 'not-found' | 'rate' | 'busy' | 'request';
export const MODEL_ADVICE: Record<ModelFailureKind, string> = {
  license: '咔哒软件试用次数用完了，购买并填写授权码后自动恢复。',
  'trial-exhausted': `免费试用模型的 ${TRIAL_REPLY_LIMIT} 条回复用完了：在「设置」一键配置自己的模型就能继续。`,
  'trial-unavailable': '免费试用通道暂未开通，请先在「设置」一键配置自己的模型（几分钟就好）。',
  'trial-key': '免费试用通道没认出这台电脑：请把咔哒更新到最新版本，或在「设置」一键配置自己的模型。',
  'trial-busy': '免费试用模型此刻太忙，咔哒会稍后自动重试；急用的话在「设置」一键配置自己的模型。',
  'trial-down': '免费试用模型暂时连不上，咔哒会自动重试；急用的话在「设置」一键配置自己的模型。',
  balance: '模型账号余额不足或已欠费：到服务商后台充值，或在「设置」一键配置换一家；充值后咔哒会自动继续。',
  key: '模型 Key 不对或没开通：到「设置 → 一键配置模型」重新粘贴 Key；Key 没问题的话，到服务商后台确认这个模型已开通、有调用权限。',
  'not-found': '模型名称或接口地址不对：到「设置」重新点「一键配置」。',
  rate: '模型服务限流，咔哒会放慢重试。',
  busy: '模型服务暂时不可用，咔哒会自动重试。',
  request: '模型服务拒绝了这次请求：到「设置」重新点「一键配置」，或换一个模型。',
};
/** Problems only the owner can fix (pay, license, key, setup): retrying does not help. */
export const ACCOUNT_KINDS: ReadonlySet<ModelFailureKind> = new Set(['license', 'trial-exhausted', 'trial-unavailable', 'trial-key', 'balance', 'key']);
const BALANCE_CODES = /^(insufficient_quota|insufficient_balance|insufficient_credits|exceeded_current_quota_error|Arrearage|1113|30001|payment_required|billing_hard_limit_reached)$/i;
const BALANCE_TEXT = /insufficient[_ ](balance|quota|credits?|funds)|余额不足|已欠费|欠费|arrearage|account.{0,40}(suspended|in good standing)|账户.{0,6}(欠费|余额)|balance.{0,20}(not enough|insufficient)/i;
/** Out of money on the provider account, whatever HTTP status it arrives with (OpenAI/Kimi send 429, Aliyun 400, SiliconFlow 403). */
export function isBalanceFailure(status: number, body: unknown): boolean {
  if (status === 402) return true;
  const code = errorCode(body); if (code && BALANCE_CODES.test(code)) return true;
  const first = Array.isArray(body) ? body[0] : body; const e = (first as { error?: unknown } | null)?.error ?? first;
  const message = typeof e === 'string' ? e : typeof (e as { message?: unknown })?.message === 'string' ? (e as { message: string }).message : '';
  return BALANCE_TEXT.test(message);
}
export type ModelFailure = { kind: ModelFailureKind; retryable: boolean; advice: string; reason?: string; status: number };
/** Classifies a failed chat-completions response. `baseUrl` decides whether kadadesk's free trial relay answered. */
export function classifyModelFailure(status: number, body: unknown, baseUrl?: string): ModelFailure {
  const reason = providerReason(body), code = errorCode(body);
  // Zhipu's own codes (1302 concurrency, 1304 daily free limit…) say more than the HTTP status.
  const zhipu = code ? zhipuHint(code) : undefined;
  const make = (kind: ModelFailureKind, retryable: boolean): ModelFailure => ({ kind, retryable, advice: zhipu && !ACCOUNT_KINDS.has(kind) ? zhipu : MODEL_ADVICE[kind], ...(reason ? { reason } : {}), status });
  if (isTrialEndpoint(baseUrl)) {
    if (code === 'trial_exhausted' || status === 402) return make('trial-exhausted', false);
    if (code === 'trial_unavailable' || code === 'not_found' || status === 404 || status === 503) return make('trial-unavailable', false);
    if (code === 'bad_trial_key' || status === 401 || status === 403) return make('trial-key', false);
    if (status === 429) return make('trial-busy', true);
    if (status >= 500 || status === 408) return make('trial-down', true);
    return make('request', false);
  }
  if (isBalanceFailure(status, body)) return make('balance', false);
  if (status === 401 || status === 403) return make('key', false);
  if (status === 404) return make('not-found', false);
  if (status === 429) return make('rate', true);
  if (status >= 500 || status === 408) return make('busy', true);
  return make('request', false);
}
/** One line for logs and the UI: what to do, then the provider's own words. */
export function modelFailureText(f: ModelFailure): string {
  return `${f.advice}${f.reason ? `　服务商原话：${f.reason}` : ''}`;
}
const KIND_MARKERS: Array<[ModelFailureKind, RegExp]> = [
  ['trial-exhausted', /免费试用模型的 ?\d+ ?条回复用完|trial_exhausted/],
  ['license', /咔哒软件试用次数用完|免费试用额度已用尽/],
  ['trial-unavailable', /免费试用通道暂未开通|trial_unavailable/],
  ['trial-key', /免费试用通道没认出|bad_trial_key/],
  ['trial-busy', /免费试用模型此刻太忙/],
  ['trial-down', /免费试用模型暂时连不上/],
  // Only model-error wording: a customer keyword such as 「余额不足」 in a handoff reason must not read as a model problem.
  ['balance', /模型账号余额不足|insufficient_quota|代码 1113|Arrearage/i],
  ['key', /模型 Key 不对或没开通/],
];
/** Recognises an owner-actionable model problem from an error message built by this module (or legacy wording). */
export function modelFailureKind(message: string | undefined): ModelFailureKind | undefined {
  if (!message) return undefined;
  for (const [kind, marker] of KIND_MARKERS) if (marker.test(message)) return kind;
  return undefined;
}

/** Fixed outside kadadesk by the owner (buy a license, pay the provider, set up an own model): reception keeps waiting
 *  quietly and resumes by itself once the next model call works. */
export const WAIT_FOR_OWNER: ReadonlySet<ModelFailureKind> = new Set(['license', 'trial-exhausted', 'balance']);
/** A wrong key or an unopened trial channel never heals by retrying: stop reception after this many rounds in a row. */
export const STOP_AFTER_ROUNDS = 3;
/** What the reception loop does with a whole-cycle model failure: wait for the owner, retry, or stop with the fix. */
export function modelRoundVerdict(message: string): 'wait' | 'stop' | 'retry' {
  const kind = modelFailureKind(message);
  if (/HTTP 402/.test(message) || (kind && WAIT_FOR_OWNER.has(kind))) return 'wait';
  return kind && ACCOUNT_KINDS.has(kind) ? 'stop' : 'retry';
}
/** Plain hint for the common Zhipu (bigmodel.cn) error codes; free Flash models mostly fail on concurrency. */
export function zhipuHint(code: string): string | undefined {
  return ({ '1113': '账号余额不足或已欠费：免费模型也需要账号状态正常，请到智谱控制台查看。', '1302': '同时调用的请求太多：免费模型能同时处理的请求很少，咔哒忙的时候会撞上这个限制。', '1303': '调用太频繁：免费模型每分钟能用的次数有限，稍等一会儿再试。', '1304': '今天的免费调用次数用完了，明天会恢复，或在智谱控制台开通付费额度。', '1305': '智谱这个模型现在访问的人太多，稍后再试。' } as Record<string, string>)[code];
}
export function visionHttpIssue(status: number, reason?: string, baseUrl?: string): string {
  const detail: Record<number, string> = {
    401: '密钥认证失败，请核对服务商、地区和 API Key',
    402: '模型账号余额不足或已欠费，请到服务商后台充值，或换一家已充值的服务',
    403: '模型访问被拒绝，请在服务商控制台开通此模型，并确认 API Key 有调用权限',
    404: '模型名称或接口地址不对，请从服务商后台复制准确的模型名称',
    429: '额度不足或调用受限，请检查账号额度和频率限制',
    503: '模型服务繁忙，请稍后重试或选择其他已开通的视觉模型',
  };
  const code = reason && /（代码 ([\w.-]+)）/.exec(reason)?.[1];
  const hint = code ? zhipuHint(code) : undefined;
  // The trial relay and out-of-balance answers have one clear next step, whatever the status.
  const body = code ? { error: { code, message: reason } } : reason ? { error: { message: reason } } : undefined;
  const failure = isTrialEndpoint(baseUrl) || (status !== 402 && isBalanceFailure(status, body)) ? classifyModelFailure(status, body, baseUrl) : undefined;
  const text = hint ?? failure?.advice.replace(/。$/, '') ?? detail[status] ?? '服务商请求失败，请核对接口配置';
  return `图片测试未通过：${text}（HTTP ${status}）${reason ? `　服务商原话：${reason}` : ''}`;
}
export function readableModelError(error: unknown): string {
  const message = error instanceof Error ? error.message : '模型操作失败';
  if(/AbortError|operation (?:was )?(?:aborted|cancelled)|request aborted/i.test(message))return '操作已停止。请先核对当前输入框和发送记录，再决定是否重新开始。';
  if(message.includes('Windows 已锁屏'))return 'Windows 已锁屏，咔哒已停止后续操作。请解锁后重新启动，先核对未完成任务。';
  if(message.includes('selected window lost focus'))return '目标窗口失去焦点，咔哒已停止操作。' + focusLossDetail(message) + '请重新启动。';
  if(message.includes('selected window is minimized'))return '聊天窗口被最小化了，咔哒看不到画面。请把聊天软件窗口打开（不要最小化），咔哒会自动接上。';
  if(message.includes('conversation header changed'))return '会话标题发生变化或被遮挡，已停止操作；未继续输入或发送。';
  if(message.includes('change=title'))return '浏览器标签页或窗口标题在核验期间发生变化，已停止。请保持目标页面可见后重新检查。';
  if(message.includes('change=size'))return '目标窗口大小在核验期间发生变化，已停止。请待窗口稳定后重新检查。';
  if(message.includes('selected window identity changed; select it again'))return '所选窗口或浏览器标签页已变化，请刷新并选择当前目标页面。';
  if(message.includes('selected window identity or size changed'))return '目标窗口身份或尺寸已变化，请刷新窗口并重新校准。';
  if(message.includes('selected window is unavailable'))return '目标窗口不可用，请刷新后重新选择。';
  return productMessage(message);
}
