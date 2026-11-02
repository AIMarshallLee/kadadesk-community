import type { ReceptionEvent, ReplyContextMeta, ResolvedReceptionEvent } from './replies-contract';
import type { DailyHealthFacts } from '../shared/reception-health';

/**
 * The places reception meets 插件中心, filled in by desktop/plugins-ipc.ts once plugins load (and by built-in plugins
 * such as 连接增长飞轮 in main.ts). Empty means no plugins: reception behaves exactly as before. Every hook swallows
 * its own failures, and nothing here makes reception wait: listeners run later (setImmediate), off the reply path.
 */
export type ReplyContext = { knowledge: string; instructions: string } & Record<string, unknown>;
export type ReceptionListener = (event: ResolvedReceptionEvent) => void | Promise<void>;
export type ContextAugmenter = <T extends ReplyContext>(context: T, query: string | undefined, signal?: AbortSignal, meta?: ReplyContextMeta) => Promise<T> | T;
/** Adds profileId / conversationKey / at to an event; undefined drops it (no profile for this chat: group, admin, family…). */
export type ReceptionResolver = (event: ReceptionEvent) => Promise<ResolvedReceptionEvent | undefined> | ResolvedReceptionEvent | undefined;
export type DailyHealthListener = (info: { date: string; facts: DailyHealthFacts }) => void | Promise<void>;

const receptionListeners = new Set<ReceptionListener>();
const contextAugmenters = new Set<ContextAugmenter>();
const dailyHealthListeners = new Set<DailyHealthListener>();
let resolver: ReceptionResolver | undefined;

export const pluginHooks: {
  /** Before drafting: may add read-only tool results (marked untrusted) to the knowledge context. Never throws. */
  augmentContext?: <T extends ReplyContext>(context: T, query: string | undefined, signal?: AbortSignal) => Promise<T>;
  /** New incoming message / first message from a customer / handoff / an owner-edited review / reply sent / etc. Fire and forget. */
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
export function addDailyHealthListener(listener: DailyHealthListener): () => void {
  dailyHealthListeners.add(listener);
  return () => { dailyHealthListeners.delete(listener); };
}
/** main.ts: the customer-profile lookup (get-or-create) used before listeners see an event. */
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
    try { await Promise.resolve(listener(resolved)).catch(() => {}); } catch { /* listeners never interrupt reception */ }
  }
}

/**
 * Called by reception. The built-in plugin manager hook runs as before; plugin listeners run on a later turn of the
 * event loop (setImmediate), so the caller never waits for a listener, a profile lookup or a file write.
 */
export function emitReceptionEvent(event: ReceptionEvent) {
  try { pluginHooks.receptionEvent?.(event); } catch { /* plugins never interrupt reception */ }
  emitListenerEvent(event);
}

/**
 * Official lanes (飞书/钉钉/企业办公软件机器人): only the listeners (连接增长飞轮) see their events. Automation rules keep
 * firing for the screen and phone lanes only, as before: an 「提醒管理员」 action would otherwise borrow the mouse and
 * keyboard for a lane that promises never to touch them, and the owner wrote those rules before these lanes reported.
 */
export function emitListenerEvent(event: ReceptionEvent) {
  if (!receptionListeners.size) return;
  setImmediate(() => { void dispatch(event).catch(() => {}); });
}

export function emitDailyHealth(info: { date: string; facts: DailyHealthFacts }) {
  if (!dailyHealthListeners.size) return;
  setImmediate(() => {
    for (const listener of [...dailyHealthListeners]) { try { void Promise.resolve(listener(info)).catch(() => {}); } catch { /* ignore */ } }
  });
}
