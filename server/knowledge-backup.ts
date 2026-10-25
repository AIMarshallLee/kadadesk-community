import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Knowledge } from '../shared/types';
import { LIBRARY_DIRS } from './knowledge-library';

/**
 * 资料库备份: a copy of the owner's files and of the knowledge 咔哒 answers with, put in a folder the owner chose —
 * a cloud-drive sync folder (百度网盘同步空间 / 坚果云 / iCloud / OneDrive) or a USB stick. One dated folder per day,
 * the newest KEEP kept; only folders 咔哒 made itself (they carry MARK_FILE) are ever removed.
 */
export const BACKUP_FOLDER = '咔哒资料库备份';
export const MARK_FILE = '咔哒备份说明.txt';
export const KEEP = 14;
/** A reminder appears when the last backup is older than this. */
export const REMIND_AFTER_MS = 7 * 86400000;

const cell = (v: unknown) => { const s = String(v ?? '').replace(/\r?\n/g, ' ').trim(); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const replaced = (k: Knowledge) => k.tags.includes('资料版本:已替换');
/** Knowledge in use as a CSV that 咔哒 imports again as it is (标题 / 问题 / 答案 / 相似问法 / 标签 / 场景). */
export function knowledgeCsv(knowledge: Knowledge[]): string {
  const live = knowledge.filter(k => k.enabled && k.reviewStatus !== 'pending' && !replaced(k));
  const rows = live.map(k => [k.title, k.question ?? '', k.content, (k.aliases ?? []).join('、'), k.tags.filter(t => !t.startsWith('资料版本:')).join('、'), k.scenario && k.scenario !== 'all' ? k.scenario : ''].map(cell).join(','));
  return '﻿' + ['标题,问题,答案,相似问法,标签,场景', ...rows].join('\r\n') + '\r\n';
}

const pad = (n: number) => String(n).padStart(2, '0');
export const backupStamp = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

async function size(dir: string): Promise<{ files: number; bytes: number }> {
  let files = 0, bytes = 0;
  const walk = async (d: string, depth: number) => { if (depth > 12) return; let es; try { es = await readdir(d, { withFileTypes: true }); } catch { return; } for (const e of es) { const p = join(d, e.name); if (e.isDirectory()) await walk(p, depth + 1); else if (e.isFile()) { files++; try { bytes += (await stat(p)).size; } catch { /* vanished */ } } } };
  await walk(dir, 0); return { files, bytes };
}

/** Writes today's backup into `<target>/咔哒资料库备份/<date>` (replacing today's earlier one) and trims old ones. */
export async function backupLibrary(o: { root: string; target: string; knowledge: Knowledge[]; now?: Date; /** Local files copied in as they are (a missing one is skipped). */ extra?: Array<{ name: string; path: string }> }): Promise<{ path: string; files: number; bytes: number; knowledge: number; extra: number }> {
  const now = o.now ?? new Date();
  try { if (!(await stat(o.target)).isDirectory()) throw Error(); } catch { throw new Error('备份位置现在打不开（U 盘没插上，或网盘文件夹被移走了）。插上或重新选择后再备份。'); }
  const base = join(o.target, BACKUP_FOLDER); await mkdir(base, { recursive: true });
  const dest = join(base, backupStamp(now)), temp = `${dest}.正在备份`;
  await rm(temp, { recursive: true, force: true });
  await mkdir(temp, { recursive: true });
  await writeFile(join(temp, MARK_FILE), `咔哒资料库备份 · ${now.toLocaleString('zh-CN')}\n\n「原始资料」「朋友圈图片」：你放进资料库的文件原样复制。\n「知识库备份.csv」：备份时正在用来回复客户的知识；需要恢复时，在咔哒「知识 → 导入」选这个文件即可。\n「知识库完整记录.json」：包括待确认和停用的全部知识，留作查证。\n「客户档案.json」（有的话）：咔哒「客户」页记下的客户档案，只在这里和你的电脑上。\n\n咔哒只会自动清理带这个说明文件的旧备份（保留最近 ${KEEP} 份），别的文件不会动。\n`, 'utf8');
  for (const [from, to] of [[LIBRARY_DIRS.source, '原始资料'], [LIBRARY_DIRS.images, '朋友圈图片']] as const)
    await cp(join(o.root, from), join(temp, to), { recursive: true, force: true, errorOnExist: false, filter: src => !/(^|[\\/])\.[^\\/]+$/.test(src) }).catch(e => { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; });
  await writeFile(join(temp, '知识库备份.csv'), knowledgeCsv(o.knowledge), 'utf8');
  let extra = 0;
  for (const f of o.extra ?? []) { if (!/^[^\\/:*?"<>|]{1,60}$/.test(f.name)) continue; try { await cp(f.path, join(temp, f.name), { force: true }); extra++; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; } }
  await writeFile(join(temp, '知识库完整记录.json'), JSON.stringify(o.knowledge.map(k => ({ title: k.title, question: k.question, content: k.content, aliases: k.aliases, tags: k.tags, scenario: k.scenario, enabled: k.enabled, reviewStatus: k.reviewStatus, source: k.source, sourceLocator: k.sourceLocator, updatedAt: k.updatedAt })), null, 2), 'utf8');
  await rm(dest, { recursive: true, force: true });
  await rename(temp, dest);
  // Trim: only dated folders that carry 咔哒's own mark.
  const dated = (await readdir(base)).filter(n => /^\d{4}-\d{2}-\d{2}$/.test(n)).sort();
  for (const old of dated.slice(0, Math.max(0, dated.length - KEEP))) {
    try { await readFile(join(base, old, MARK_FILE)); await rm(join(base, old), { recursive: true, force: true }); } catch { /* not ours: leave it */ }
  }
  const s = await size(dest);
  return { path: dest, ...s, knowledge: o.knowledge.filter(k => k.enabled && k.reviewStatus !== 'pending' && !replaced(k)).length, extra };
}

/** Whether to remind the owner: there is something worth keeping and no backup for a week (or never). */
export function backupDue(o: { lastBackupAt?: string; liveCount: number; sourceFiles: number; now: number }): boolean {
  if (!o.liveCount && !o.sourceFiles) return false;
  const last = o.lastBackupAt ? Date.parse(o.lastBackupAt) : NaN;
  return !Number.isFinite(last) || o.now - last > REMIND_AFTER_MS;
}
