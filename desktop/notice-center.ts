import { readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { NOTICE_KINDS, type NoticeCard } from '../shared/notices';

export interface NoticeSpec {
  /** One of NOTICE_KINDS (unknown keys are treated as 'other' for muting). */
  key: string;
  title: string;
  body: string;
  pause?: boolean;
  open?: boolean;
  /** The same key is not shown again within this time (default 10 minutes). 0: every time. */
  cooldownMs?: number;
  /** Prefer a system notification even when the card window is available. */
  systemOnly?: boolean;
  ttlMs?: number;
  /** One extra button on the card; `run` is called when the owner clicks it. */
  extra?: NoticeExtra;
}
export interface NoticeExtra { label: string; run: () => unknown }
export type NoticeOutcome = 'card' | 'system' | 'muted' | 'cooldown' | 'none';

type Sinks = { card?: (card: NoticeCard) => Promise<boolean> | boolean; system?: (title: string, body: string) => void };

/**
 * Desktop reminders with 「不再提醒」. One instance per app (main process); callers anywhere use showNotice().
 * Muted keys live in <userData>/notices.json and survive updates.
 */
export function createNoticeCenter(options: { file?: string; now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  const muted = new Set<string>();
  const last = new Map<string, number>();
  let sinks: Sinks = {};
  let seq = 0;
  const extras = new Map<string, () => unknown>();
  if (options.file) {
    try { const v = JSON.parse(readFileSync(options.file, 'utf8')); if (Array.isArray(v?.muted)) for (const k of v.muted) if (typeof k === 'string' && k.length <= 60) muted.add(k); } catch { /* none yet */ }
  }
  const save = async () => {
    if (!options.file) return;
    try { await mkdir(dirname(options.file), { recursive: true }); const tmp = options.file + '.tmp'; await writeFile(tmp, JSON.stringify({ muted: [...muted] })); await rename(tmp, options.file); } catch { /* best effort */ }
  };
  const known = (key: string) => NOTICE_KINDS.some(k => k.key === key) ? key : 'other';
  return {
    setSinks(next: Sinks) { sinks = next; },
    /** The owner clicked the card's extra button (each card's action runs at most once). */
    async runExtra(id: string) { const run = extras.get(id); extras.delete(id); if (run) await run(); },
    isMuted: (key: string) => muted.has(known(key)),
    muted: () => [...muted],
    async mute(key: string) { muted.add(known(key)); await save(); },
    async unmute(key: string) { muted.delete(known(key)); await save(); },
    async unmuteAll() { muted.clear(); await save(); },
    async show(spec: NoticeSpec): Promise<NoticeOutcome> {
      const key = known(spec.key);
      if (muted.has(key)) return 'muted';
      const cooldown = spec.cooldownMs ?? 600_000, t = now(), lastKey = `${key}|${spec.title}`;
      if (cooldown > 0 && t - (last.get(lastKey) ?? -Infinity) < cooldown) return 'cooldown';
      last.set(lastKey, t); if (last.size > 300) last.delete(last.keys().next().value!);
      const card: NoticeCard = { id: `n${++seq}`, key, title: spec.title.slice(0, 40), body: spec.body.slice(0, 220), ...(spec.pause ? { pause: true } : {}), ...(spec.open ? { open: true } : {}), ...(NOTICE_KINDS.find(k => k.key === key)?.important ? { important: true } : {}), ...(spec.extra ? { extra: spec.extra.label.slice(0, 12) } : {}), ttlMs: spec.ttlMs ?? (spec.extra ? 20000 : spec.pause ? 15000 : 12000) };
      if (spec.extra) { extras.set(card.id, spec.extra.run); if (extras.size > 30) extras.delete(extras.keys().next().value!); }
      if (!spec.systemOnly && sinks.card) { try { if (await sinks.card(card)) return 'card'; } catch { /* fall back */ } }
      if (sinks.system) { try { sinks.system(card.title, card.body); return 'system'; } catch { /* ignore */ } }
      return 'none';
    },
  };
}
export type NoticeCenter = ReturnType<typeof createNoticeCenter>;

let shared: NoticeCenter = createNoticeCenter();
/** Main installs the app-wide center (with the file and the sinks); tests may install their own. */
export const installNoticeCenter = (center: NoticeCenter) => { shared = center; };
export const noticeCenter = () => shared;
/** Shows a desktop reminder unless the owner switched this kind off (「不再提醒」). Never throws. */
export const showNotice = (spec: NoticeSpec): void => { void shared.show(spec).catch(() => undefined); };
