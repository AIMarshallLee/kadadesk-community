import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface LoginItemView { supported: boolean; on: boolean }
/**
 * 「开机自动打开咔哒」: on a restart of the computer 咔哒 comes back by itself, so reception does not silently stop
 * until someone notices. Turned on once on the first launch of an installed copy (the owner can turn it off in 设置,
 * and that choice is never overridden); development builds and other systems are left alone.
 */
export function createLoginItem(o: { file: string; packaged: boolean; platform: string; get(): boolean; set(on: boolean): void }) {
  const supported = o.packaged && (o.platform === 'darwin' || o.platform === 'win32');
  const remember = async (on: boolean) => { await mkdir(dirname(o.file), { recursive: true }); await writeFile(o.file + '.tmp', JSON.stringify({ decided: true, on })); await rename(o.file + '.tmp', o.file); };
  const read = (): boolean => { try { return o.get(); } catch { return false; } };
  return {
    async ensureDefault(): Promise<void> {
      if (!supported) return;
      try { if (JSON.parse(await readFile(o.file, 'utf8'))?.decided) return; } catch { /* first launch */ }
      try { o.set(true); await remember(true); } catch { /* the system refused: the switch in 设置 shows it off */ }
    },
    state: (): LoginItemView => ({ supported, on: supported && read() }),
    async setOn(on: boolean): Promise<LoginItemView> {
      if (!supported) return { supported, on: false };
      o.set(on); await remember(on); return { supported, on: read() };
    },
  };
}
