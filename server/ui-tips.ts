import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { cleanTipList, validTipKey } from '../shared/once-tips';

/**
 * Which in-page tips and confirmations the owner switched off (「不再提醒」 / 「以后不再问」).
 * Kept in <dataDir>/ui-tips.json, apart from the workspace state: no audit event per click, not part of backups,
 * and a restored backup does not bring old tips back.
 */
export function createTipStore(file: string) {
  let loaded: Promise<string[]> | undefined;
  // Every change runs after the previous one finished (read → change → write), so two quick clicks never lose one.
  let tail: Promise<unknown> = Promise.resolve();
  const load = () => loaded ??= readFile(file, 'utf8').then(text => cleanTipList(JSON.parse(text)?.dismissed)).catch(() => [] as string[]);
  const write = async (next: string[]) => { await mkdir(dirname(file), { recursive: true }); await writeFile(`${file}.tmp`, JSON.stringify({ dismissed: next }), 'utf8'); await rename(`${file}.tmp`, file); };
  const change = (fn: (now: string[]) => string[]) => {
    const run = tail.then(async () => {
      const now = await load(), next = fn(now);
      if (next !== now) { await write(next); loaded = Promise.resolve(next); }
      return [...next];
    });
    tail = run.catch(() => undefined);
    return run;
  };
  const key = (value: unknown) => { if (!validTipKey(value)) throw new Error('提示名称无效'); return value; };
  return {
    async list() { await tail; return [...await load()]; },
    async dismiss(value: unknown) { const k = key(value); return change(now => now.includes(k) ? now : cleanTipList([...now, k])); },
    async restore(value: unknown) { const k = key(value); return change(now => now.includes(k) ? now.filter(x => x !== k) : now); },
    reset() { return change(() => []); },
  };
}
export type TipStore = ReturnType<typeof createTipStore>;
