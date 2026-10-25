import { useSyncExternalStore } from 'react';
import { api } from './api';

/**
 * Which page tips are hidden. 「不再提醒」 is kept by the app (PUT /tips → ui-tips.json in the data folder);
 * 「知道了」 only hides a tip until 咔哒 is opened again (kept in memory, shared by every page in this window).
 * Until the stored list has loaded, tips stay hidden, so a tip the owner switched off never flashes up.
 */
type Snapshot = { loaded: boolean; dismissed: ReadonlySet<string>; session: ReadonlySet<string> };
let snapshot: Snapshot = { loaded: false, dismissed: new Set(), session: new Set() };
const listeners = new Set<() => void>();
let loading: Promise<void> | undefined;
const emit = (next: Partial<Snapshot>) => { snapshot = { ...snapshot, ...next }; for (const fn of listeners) fn(); };
const apply = (list: unknown) => emit({ loaded: true, dismissed: new Set(Array.isArray(list) ? list.filter((k): k is string => typeof k === 'string') : []) });

export function loadTips(force = false): Promise<void> {
  if (loading && !force) return loading;
  loading = api<{ dismissed: string[] }>('GET', '/tips').then(r => apply(r?.dismissed)).catch(() => {
    // Could not read (an older 咔哒 core, or the local service is down): show the tips; 「知道了」 still works.
    if (!snapshot.loaded) emit({ loaded: true });
    loading = undefined;
  });
  return loading;
}
const subscribe = (fn: () => void) => { listeners.add(fn); if (!snapshot.loaded) void loadTips(); return () => { listeners.delete(fn); }; };
export function useTips(): Snapshot { return useSyncExternalStore(subscribe, () => snapshot, () => snapshot); }
export const tipHidden = (s: Snapshot, key: string) => !s.loaded || s.dismissed.has(key) || s.session.has(key);
export const tipMuted = (key: string) => snapshot.dismissed.has(key);

/** 「知道了」: hidden until 咔哒 is opened again. */
export function hideTipForNow(key: string) { emit({ session: new Set([...snapshot.session, key]) }); }
/** 「不再提醒」 / 「以后不再问」: hidden at once; kept by the app. If saving fails it stays hidden for this time only. */
export async function muteTip(key: string): Promise<boolean> {
  hideTipForNow(key); emit({ dismissed: new Set([...snapshot.dismissed, key]) });
  try { apply((await api<{ dismissed: string[] }>('PUT', '/tips', { dismiss: key })).dismissed); return true; }
  catch { return false; }
}
/** Shows every page tip and confirmation again. */
export async function resetTips(): Promise<void> {
  apply((await api<{ dismissed: string[] }>('PUT', '/tips', { reset: true })).dismissed);
  emit({ session: new Set() });
}
