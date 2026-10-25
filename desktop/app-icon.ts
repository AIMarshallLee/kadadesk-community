import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isMascotIcon, mascotIconFile, type MascotIconId } from '../shared/mascot-icons';

type Deps = {
  /** userData/app-icon.json */
  preferencePath: string;
  /** The renderer build folder that holds mascots/ (dist in a packaged app). */
  publicRoot: string;
  /** Applies an icon file, or undefined to restore the shipped icon. */
  apply(file: string | undefined): void;
};

/** 图标款式: remembers which mascot the owner picked and applies it to the Dock / taskbar at start and on change. */
export function createAppIcon(deps: Deps) {
  let current: MascotIconId = 'default';
  const fileFor = (id: MascotIconId) => { const rel = mascotIconFile(id); return rel ? join(deps.publicRoot, rel) : undefined; };
  const apply = (id: MascotIconId) => { try { deps.apply(fileFor(id)); } catch { /* the bundle icon still shows */ } };
  return {
    current: () => current,
    async load() {
      try { const saved = JSON.parse(await readFile(deps.preferencePath, 'utf8'))?.icon; if (isMascotIcon(saved)) current = saved; } catch { current = 'default'; }
      if (current !== 'default') apply(current);
      return current;
    },
    async set(id: unknown) {
      if (!isMascotIcon(id)) throw new Error('没有这个图标款式');
      current = id; apply(id);
      await mkdir(dirname(deps.preferencePath), { recursive: true });
      await writeFile(deps.preferencePath, JSON.stringify({ icon: id, at: new Date().toISOString() }), 'utf8');
      return current;
    },
  };
}
