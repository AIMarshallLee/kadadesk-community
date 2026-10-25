import { createHash } from 'node:crypto';
import { readdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { backupDue, backupLibrary } from '../server/knowledge-backup';
import { defaultLibraryRoot, ensureLibraryLayout, folderSummary, freeSpace, LIBRARY_DIRS, writeLibraryMirror } from '../server/knowledge-library';
import type { Knowledge } from '../shared/types';
import type { KnowledgeSourceView } from '../shared/knowledge-sources';

export interface LibraryStatus {
  configured: boolean; root?: string; suggested: string; freeBytes?: number;
  sourceFiles: number; sourceBytes: number; counts: { pending: number; live: number; old: number };
  syncing: boolean; lastSyncAt?: string; lastResult?: string; error?: boolean;
  /** 备份: where a daily copy goes (cloud-drive sync folder or USB stick), when it last worked, and whether to remind. */
  backup: { dir?: string; lastAt?: string; result?: string; error?: boolean; due: boolean; running: boolean; suggestions: Array<{ label: string; path: string }> };
}
type Settings = { root?: string; sourceId?: string; signature?: string; lastSyncAt?: string; lastResult?: string; error?: boolean; mirrorHash?: string; counts?: LibraryStatus['counts'];
  backupDir?: string; lastBackupAt?: string; backupResult?: string; backupError?: boolean; backupTriedAt?: string };
const DAY = 86400000;
/** Folders that are synced to a cloud drive, or USB sticks, found on this computer: offered as one-click backup places. */
export async function backupSuggestions(home: string, platform = process.platform): Promise<Array<{ label: string; path: string }>> {
  const out: Array<{ label: string; path: string }> = [];
  const isDir = async (p: string) => { try { return (await stat(p)).isDirectory(); } catch { return false; } };
  const fixed: Array<[string, string]> = [['iCloud 云盘', join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs')], ['坚果云', join(home, '坚果云')], ['坚果云', join(home, 'Nutstore Files')], ['百度网盘同步空间', join(home, '百度网盘同步空间')], ['百度网盘同步空间', join(home, 'BaiduSyncdisk')], ['OneDrive', join(home, 'OneDrive')]];
  for (const [label, path] of fixed) if (await isDir(path)) out.push({ label, path });
  try { for (const n of await readdir(join(home, 'Library', 'CloudStorage'))) if (/^(OneDrive|GoogleDrive|Dropbox)/.test(n)) out.push({ label: n.split('-')[0], path: join(home, 'Library', 'CloudStorage', n) }); } catch { /* none */ }
  if (platform === 'darwin') { try { for (const n of await readdir('/Volumes')) { const p = join('/Volumes', n); if (n !== 'Macintosh HD' && !n.startsWith('.') && (await realpath(p).catch(() => p)) !== '/' && await isDir(p)) out.push({ label: `U 盘/移动硬盘「${n}」`, path: p }); } } catch { /* none */ } }
  return out.slice(0, 6);
}
type Request = (r: { method: string; path: string; body?: Record<string, unknown> }) => Promise<unknown>;

/**
 * 本地资料库 controller: creates the folder, registers 01 as a folder knowledge source, reads it again whenever a file
 * there is added or changed (every 2 minutes), and keeps 02–04 in step with the knowledge base (every minute).
 */
export function createKnowledgeLibrary(o: { settingsFile: string; documentsDir: string; homeDir?: string; request: Request; addFolder: (path: string) => Promise<unknown>; now?: () => number;
  /** More local files copied into each backup as they are (e.g. 客户档案.json). */
  extraBackup?: () => Promise<Array<{ name: string; path: string }>> }) {
  let settings: Settings = {}; let loaded = false, syncing = false, refreshing = false, backingUp = false;
  const now = o.now ?? Date.now;
  const load = async () => { if (loaded) return; loaded = true; try { settings = JSON.parse(await readFile(o.settingsFile, 'utf8')) ?? {}; } catch { settings = {}; } };
  const save = async () => { await writeFile(o.settingsFile + '.tmp', JSON.stringify(settings, null, 2)); await rename(o.settingsFile + '.tmp', o.settingsFile); };
  const sourceDir = () => join(settings.root!, LIBRARY_DIRS.source);
  async function sourceId(): Promise<string | undefined> {
    const view = await o.request({ method: 'GET', path: '/knowledge/sources' }) as KnowledgeSourceView; const dir = await realpath(sourceDir()).catch(() => sourceDir());
    return view.sources.find(s => s.kind === 'folder' && s.location === dir)?.id;
  }
  async function status(): Promise<LibraryStatus> {
    await load(); const suggested = defaultLibraryRoot(o.documentsDir);
    const sum = settings.root ? await folderSummary(sourceDir()) : { files: 0, bytes: 0 };
    return { configured: !!settings.root, ...(settings.root ? { root: settings.root } : {}), suggested, freeBytes: await freeSpace(settings.root ?? suggested), sourceFiles: sum.files, sourceBytes: sum.bytes,
      counts: settings.counts ?? { pending: 0, live: 0, old: 0 }, syncing, ...(settings.lastSyncAt ? { lastSyncAt: settings.lastSyncAt } : {}), ...(settings.lastResult ? { lastResult: settings.lastResult } : {}), ...(settings.error ? { error: true } : {}),
      backup: { ...(settings.backupDir ? { dir: settings.backupDir } : {}), ...(settings.lastBackupAt ? { lastAt: settings.lastBackupAt } : {}), ...(settings.backupResult ? { result: settings.backupResult } : {}), ...(settings.backupError ? { error: true } : {}),
        due: !!settings.root && backupDue({ lastBackupAt: settings.lastBackupAt, liveCount: settings.counts?.live ?? 0, sourceFiles: sum.files, now: now() }), running: backingUp,
        suggestions: settings.backupDir || !o.homeDir ? [] : await backupSuggestions(o.homeDir) } };
  }
  /** Copies the library and the knowledge in use to the backup place now. */
  async function backup(): Promise<LibraryStatus> {
    await load(); if (!settings.root) throw new Error('先建好咔哒资料库，再设置备份。'); if (!settings.backupDir) throw new Error('先选一个备份位置（网盘同步文件夹或 U 盘）。');
    if (backingUp) return status(); backingUp = true; settings.backupTriedAt = new Date(now()).toISOString();
    try {
      const knowledge = ((await o.request({ method: 'GET', path: '/state' })) as { knowledge: Knowledge[] }).knowledge ?? [];
      const extra = await o.extraBackup?.().catch(() => []) ?? [];
      const r = await backupLibrary({ root: settings.root, target: settings.backupDir, knowledge, now: new Date(now()), extra });
      settings.lastBackupAt = new Date(now()).toISOString(); settings.backupError = false;
      settings.backupResult = `已备份 ${r.knowledge} 条在用知识${r.extra ? '、客户档案' : ''}和 ${Math.max(0, r.files - 3 - r.extra)} 个你放进去的文件。`;
    } catch (e) { settings.backupError = true; settings.backupResult = (e as Error).message.replace(/^Error: /, ''); }
    finally { backingUp = false; await save(); }
    return status();
  }
  async function setBackupDir(dir: string | undefined): Promise<LibraryStatus> {
    await load(); settings.backupDir = dir || undefined; settings.backupResult = undefined; settings.backupError = false; await save();
    return dir ? backup() : status();
  }
  /** Once a day, when the backup place is there (USB stick plugged in, cloud folder present). Failures are retried every 6 hours, quietly. */
  async function autoBackup(): Promise<void> {
    await load(); if (!settings.root || !settings.backupDir || backingUp) return;
    const last = settings.lastBackupAt ? Date.parse(settings.lastBackupAt) : 0, tried = settings.backupTriedAt ? Date.parse(settings.backupTriedAt) : 0;
    if (now() - last < DAY - 3600000 || now() - tried < 6 * 3600000) return;
    try { if (!(await stat(settings.backupDir)).isDirectory()) return; } catch { return; }
    await backup().catch(() => {});
  }
  async function create(root?: string): Promise<LibraryStatus> {
    await load(); const target = root || defaultLibraryRoot(o.documentsDir);
    await ensureLibraryLayout(target);
    settings = { root: target }; await o.addFolder(sourceDir()); settings.sourceId = await sourceId(); await save();
    await refresh(true); return status();
  }
  /** Reads 01 again when something there changed (or when asked). */
  async function sync(force = false): Promise<void> {
    await load(); if (!settings.root || syncing) return;
    const sum = await folderSummary(sourceDir());
    if (!force && sum.signature === settings.signature) return;
    if (!sum.files) { settings.signature = sum.signature; settings.lastResult = '「01 原始资料」里还没有文件。'; settings.error = false; await save(); return; }
    syncing = true;
    try {
      settings.sourceId ??= await sourceId(); if (!settings.sourceId) { await o.addFolder(sourceDir()); settings.sourceId = await sourceId(); }
      const view = await o.request({ method: 'POST', path: '/knowledge/sources/sync', body: { ids: [settings.sourceId], confirm: true } }) as KnowledgeSourceView;
      const src = view.sources.find(s => s.id === settings.sourceId);
      settings.error = src?.status === 'error'; settings.lastResult = src?.detail ?? '已整理。'; settings.lastSyncAt = new Date(now()).toISOString();
      if (!settings.error) settings.signature = sum.signature;
    } catch (e) {
      // Busy with another import: try again on the next round without recording the files as read.
      settings.lastResult = (e as Error).message.replace(/^Error: /, ''); settings.error = !/正在|运行中/.test(settings.lastResult);
    } finally { syncing = false; await save(); }
    await refresh();
  }
  /** Rewrites 02–04 when the knowledge base changed. */
  async function refresh(force = false): Promise<void> {
    await load(); if (!settings.root || refreshing) return; refreshing = true;
    try {
      const knowledge = ((await o.request({ method: 'GET', path: '/state' })) as { knowledge: Knowledge[] }).knowledge ?? [];
      const hash = createHash('sha256').update(JSON.stringify(knowledge.map(k => [k.id, k.updatedAt, k.enabled, k.reviewStatus, k.tags]))).digest('hex');
      if (!force && hash === settings.mirrorHash) return;
      settings.counts = await writeLibraryMirror(settings.root, knowledge, new Date(now())); settings.mirrorHash = hash; await save();
    } catch { /* folder moved or unplugged disk: try again next minute */ } finally { refreshing = false; }
  }
  let timers: NodeJS.Timeout[] = [];
  return {
    status, create, sync, refresh, backup, setBackupDir, autoBackup,
    sourceDir: async () => { await load(); return settings.root ? sourceDir() : undefined; },
    root: async () => { await load(); return settings.root; },
    start() { void load().then(() => settings.root ? ensureLibraryLayout(settings.root) : undefined).catch(() => {}); timers = [setInterval(() => { void sync(); }, 120_000), setInterval(() => { void refresh(); }, 60_000), setInterval(() => { void autoBackup(); }, 30 * 60_000)]; for (const t of timers) t.unref(); setTimeout(() => { void sync(); void refresh(); }, 20_000).unref(); setTimeout(() => { void autoBackup(); }, 5 * 60_000).unref(); },
    stop() { for (const t of timers) clearInterval(t); timers = []; },
  };
}
