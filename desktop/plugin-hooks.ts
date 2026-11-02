import type { ReceptionEvent, ReplyContextMeta, ResolvedReceptionEvent } from './replies-contract';

/**
 * Where core event sources meet 插件中心, filled in by desktop/plugins-ipc.ts once plugins load (and by built-in
 * plugins such as 连接增长飞轮 in main.ts). Empty means no plugins: everything behaves exactly as before. Every hook
 * swallows its own failures, and nothing here makes the caller wait: listeners run later (setImmediate).
 */
export type ReplyContext = { knowledge: string; instructions: string } & Record<string, unknown>;
export type ReceptionListener = (event: ResolvedReceptionEvent) => void | Promise<void>;
export type ContextAugmenter = <T extends ReplyContext>(context: T, query: string | undefined, signal?: AbortSignal, meta?: ReplyContextMeta) => Promise<T> | T;
/** Adds profileId / conversationKey / at to an event; undefined drops it (no profile for this chat: group, admin, family…). */
export type ReceptionResolver = (event: ReceptionEvent) => Promise<ResolvedReceptionEvent | undefined> | ResolvedReceptionEvent | undefined;

const receptionListeners = new Set<ReceptionListener>();
const contextAugmenters = new Set<ContextAugmenter>();
let resolver: ReceptionResolver | undefined;

export const pluginHooks: {
  /** Before drafting: may add read-only tool results (marked untrusted) to the knowledge context. Never throws. */
  augmentContext?: <T extends ReplyContext>(context: T, query: string | undefined, signal?: AbortSignal) => Promise<T>;
  /** The plugin manager's own automation rules. Fire and forget. */
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
/** main.ts: the customer-profile lookup used before listeners see an event. */
export function setReceptionResolver(next: ReceptionResolver | undefined) { resolver = next; }
export const receptionListenerCount = () => receptionListeners.size;

export async function withPluginContext<T extends ReplyContext>(context: T, query: string | undefined, signal?: AbortSignal, meta?: ReplyContextMeta): Promise<T> {
  let current = context;
  if (pluginHooks.augmentContext && query) {
    try { current = await pluginHooks.augmentContext(current, query, signal); } catch { /* ignore */ }
  }
  for (const augmenter of contextAugmenters) {
    try { current = await augmenter(current, query, signal, meta); } catch { /* ignore */ }
  }
  return current;
}

/** Without a resolver (tests, early start): an event that already names its profile passes; others are dropped. */
const passThrough = (event: ReceptionEvent): ResolvedReceptionEvent | undefined => event.profileId && event.conversationKey
  ? { ...event, at: event.at ?? new Date().toISOString(), profileId: event.profileId, conversationKey: event.conversationKey } as ResolvedReceptionEvent : undefined;

async function dispatch(event: ReceptionEvent) {
  if (!receptionListeners.size) return; // nobody listening: no profile lookup, no work at all
  let resolved: ResolvedReceptionEvent | undefined;
  try { resolved = resolver ? await resolver(event) : passThrough(event); } catch { return; }
  if (!resolved) return;
  for (const listener of [...receptionListeners]) {
    try { await Promise.resolve(listener(resolved)).catch(() => {}); } catch { /* listeners never interrupt the source */ }
  }
}

/**
 * Called by an event source. The plugin manager hook runs at once as before; listeners run on a later turn of the
 * event loop (setImmediate), so the caller never waits for a listener, a profile lookup or a file write.
 */
export function emitReceptionEvent(event: ReceptionEvent) {
  try { pluginHooks.receptionEvent?.(event); } catch { /* plugins never interrupt the source */ }
  if (!receptionListeners.size) return;
  setImmediate(() => { void dispatch(event).catch(() => {}); });
}
