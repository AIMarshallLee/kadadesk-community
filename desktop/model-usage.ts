// Provider-reported counts only. Missing usage is unknown, never free usage.
export interface ModelTokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cachedInputTokens: number | null;
  imageInputTokens: number | null;
  reasoningOutputTokens: number | null;
}
const count = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function parseModelUsage(value: unknown): ModelTokenUsage {
  const usage = object(value);
  const input = object(usage.prompt_tokens_details ?? usage.input_tokens_details);
  const output = object(usage.completion_tokens_details ?? usage.output_tokens_details);
  return {
    inputTokens: count(usage.prompt_tokens) ?? count(usage.input_tokens),
    outputTokens: count(usage.completion_tokens) ?? count(usage.output_tokens),
    totalTokens: count(usage.total_tokens),
    cachedInputTokens: count(input.cached_tokens) ?? count(usage.prompt_cache_hit_tokens),
    imageInputTokens: count(input.image_tokens),
    // These are subsets; never add cached/image/reasoning counts to the totals.
    reasoningOutputTokens: count(output.reasoning_tokens),
  };
}
const stages = ['PHONE_SCENE', 'CHAT_SCENE', 'CHAT_EDITOR', 'CHAT_BUBBLE', 'IME_SCENE', 'NAVIGATION', 'SEARCH', 'WHATSAPP', 'WHATSAPP_NAV', 'WEBMAIL', 'MOMENTS', 'CHAT_REPLY', 'LEARNING', 'CONVERSATION_ROUTING', 'DAILY_REPORT'] as const;
export interface ModelCallMetric {
  stage: typeof stages[number] | 'OTHER';
  elapsedMs: number;
  imageCount: number;
  result: 'response' | 'error' | 'cancelled' | 'timeout';
  httpStatus: number | null;
  usage: ModelTokenUsage;
}
export function modelCallStage(system: string): ModelCallMetric['stage'] {
  if (system.startsWith('KADADESK_DAILY_REPORT.')) return 'DAILY_REPORT';
  if(system.startsWith('KADADESK_CONVERSATION_ROUTING.'))return 'CONVERSATION_ROUTING';
  return stages.find(stage => system.startsWith(`FLOWDESK_${stage}.`)) ?? 'OTHER';
}
export type ModelMetricSink = (metric: ModelCallMetric) => void | Promise<void>;
