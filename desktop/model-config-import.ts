const validateVision = (v: any) => v;
type VisionSettings = any;
type VisionSettingsInput = any;
/**
 * 一键配置模型（desktop 侧）：选服务商 + 粘贴 Key、导入配置文件 / 粘贴配置、登录拿到的 Key，都走这里保存：
 * 先列出服务的模型、挑好看屏幕和写回复的模型，再分别存进画面识别配置和回复模型配置（各自的加密存储）。
 * 密钥只进不出：返回给界面的结果、导出的配置文件里都没有密钥。
 */
import { findProvider, pickModels, providerForBaseUrl, providerForVisionId, type ModelConfigFile, type ModelProvider, type ModelSetupRequest, type ModelSetupResult } from '../shared/model-providers';
import { chatCompletionsUrl } from './reply-model';
import { classifyModelFailure, modelFailureText, readErrorBody } from '../shared/model-errors';

const BAD_FILE = '这不是咔哒的配置文件，请向服务人员确认。';
export const isLoopbackUrl = (url: string) => /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(url);
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** A parsed configuration. Keys stay inside the desktop process. */
export type ParsedModelConfig = { provider: ModelProvider; name?: string; baseUrl: string; visionModel: string; textModel: string; apiKey?: string; text?: { provider: ModelProvider; baseUrl: string; apiKey?: string } };

const str = (v: unknown, max: number) => { if (v === undefined || v === null) return ''; if (typeof v !== 'string' || v.length > max) throw new Error(BAD_FILE); return v.trim(); };
/** Same rule as the vision and reply model settings: HTTPS, or plain HTTP only on this computer; no credentials or query in the URL. */
function checkUrl(_provider: ModelProvider, baseUrl: string) {
  try {
    const u = new URL(baseUrl);
    const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(u.hostname);
    if (!['https:', 'http:'].includes(u.protocol)) throw new Error('接口地址协议无效');
    if (u.protocol === 'http:' && !local) throw new Error('远程服务地址必须使用 https:// 开头');
    if (u.username || u.password) throw new Error('接口地址不能包含用户名或密码');
    if (u.search || u.hash) throw new Error('接口地址不能包含参数或哈希');
    const path = u.pathname.replace(/\/+$/, '').toLowerCase();
    if (/\/images(?:\/(?:generations|edits|variations))?$/.test(path)) throw new Error('请填写服务商的基础地址（Base URL），不要填写 /images');
    if (/\/chat\/completions$/.test(path)) throw new Error('请填写基础地址（Base URL），去掉末尾 /chat/completions');
    return baseUrl.replace(/\/+$/, '');
  } catch (e) {
    throw new Error((e as Error).message || '接口地址不对，请填写以 https:// 开头的完整地址。');
  }
}
function decode(text: string): unknown {
  const t = text.trim(); const tries = [t];
  const a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a >= 0 && b > a) tries.push(t.slice(a, b + 1));
  const token = t.split(/[\s?#&:/]+/).filter(Boolean).pop() ?? '';
  for (const raw of [t, token, token.replace(/^(?:config|data|c)=/i, '')]) if (/^[A-Za-z0-9+/_-]{16,}={0,2}$/.test(raw)) { try { tries.push(Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch { /* not base64 */ } }
  for (const s of tries) { try { const v = JSON.parse(s); if (v && typeof v === 'object' && !Array.isArray(v)) return v; } catch { /* next */ } }
  throw new Error(BAD_FILE);
}
/**
 * Accepts { kadadesk: 'model-config', version: 1, provider, baseUrl, visionModel, textModel, apiKey? } (optionally textProvider /
 * textBaseUrl / textApiKey when replies use another service), the older { kadadeskPreset: 1, name, baseUrl, model, visionModel?, apiKey? },
 * pasted text that contains either, or the same JSON base64-encoded (a share string).
 */
export function parseModelConfig(text: string): ParsedModelConfig {
  if (typeof text !== 'string' || !text.trim() || text.length > 20000) throw new Error(BAD_FILE);
  const v = decode(text) as Record<string, unknown>;
  const pick = (...names: string[]) => names.map(n => v[n]).find(x => x !== undefined);
  let providerId: string, baseUrl: string, visionModel: string, textModel: string;
  if (v.kadadesk === 'model-config') {
    if (v.version !== 1) throw new Error('这个配置文件来自更新版本的咔哒，请先升级咔哒。');
    providerId = str(v.provider, 100); baseUrl = str(pick('baseUrl', 'baseURL', 'base_url'), 500); visionModel = str(v.visionModel, 200); textModel = str(v.textModel, 200);
  } else if (v.kadadeskPreset === 1) {
    providerId = ''; baseUrl = str(pick('baseUrl', 'baseURL', 'base_url'), 500); textModel = str(v.model, 200); visionModel = str(v.visionModel, 200) || textModel;
    if (!textModel) throw new Error(BAD_FILE);
  } else throw new Error(BAD_FILE);
  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) throw new Error(BAD_FILE);
  const provider = findProvider(providerId) ?? (baseUrl ? providerForBaseUrl(baseUrl) : undefined) ?? (baseUrl ? findProvider('custom') : undefined);
  if (!provider) throw new Error('配置文件里的服务商咔哒不认识，请向服务人员确认。');
  const url = checkUrl(provider, baseUrl || provider.baseUrl || 'https://');
  const apiKey = str(pick('apiKey', 'api_key', 'key'), 1000) || undefined;
  const name = str(v.name, 100) || undefined;
  let textPart: ParsedModelConfig['text'];
  const textBase = str(pick('textBaseUrl', 'textBaseURL'), 500);
  if (textBase) {
    const tp = findProvider(str(v.textProvider, 100)) ?? providerForBaseUrl(textBase) ?? findProvider('custom')!;
    const tUrl = checkUrl(tp, textBase);
    if (tUrl !== url) textPart = { provider: tp, baseUrl: tUrl, apiKey: str(v.textApiKey, 1000) || undefined };
  }
  return { provider, ...(name ? { name } : {}), baseUrl: url, visionModel: provider.visionCapable ? visionModel : '', textModel, ...(apiKey ? { apiKey } : {}), ...(textPart ? { text: textPart } : {}) };
}
/** What the card may show about a parsed file: never the key. */
export const describeConfig = (c: ParsedModelConfig) => ({ provider: c.provider.id, label: c.name || c.provider.label, baseUrl: c.baseUrl, visionModel: c.visionModel, textModel: c.textModel, hasKey: Boolean(c.apiKey) });

/** 导出配置（不含密钥）: the active screen-reading profile plus the reply model, in the import format. */
export function exportModelConfig(vision: VisionSettings, text: { baseUrl: string; model: string; hasKey: boolean }): ModelConfigFile {
  const active = vision.profiles.find((p: any) => p.id === vision.activeId);
  const native = vision.activeId === 'gemini';
  const vp = native ? findProvider('gemini')! : providerForVisionId(vision.activeId) ?? findProvider('custom')!;
  const visionOk = !!active && !!active.model && !!active.baseUrl && (active.hasKey || isLoopbackUrl(active.baseUrl));
  const visionBase = native ? vp.baseUrl : active?.baseUrl ?? '';
  const textOk = !!text.model && !!text.baseUrl && (text.hasKey || isLoopbackUrl(text.baseUrl));
  if (!visionOk && !textOk) throw new Error('还没有配好自己的模型，没有可导出的配置。');
  const baseUrl = visionOk ? visionBase : text.baseUrl;
  const provider = visionOk ? vp.id : providerForBaseUrl(text.baseUrl)?.id ?? 'custom';
  const textElsewhere = textOk && text.baseUrl.replace(/\/+$/, '') !== baseUrl.replace(/\/+$/, '');
  return { kadadesk: 'model-config', version: 1, provider, baseUrl, visionModel: visionOk ? active!.model : '', textModel: textOk ? text.model : '', ...(textElsewhere ? { textProvider: providerForBaseUrl(text.baseUrl)?.id ?? 'custom', textBaseUrl: text.baseUrl } : {}) };
}

/** Names of the models the service offers (GET {base}/models). Never follows redirects; names only. */
export async function listModels(fetch: Fetch, baseUrl: string, apiKey?: string): Promise<string[]> {
  const response = await fetch(baseUrl.replace(/\/+$/, '') + '/models', { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
  const text = await response.text(); if (text.length > 2_000_000) throw new Error('too large');
  const data = JSON.parse(text); const list = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : Array.isArray(data) ? data : [];
  return list.map((m: any) => typeof m === 'string' ? m : m?.id ?? m?.name).filter((id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length < 200).map((id: string) => id.replace(/^models\//, '')).slice(0, 1000);
}

/**
 * One tiny real text call to the reply model before anything is saved: a key that lists models can still be unable to
 * chat (no balance, model not enabled, wrong name). Returns undefined when it answered, else a plain reason.
 */
export async function checkTextModel(fetch: Fetch, baseUrl: string, model: string, apiKey?: string): Promise<string | undefined> {
  const send = (limit: boolean) => fetch(chatCompletionsUrl(new URL(baseUrl)).href, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify({ model, temperature: 0, ...(limit ? { max_tokens: 32 } : {}), messages: [{ role: 'user', content: '这是连接测试，请只回复：好' }] }) });
  try {
    let response = await send(true);
    // Some models refuse max_tokens (they want max_completion_tokens); ask once more without it.
    if (response.status === 400) { await response.body?.cancel().catch(() => {}); response = await send(false); }
    if (!response.ok) return modelFailureText(classifyModelFailure(response.status, await readErrorBody(response), baseUrl)) + `（HTTP ${response.status}）`;
    const text = await response.text(); if (text.length > 200_000) return '模型返回内容异常。';
    const json = JSON.parse(text) as { choices?: unknown };
    return Array.isArray(json.choices) && json.choices.length ? undefined : '模型没有给出回答，请换一个能聊天的模型。';
  } catch (error) {
    return (error as Error)?.name === 'TimeoutError' || (error as Error)?.name === 'AbortError' ? '模型 30 秒内没有回答：这个模型太慢或服务连不上，换一个更快的模型再试。' : '连不上这个服务：请检查接口地址和网络。';
  }
}

export type ModelSetupDeps = {
  fetch: Fetch;
  visionSettings(): Promise<VisionSettings>;
  textProvider(): Promise<{ baseUrl: string; model: string; temperature: number; hasKey: boolean }>;
  /** Saves the screen-reading profile and its key (desktop/vision-settings.ts). */
  saveVision(input: VisionSettingsInput): Promise<unknown>;
  /** Saves the reply model and its key (server PUT /settings); no apiKey means a keyless local service. */
  saveText(input: { baseUrl: string; model: string; temperature: number; apiKey?: string }): Promise<unknown>;
  /** Runs saves only while reception is paused. */
  guard<T>(fn: () => Promise<T>): Promise<T>;
  /** The digit-card picture test (desktop/vision-test.ts) on not-yet-saved credentials; throws a plain reason. */
  testVision?(credentials: { baseUrl: string; model: string; apiKey?: string }): Promise<{ durationMs: number }>;
};
type Apply = { provider: ModelProvider; baseUrl: string; apiKey?: string; visionModel?: string; textModel?: string; label?: string; text?: { provider: ModelProvider; baseUrl: string; apiKey?: string } };

export function createModelSetup(deps: ModelSetupDeps) {
  let busy = false;
  const result = (a: Apply, extra: Partial<ModelSetupResult> & { message: string }): ModelSetupResult => ({ ok: false, provider: a.provider.id, label: a.label || a.provider.label, visionSaved: false, textSaved: false, ...extra });
  async function apply(a: Apply): Promise<ModelSetupResult> {
    if (busy) throw new Error('正在配置模型，请稍等。');
    busy = true;
    try {
      const baseUrl = checkUrl(a.provider, a.baseUrl);
      const key = a.apiKey?.trim() || undefined;
      if (!key && !isLoopbackUrl(baseUrl)) return result(a, { needsKey: true, message: '还差一步：请粘贴这个服务的 API Key。' });
      if (key && (key.length > 1000 || /\s/.test(key))) throw new Error('Key 的格式不对：请只复制 Key 本身，不要带空格或换行。');
      const textUrl = a.text ? checkUrl(a.text.provider, a.text.baseUrl) : undefined;
      const textKey = a.text ? (a.text.apiKey?.trim() || (new URL(textUrl!).origin === new URL(baseUrl).origin ? key : undefined)) : key;
      if (a.text && !textKey && !isLoopbackUrl(textUrl!)) return result(a, { needsKey: true, message: '配置文件里缺少写回复那家服务的 Key，请向服务人员要一份带 Key 的配置文件。' });
      const want = { visionCapable: a.provider.visionCapable && !!a.provider.visionId, visionModel: a.visionModel?.trim() || a.provider.visionModel, textModel: a.textModel?.trim() || (a.text ? '' : a.provider.textModel) };
      const explicit = !!a.visionModel?.trim() && (!!a.textModel?.trim() || !!a.text);
      let listed: string[] | undefined;
      if (!explicit && a.provider.listsModels) {
        try { listed = await listModels(deps.fetch, baseUrl, key); }
        catch (e) { const status = (e as { status?: number }).status; if (status === 401 || status === 403) return result(a, { needsKey: true, message: '这个 Key 没通过服务商验证：请检查是否复制完整、是否已充值或开通。' }); }
      }
      const picked = pickModels(want, listed);
      const visionModel = a.visionModel?.trim() || picked.visionModel;
      const textModel = a.text ? a.textModel?.trim() ?? '' : a.textModel?.trim() || picked.textModel;
      if (!visionModel && !textModel) return result(a, { needsModel: true, listed: listed?.length, message: listed?.length ? '这个服务里没认出合适的模型，请把要用的模型名称填进来再点一次。' : '这个服务没有给出模型列表，请把服务商后台里的模型名称填进来再点一次。' });
      const visionInput = visionModel && a.provider.visionId ? validateVision({ id: a.provider.visionId, baseUrl, model: visionModel, ...(key ? { apiKey: key } : {}) }) : undefined;
      // Nothing is saved until the reply model has actually answered: a working setup is never replaced by a broken one.
      if (textModel) {
        const problem = await checkTextModel(deps.fetch, textUrl ?? baseUrl, textModel, textKey);
        if (problem) return result(a, { textModel, listed: listed?.length, ...(/Key 不对/.test(problem) ? { needsKey: true } : /模型名称|接口地址不对|拒绝了这次请求/.test(problem) ? { needsModel: true } : {}),
          message: `没有保存：写回复的模型（${textModel}）试了一句话没成功，原来的设置保持不变。${problem}` });
      }
      // The picture test also runs before saving: a screen-reading model that cannot read the digit card does not replace
      // the one in use. The reply model (already checked) is still saved, and the result says exactly what works.
      let visionProblem: string | undefined, visionTestMs: number | undefined;
      if (visionInput && deps.testVision) {
        try { visionTestMs = (await deps.testVision({ baseUrl: visionInput.baseUrl, model: visionInput.model, ...(visionInput.apiKey ? { apiKey: visionInput.apiKey } : {}) })).durationMs; }
        catch (error) { visionProblem = (error instanceof Error ? error.message : '').replace(/^图片测试未通过：/, '') || '图片测试没通过'; }
      }
      const saveVision = visionInput && !visionProblem ? visionInput : undefined;
      const label = a.label || a.provider.label;
      if (visionProblem && !textModel) return result(a, { visionModel, listed: listed?.length, visionProblem, message: `没有保存：看屏幕的模型（${visionModel}）图片测试没通过，原来的设置保持不变。${visionProblem}` });
      const current = await deps.textProvider();
      await deps.guard(async () => {
        if (saveVision) await deps.saveVision(saveVision);
        if (textModel) await deps.saveText({ baseUrl: textUrl ?? baseUrl, model: textModel, temperature: current.temperature, ...(textKey ? { apiKey: textKey } : {}) });
      });
      const message = visionProblem ? `只配好了一半：写回复已换成「${label}」的 ${textModel}（试过一句话，能用）；看屏幕的 ${visionModel} 图片测试没通过，所以看屏幕继续用原来的模型。${visionProblem}`
        : saveVision && textModel ? `已配好「${label}」：看屏幕用 ${visionModel}，写回复用 ${textModel}（都试过，能用）。`
        : saveVision ? `已配好「${label}」看屏幕（${visionModel}）；写回复保持原来的设置。`
        : `已配好「${label}」写回复（${textModel}，试过一句话，能用）；${a.provider.visionCapable ? '这个服务里没找到能看图的模型，' : ''}看屏幕继续用现在的模型。`;
      return { ok: true, provider: a.provider.id, label, visionModel: saveVision ? visionModel : undefined, textModel: textModel || undefined, visionSaved: !!saveVision, textSaved: !!textModel, listed: listed?.length, message,
        ...(visionTestMs !== undefined ? { visionTestMs } : {}), ...(visionProblem ? { visionProblem } : {}) };
    } finally { busy = false; }
  }
  return {
    /** 选服务商 → 粘贴 Key → 一键配好. */
    async setup(input: unknown) {
      const r = (input ?? {}) as ModelSetupRequest;
      const provider = findProvider(typeof r.provider === 'string' ? r.provider : undefined); if (!provider) throw new Error('请先选择服务商。');
      for (const v of [r.apiKey, r.baseUrl, r.visionModel, r.textModel]) if (v !== undefined && (typeof v !== 'string' || v.length > 1000)) throw new Error('填写的内容格式不对，请重新填写。');
      const rawBase = r.baseUrl?.trim() || provider.baseUrl; if (!rawBase) throw new Error('请填写接口地址（服务商给的网址，一般以 /v1 结尾）。');
      const baseUrl = checkUrl(provider, rawBase);
      return apply({ provider, baseUrl, apiKey: r.apiKey, visionModel: r.visionModel, textModel: r.textModel });
    },
    /** 导入配置文件 / 粘贴配置. apiKey: pasted when the file was exported without one. */
    async importConfig(text: unknown, apiKey?: unknown) {
      if (typeof text !== 'string') throw new Error(BAD_FILE);
      if (apiKey !== undefined && apiKey !== null && (typeof apiKey !== 'string' || apiKey.length > 1000)) throw new Error('Key 的格式不对。');
      const c = parseModelConfig(text);
      return apply({ provider: c.provider, baseUrl: c.baseUrl, apiKey: c.apiKey || (apiKey as string | undefined) || undefined, visionModel: c.visionModel, textModel: c.textModel, label: c.name, text: c.text });
    },
    async exportConfig() { return exportModelConfig(await deps.visionSettings(), await deps.textProvider()); },
  };
}

/** IPC channels for the card (shared/vision-settings.ts VisionBridge: setup / importConfig / exportConfig / login). */
export function registerModelSetup(o: { handle(channel: string, fn: (...args: unknown[]) => Promise<unknown>): void; setup: ReturnType<typeof createModelSetup>; login(provider: 'openrouter'): Promise<string> }) {
  o.handle('flowdesk:model:setup', input => o.setup.setup(input));
  o.handle('flowdesk:model:import', (text, apiKey) => o.setup.importConfig(text, apiKey));
  o.handle('flowdesk:model:export', () => o.setup.exportConfig());
  // The key from the login never leaves the desktop process: it goes straight into the same save path as a pasted key.
  o.handle('flowdesk:model:login', async provider => { if (provider !== 'openrouter') throw new Error('这个服务商不支持登录，请粘贴 Key。'); return o.setup.setup({ provider: 'openrouter', apiKey: await o.login('openrouter') }); });
}
