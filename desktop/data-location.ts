import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, statfsSync, writeFileSync, lstatSync, realpathSync } from 'node:fs';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * 记录存放位置：系统盘空间紧张时，咔哒自己把记录放到空间充足的非系统盘（Windows 的 D:/E: 等，
 * Mac 的外置硬盘），启动时就做好，不等用户遇到“存不了记录”。
 *
 * 默认目录里只留一个很小的指针文件 data-location.json，指向真正的记录目录；记录目录里有标记文件
 * kadadesk-data.json（带 id），用来确认接上的还是同一块盘。
 */
export type DataLocation = { dir: string; moved: boolean; missing?: { dir: string; label: string }; note?: string };
type Pointer = { dir: string; id: string; label: string; movedAt: string };
const GB = 1024 ** 3;
const POINTER = 'data-location.json', MARKER = 'kadadesk-data.json';
// 指针、隐藏文件、临时目录和 Chromium 的单实例锁（Singleton* 链接）不搬。
const skip = (name: string) => name === POINTER || name === 'local-while-disk-missing' || name.startsWith('.') || name.startsWith('Singleton');

export function freeBytes(path: string): number {
  try { const s = statfsSync(path); return Number(s.bavail) * Number(s.bsize); } catch { return -1; }
}
function systemRoot(): string { return process.platform === 'win32' ? `${(process.env.SystemDrive || 'C:').replace(/\\$/, '')}\\` : ['/System', 'Volumes', 'Data'].join('/'); }
export function systemFreeBytes(): number { const f = freeBytes(systemRoot()); return f >= 0 ? f : freeBytes(process.platform === 'win32' ? 'C:\\' : '/'); }

function writable(dir: string): boolean {
  try { mkdirSync(dir, { recursive: true }); const probe = join(dir, `.kadadesk-probe-${process.pid}`); writeFileSync(probe, 'ok'); rmSync(probe, { force: true }); return true; } catch { return false; }
}
/** 空间最充足、可写、不是系统盘的位置（至少 minFree）。Mac 只看外置盘挂载点，Windows 看 D: 到 Z:。 */
export function findSpareVolume(minFree = 20 * GB): { root: string; label: string; free: number } | undefined {
  const found: Array<{ root: string; label: string; free: number }> = [];
  if (process.platform === 'win32') {
    const sys = (process.env.SystemDrive || 'C:').toUpperCase().replace(/\\$/, '');
    for (const letter of 'DEFGHIJKLMNOPQRSTUVWXYZ') {
      const root = `${letter}:\\`; if (`${letter}:` === sys) continue;
      const free = freeBytes(root); if (free >= minFree) found.push({ root, label: `${letter} 盘`, free });
    }
  } else if (process.platform === 'darwin') {
    let names: string[] = []; try { names = readdirSync('/Volumes'); } catch { /* none */ }
    for (const name of names) {
      const root = join('/Volumes', name);
      try { if (lstatSync(root).isSymbolicLink() || realpathSync(root) === '/') continue; } catch { continue; } // “Macintosh HD” 指回系统盘
      if (/^(Recovery|Preboot|VM|Update|com\.apple)/i.test(name)) continue;
      const free = freeBytes(root); if (free >= minFree) found.push({ root, label: `外置硬盘「${name}」`, free });
    }
  }
  return found.filter(v => writable(join(v.root, 'kadadesk-data'))).sort((a, b) => b.free - a.free)[0];
}

function readPointer(defaultDir: string): Pointer | undefined {
  try { const p = JSON.parse(readFileSync(join(defaultDir, POINTER), 'utf8')) as Pointer; return p && typeof p.dir === 'string' && typeof p.id === 'string' ? p : undefined; } catch { return undefined; }
}
function markerOk(dir: string, id: string): boolean {
  try { return (JSON.parse(readFileSync(join(dir, MARKER), 'utf8')) as { id?: string }).id === id; } catch { return false; }
}
function hasData(dir: string): boolean { try { return readdirSync(dir).some(n => n !== POINTER && !n.startsWith('.')); } catch { return false; } }

/**
 * 启动时（app ready 之前，还没有任何文件被打开）调用。
 * - 已经搬过：用指针指向的目录；盘没接上就最多等 waitMs（开机时外置盘挂载会晚几秒），还不在就退回本机并提示。
 * - 没搬过：系统盘剩余空间少于 lowFree（或 Windows 首次安装、本机还没有记录）且有空间充足的非系统盘时，自动搬过去。
 */
export function resolveDataLocation(defaultDir: string, profile: string, options: { lowFree?: number; waitMs?: number } = {}): DataLocation {
  mkdirSync(defaultDir, { recursive: true });
  const result = resolveInner(defaultDir, profile, options);
  try { writeFileSync(join(defaultDir, '.kadadesk-running'), String(process.pid)); } catch { /* best effort */ }
  return result;
}
function resolveInner(defaultDir: string, profile: string, options: { lowFree?: number; waitMs?: number }): DataLocation {
  const pointer = readPointer(defaultDir);
  if (pointer) {
    const deadline = Date.now() + (options.waitMs ?? 20000);
    for (;;) {
      if (existsSync(pointer.dir) && markerOk(pointer.dir, pointer.id)) return { dir: pointer.dir, moved: true };
      if (Date.now() > deadline) break;
      const until = Date.now() + 1000; while (Date.now() < until) { /* 同步等待：此时界面还没启动 */ }
    }
    // 盘没接上：用本机的临时目录先跑起来（不覆盖原记录），界面里提示接上硬盘后重启咔哒。
    const fallback = join(defaultDir, 'local-while-disk-missing'); mkdirSync(fallback, { recursive: true });
    return { dir: fallback, moved: true, missing: { dir: pointer.dir, label: pointer.label } };
  }
  const lowFree = options.lowFree ?? 15 * GB, sysFree = systemFreeBytes();
  const fresh = !hasData(defaultDir);
  const wantMove = (sysFree >= 0 && sysFree < lowFree) || (process.platform === 'win32' && fresh);
  if (!wantMove) return { dir: defaultDir, moved: false };
  // 另一个咔哒正在用这个目录：绝不在它运行时搬家。
  try { const pid = Number(readFileSync(join(defaultDir, '.kadadesk-running'), 'utf8')); if (pid && pid !== process.pid) { try { process.kill(pid, 0); return { dir: defaultDir, moved: false }; } catch { /* 已退出 */ } } } catch { /* 无 */ }
  const spare = findSpareVolume(); if (!spare) return { dir: defaultDir, moved: false };
  const target = join(spare.root, 'kadadesk-data', profile);
  try {
    mkdirSync(target, { recursive: true });
    if (hasData(target) && !existsSync(join(target, MARKER))) return { dir: defaultDir, moved: false }; // 别人的同名目录，不碰
    const id = randomUUID();
    // 先完整复制，复制成功并写好标记后再切换；原目录改名留作备份（下次启动确认新位置正常后再清理）。
    for (const name of readdirSync(defaultDir)) {
      if (skip(name)) continue;
      cpSync(join(defaultDir, name), join(target, name), { recursive: true, force: true, preserveTimestamps: true });
    }
    for (const name of readdirSync(defaultDir)) {
      if (skip(name)) continue;
      const a = lstatSync(join(defaultDir, name)), b = lstatSync(join(target, name));
      if (a.isFile() && a.size !== b.size) throw new Error(`复制校验失败：${name}`);
    }
    writeFileSync(join(target, MARKER), JSON.stringify({ id, from: defaultDir, at: new Date().toISOString() }));
    writeFileSync(join(defaultDir, POINTER), JSON.stringify({ dir: target, id, label: spare.label, movedAt: new Date().toISOString() } satisfies Pointer));
    // 原记录移进备份文件夹；新位置用过一次没问题后由 cleanupMovedBackup 删除，释放系统盘。
    if (!fresh) {
      const backup = join(defaultDir, '.moved-backup'); mkdirSync(backup, { recursive: true });
      for (const name of readdirSync(defaultDir)) { if (skip(name)) continue; try { renameSync(join(defaultDir, name), join(backup, name)); } catch { /* 正在占用的文件留在原处 */ } }
    }
    return { dir: target, moved: true, note: `系统盘空间不多，咔哒已把记录放到${spare.label}（${basename(target)}），之后都存在那里。` };
  } catch {
    return { dir: defaultDir, moved: false };
  }
}

/** 在新位置正常运行一段时间后调用：删除搬家前留在系统盘上的备份，真正腾出空间。 */
export function cleanupMovedBackup(defaultDir: string): void {
  const pointer = readPointer(defaultDir); if (!pointer || !markerOk(pointer.dir, pointer.id)) return;
  try { rmSync(join(defaultDir, '.moved-backup'), { recursive: true, force: true }); } catch { /* 下次再清 */ }
}
