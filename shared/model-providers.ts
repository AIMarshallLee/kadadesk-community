/**
 * 模型服务商目录：「一键配置模型」卡片和高级表单共用。每家都走 OpenAI 兼容接口（Chat Completions + 可选的 /models）。
 * 模型名只写确定存在的；留空时由「一键配好」从服务的模型列表里挑（见 pickModels）。visionId 是画面识别配置里保存密钥的档位
 * （shared/vision-settings.ts 的 visionPresets）；没有 visionId 的服务商只能写回复，不能看屏幕。
 */
export type VisionProviderId = string;

export type ProviderKind = 'direct' | 'relay' | 'local' | 'custom';
export type ModelProvider = {
  id: string; label: string; region: 'cn' | 'global'; kind: ProviderKind;
  /** OpenAI-compatible base URL (no /chat/completions); '' = the user types it. */
  baseUrl: string; visionModel: string; textModel: string;
  visionCapable: boolean; listsModels: boolean; needsKey: boolean;
  /** Where to get the key, short plain words. */
  keyHint: string; signupUrl: string;
  visionId?: VisionProviderId;
  /** 登录方式: the provider officially issues a key to a desktop app through OAuth. */
  login?: 'openrouter';
  /** Shown only on machines that turned on the internal switch (kada-internal) or already use it. */
  internal?: boolean;
  /** Older ids that saved settings or config files may still use. */
  aliases?: string[];
};

const p = (v: Omit<ModelProvider, 'visionCapable' | 'listsModels' | 'needsKey'> & Partial<Pick<ModelProvider, 'visionCapable' | 'listsModels' | 'needsKey'>>): ModelProvider => ({ visionCapable: true, listsModels: true, needsKey: true, ...v });

export const modelProviders: readonly ModelProvider[] = [
  // 国内直连
  p({ id: 'zhipu-cn', label: '智谱 GLM', region: 'cn', kind: 'direct', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', visionModel: 'glm-4.6v-flash', textModel: 'glm-4.7-flash', listsModels: false, keyHint: '登录智谱开放平台 → 右上角「API Key」→ 新建并复制。', signupUrl: 'https://open.bigmodel.cn', visionId: 'zhipu-cn', aliases: ['zhipu'] }),
  p({ id: 'qwen-cn', label: '阿里云百炼 · 通义', region: 'cn', kind: 'direct', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', visionModel: 'qwen3-vl-plus', textModel: 'qwen-plus', keyHint: '打开百炼控制台 → 「API-KEY」→ 创建并复制。', signupUrl: 'https://bailian.console.aliyun.com', visionId: 'qwen-cn', aliases: ['qwen', 'bailian', 'dashscope'] }),
  p({ id: 'doubao-cn', label: '火山方舟 · 豆包', region: 'cn', kind: 'direct', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', visionModel: '', textModel: '', listsModels: false, keyHint: '火山方舟控制台 → 「API Key 管理」新建；再到「开通管理」开通要用的模型，并把模型名填进来。', signupUrl: 'https://console.volcengine.com/ark', visionId: 'doubao-cn', aliases: ['doubao', 'ark', 'volcengine'] }),
  p({ id: 'deepseek', label: 'DeepSeek（只能写回复）', region: 'cn', kind: 'direct', baseUrl: 'https://api.deepseek.com/v1', visionModel: '', textModel: 'deepseek-chat', visionCapable: false, keyHint: 'DeepSeek 开放平台 → 「API keys」→ 创建并复制。看屏幕继续用现在的模型。', signupUrl: 'https://platform.deepseek.com' }),
  p({ id: 'kimi-cn', label: '月之暗面 Kimi', region: 'cn', kind: 'direct', baseUrl: 'https://api.moonshot.cn/v1', visionModel: '', textModel: '', keyHint: 'Kimi 开放平台 → 「API Key 管理」→ 新建并复制。', signupUrl: 'https://platform.moonshot.cn', visionId: 'kimi-cn', aliases: ['moonshot', 'kimi'] }),
  p({ id: 'minimax-cn', label: 'MiniMax', region: 'cn', kind: 'direct', baseUrl: 'https://api.minimaxi.com/v1', visionModel: '', textModel: '', listsModels: false, keyHint: 'MiniMax 开放平台 → 「接口密钥」→ 创建并复制。', signupUrl: 'https://platform.minimaxi.com', visionId: 'minimax-cn', aliases: ['minimax'] }),
  p({ id: 'hunyuan-cn', label: '腾讯混元', region: 'cn', kind: 'direct', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', visionModel: 'hunyuan-vision', textModel: '', listsModels: false, keyHint: '腾讯云控制台 → 混元大模型 → 「API KEY 管理」→ 创建并复制。', signupUrl: 'https://console.cloud.tencent.com/hunyuan', visionId: 'hunyuan-cn', aliases: ['hunyuan'] }),
  p({ id: 'qianfan-cn', label: '百度千帆', region: 'cn', kind: 'direct', baseUrl: 'https://qianfan.baidubce.com/v2', visionModel: '', textModel: '', listsModels: false, keyHint: '千帆控制台 → 「API Key」→ 创建并复制（以 bce-v3/ 开头）。', signupUrl: 'https://console.bce.baidu.com/qianfan', visionId: 'qianfan-cn', aliases: ['qianfan', 'ernie'] }),
  // 国际直连
  p({ id: 'gemini', label: 'Google Gemini', region: 'global', kind: 'direct', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', visionModel: 'gemini-3.8-flash', textModel: 'gemini-3.8-flash', keyHint: 'Google AI Studio → 「Get API key」→ 创建并复制。', signupUrl: 'https://aistudio.google.com/apikey', visionId: 'gemini-openai', aliases: ['gemini-openai', 'google'] }),
  p({ id: 'openai', label: 'OpenAI', region: 'global', kind: 'direct', baseUrl: 'https://api.openai.com/v1', visionModel: 'gpt-4o-mini', textModel: 'gpt-4o-mini', keyHint: 'OpenAI 平台 → 「API keys」→ Create new secret key。', signupUrl: 'https://platform.openai.com/api-keys', visionId: 'openai' }),
  p({ id: 'anthropic', label: 'Anthropic Claude', region: 'global', kind: 'direct', baseUrl: 'https://api.anthropic.com/v1', visionModel: '', textModel: '', listsModels: false, keyHint: 'Claude 开发者平台 → 「API Keys」→ Create Key。模型名请从平台的模型列表里复制。', signupUrl: 'https://console.anthropic.com', visionId: 'anthropic', aliases: ['claude'] }),
  p({ id: 'xai', label: 'xAI Grok', region: 'global', kind: 'direct', baseUrl: 'https://api.x.ai/v1', visionModel: '', textModel: '', keyHint: 'xAI 控制台 → 「API Keys」→ 创建并复制。', signupUrl: 'https://console.x.ai', visionId: 'xai', aliases: ['grok'] }),
  p({ id: 'groq', label: 'Groq', region: 'global', kind: 'direct', baseUrl: 'https://api.groq.com/openai/v1', visionModel: '', textModel: '', keyHint: 'Groq 控制台 → 「API Keys」→ Create API Key。', signupUrl: 'https://console.groq.com/keys', visionId: 'groq' }),
  p({ id: 'together', label: 'Together AI', region: 'global', kind: 'direct', baseUrl: 'https://api.together.xyz/v1', visionModel: '', textModel: '', keyHint: 'Together 控制台 → 「API Keys」→ 复制。', signupUrl: 'https://api.together.ai', visionId: 'together' }),
  // 中转站 / 聚合
  p({ id: 'pixmind', label: '中转站（推荐）', region: 'global', kind: 'relay', baseUrl: 'https://aihub-admin.aimix.pro/api-platform/v1', visionModel: 'gemini-3.5-flash', textModel: 'gemini-3.5-flash', keyHint: '在中转站网站上新建一个密钥（以 pm_live_ 之类开头），复制下来。', signupUrl: '', visionId: 'pixmind' }),
  p({ id: 'siliconflow-cn', label: '硅基流动 SiliconFlow', region: 'cn', kind: 'relay', baseUrl: 'https://api.siliconflow.cn/v1', visionModel: 'Qwen/Qwen3-VL-32B-Instruct', textModel: 'deepseek-ai/DeepSeek-V3', keyHint: '硅基流动控制台 → 「API 密钥」→ 新建并复制。', signupUrl: 'https://cloud.siliconflow.cn', visionId: 'siliconflow-cn', aliases: ['siliconflow'] }),
  p({ id: 'openrouter', label: 'OpenRouter（一个 Key 用很多模型）', region: 'global', kind: 'relay', baseUrl: 'https://openrouter.ai/api/v1', visionModel: 'google/gemini-3.5-flash', textModel: 'google/gemini-3.5-flash', keyHint: '可以直接点「登录」，在网页上同意后自动配好；也可以在 OpenRouter → 「Keys」新建并复制。', signupUrl: 'https://openrouter.ai/keys', visionId: 'openrouter', login: 'openrouter' }),
  p({ id: 'relay-other', label: '其他中转站（OpenAI 兼容）', region: 'global', kind: 'relay', baseUrl: '', visionModel: '', textModel: '', keyHint: '中转站后台给你的接口地址（一般以 /v1 结尾）和 Key。', signupUrl: '', visionId: 'custom-global', aliases: ['custom-global'] }),
  // 本机
  p({ id: 'ollama-local', label: '本机 Ollama', region: 'cn', kind: 'local', baseUrl: 'http://127.0.0.1:11434/v1', visionModel: '', textModel: '', needsKey: false, keyHint: '不用 Key。先在这台电脑上装好 Ollama 并下载一个能看图的模型。', signupUrl: 'https://ollama.com', visionId: 'ollama-local', aliases: ['ollama'] }),
  p({ id: 'lmstudio-local', label: '本机 LM Studio', region: 'cn', kind: 'local', baseUrl: 'http://127.0.0.1:1234/v1', visionModel: '', textModel: '', needsKey: false, keyHint: '不用 Key。在 LM Studio 里加载模型并打开本机服务（端口 1234）。', signupUrl: 'https://lmstudio.ai', visionId: 'lmstudio-local', aliases: ['lmstudio'] }),
  p({ id: 'antigravity-local', label: 'Antigravity 本地反代', region: 'global', kind: 'local', baseUrl: 'http://127.0.0.1:8045/v1', visionModel: 'gemini-3.7-flash-low', textModel: 'gemini-3.8-flash-low', needsKey: false, listsModels: false, keyHint: '不用 Key，需要本机已运行反代（127.0.0.1:8045）。', signupUrl: '', visionId: 'antigravity-local', internal: true, aliases: ['antigravity'] }),
  // 自定义
  p({ id: 'custom', label: '自定义（任意 OpenAI 兼容地址）', region: 'cn', kind: 'custom', baseUrl: '', visionModel: '', textModel: '', keyHint: '填服务商给的接口地址（HTTPS，一般以 /v1 结尾）和 Key；本机服务可用 http://127.0.0.1:端口。', signupUrl: '', visionId: 'custom-cn', aliases: ['custom-cn'] }),
];

export const providerGroups = [
  { id: 'cn', label: '国内', match: (x: ModelProvider) => x.kind === 'direct' && x.region === 'cn' },
  { id: 'global', label: '国际', match: (x: ModelProvider) => x.kind === 'direct' && x.region === 'global' },
  { id: 'relay', label: '中转站', match: (x: ModelProvider) => x.kind === 'relay' || x.kind === 'custom' },
  { id: 'local', label: '本机', match: (x: ModelProvider) => x.kind === 'local' },
] as const;

/** Finds a provider by id or a legacy alias (old BuiltinModel options, vision profile ids, config files). */
export const findProvider = (id?: string) => !id ? undefined : modelProviders.find(x => x.id === id) ?? modelProviders.find(x => x.aliases?.includes(id));
/** The catalogue entry a saved vision profile belongs to. Gemini native keeps its own advanced form entry. */
export const providerForVisionId = (visionId?: string) => !visionId ? undefined : modelProviders.find(x => x.visionId === visionId) ?? findProvider(visionId);
/** Best catalogue match for a pasted base URL (same origin and path prefix). */
export function providerForBaseUrl(baseUrl: string): ModelProvider | undefined {
  let url: URL; try { url = new URL(baseUrl); } catch { return undefined; }
  const path = url.pathname.replace(/\/+$/, '');
  return modelProviders.find(x => { if (!x.baseUrl) return false; const b = new URL(x.baseUrl); return b.host === url.host && path.startsWith(b.pathname.replace(/\/+$/, '')); })
    ?? modelProviders.find(x => x.baseUrl && new URL(x.baseUrl).host === url.host);
}
/** Search box: label, id, alias or host, case-insensitive. */
export function searchProviders(query: string, list: readonly ModelProvider[] = modelProviders) {
  const q = query.trim().toLowerCase(); if (!q) return [...list];
  return list.filter(x => [x.label, x.id, ...(x.aliases ?? []), x.baseUrl].some(s => s.toLowerCase().includes(q)));
}

const notChat = /(embed|rerank|moderation|whisper|tts|speech|audio|transcribe|realtime|dall-?e|imagen|veo|sora|image-?gen|-image|image-preview|seedream|seedance|video|ocr-only|search-preview|guard|\bbge\b|\bgte\b|\bm3e\b|\bjina\b|flux|kolors|stable-diffusion|sdxl|cosyvoice|sensevoice|fish-speech)/i;
const visionName = /(\bvl\b|[-_]vl|vl[-_]|vision|gemini|gpt-4o|gpt-4\.1|gpt-5|qwen.*vl|glm-\d[\w.]*v|claude|llava|minicpm-v|pixtral|internvl|moondream|kimi-latest|omni)/i;
const fast = /(flash|mini|lite|turbo|plus|air|haiku|instant|fast|small)/i;
const slow = /(preview|exp|thinking|reason|deep-?research|\bpro\b|-pro|max|ultra|opus|\br1\b)/i;
const score = (m: string) => (fast.test(m) ? 2 : 0) - (slow.test(m) ? 1 : 0) - m.length / 1000;
const best = (list: string[]) => [...list].sort((a, b) => score(b) - score(a))[0] ?? '';
/** Reply writing wants a capable chat model, not the fastest name: known chat families and larger sizes first;
 *  tiny (≤ 14B), instant/lite, reasoning and preview models last. Families that think by default (qwen3, gpt-oss)
 *  get no bonus: replies must come back in seconds. */
const strongChat = /(deepseek-(v\d|chat)|qwen[\d.]*-(max|plus)|glm-[45]|gpt-4o|gpt-4\.1|gpt-5|gemini|claude|kimi|moonshot|llama-3\.3-70b|llama-4|grok|doubao|ernie|hunyuan|minimax|mistral-large)/i;
const smallChat = /(instant|lite|tiny|nano|small|mini\b|-mini)/i;
const textScore = (m: string) => {
  const size = /(?:^|[-_/:])(\d+(?:\.\d+)?)b\b/i.exec(m)?.[1]; const b = size ? Number(size) : undefined;
  return (strongChat.test(m) ? 3 : 0) + (b === undefined ? 0 : b >= 30 ? 1 : b <= 14 ? -3 : 0) - (smallChat.test(m) ? 1 : 0)
    - (/(thinking|reason|\br1\b|-r1|deep-?research|preview|exp\b|distill|coder)/i.test(m) ? 2 : 0) - m.length / 1000;
};
const bestText = (list: string[]) => [...list].sort((a, b) => textScore(b) - textScore(a))[0] ?? '';
export const isVisionModelName = (m: string) => visionName.test(m) && !notChat.test(m);
export const isChatModelName = (m: string) => !notChat.test(m);

/**
 * Picks the screen-reading (vision) and reply (text) models. Catalogue defaults win when the service lists them (or when
 * it cannot list). Otherwise a vision-looking, fast-looking name; the text model falls back to the vision model.
 */
export function pickModels(provider: Pick<ModelProvider, 'visionModel' | 'textModel' | 'visionCapable'>, listed?: string[]) {
  const list = (listed ?? []).filter(m => typeof m === 'string' && m && m.length < 200);
  const has = (m: string) => !!m && (!listed || list.includes(m));
  const vision = !provider.visionCapable ? '' : has(provider.visionModel) ? provider.visionModel : best(list.filter(isVisionModelName));
  const textCandidates = list.filter(m => isChatModelName(m) && !/(\bvl\b|[-_]vl|vl[-_]|vision|glm-\d[\w.]*v\b)/i.test(m));
  const text = has(provider.textModel) ? provider.textModel : vision && /(gemini|gpt|claude|grok)/i.test(vision) ? vision : bestText(textCandidates) || vision;
  return { visionModel: vision, textModel: text };
}

/** 一键配好 request from the card (the key goes to the desktop process only). */
export type ModelSetupRequest = { provider: string; apiKey?: string; baseUrl?: string; visionModel?: string; textModel?: string };
export type ModelSetupResult = {
  ok: boolean; provider: string; label: string;
  visionModel?: string; textModel?: string; visionSaved: boolean; textSaved: boolean;
  /** How many models the service listed (undefined when it does not list them). */
  listed?: number;
  /** The card should ask for a model name / a key and try again. */
  needsModel?: boolean; needsKey?: boolean;
  /** The picture test already ran before saving (milliseconds), or why it failed (the screen-reading model was then not saved). */
  visionTestMs?: number; visionProblem?: string;
  message: string;
};
/** 交付用配置文件 (desktop/model-config-import.ts). apiKey is optional; exports never include it. */
export type ModelConfigFile = { kadadesk: 'model-config'; version: 1; provider: string; baseUrl: string; visionModel: string; textModel: string; textProvider?: string; textBaseUrl?: string; apiKey?: string; textApiKey?: string };
