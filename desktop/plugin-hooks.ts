import type { ReceptionEvent } from './replies-contract';

export type ReplyContext = { knowledge: string; instructions: string } & Record<string, unknown>;
export type ReceptionListener = (event: ReceptionEvent) => void | Promise<void>;
export type ContextAugmenter = <T extends ReplyContext>(context: T, query: string | undefined, signal?: AbortSignal) => Promise<T> | T;

const receptionListeners = new Set<ReceptionListener>();
const contextAugmenters = new Set<ContextAugmenter>();

export const pluginHooks: {
  augmentContext?: <T extends ReplyContext>(context: T, query: string | undefined, signal?: AbortSignal) => Promise<T>;
  receptionEvent?: (event: ReceptionEvent) => void;
} = {};

export function addReceptionListener(listener: ReceptionListener): () => void {
  receptionListeners.add(listener);
  return () => { receptionListeners.delete(listener); };
}

export function addContextAugmenter(augmenter: ContextAugmenter): () => void {
  contextAugmenters.add(augmenter);
  return () => { contextAugmenters.delete(augmenter); };
}

export async function withPluginContext<T extends ReplyContext>(context: T, query: string | undefined, signal?: AbortSignal): Promise<T> {
  let current = context;
  if (pluginHooks.augmentContext && query) {
    try { current = await pluginHooks.augmentContext(current, query, signal); } catch { /* ignore */ }
  }
  for (const augmenter of contextAugmenters) {
    try { current = await augmenter(current, query, signal); } catch { /* ignore */ }
  }
  return current;
}

export function emitReceptionEvent(event: ReceptionEvent) {
  try { pluginHooks.receptionEvent?.(event); } catch { /* plugins never interrupt */ }
  for (const listener of receptionListeners) {
    try { void listener(event); } catch { /* ignore */ }
  }
}
