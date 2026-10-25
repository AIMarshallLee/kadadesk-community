import { mkdir, readdir, readFile, stat, statfs, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { categorize, KNOWLEDGE_CATEGORIES } from '../shared/knowledge-categories';
import type { Knowledge } from '../shared/types';
import { ignoredDocumentName } from './knowledge-sources';

/**
 * 本地资料库: one folder on the owner's computer that holds everything the knowledge base is made of.
 *  01 原始资料 — the owner drops files here (咔哒 only reads them, never changes or moves them);
 *  02 新整理   — what 咔哒 made of new files, waiting for the owner's OK in the app;
 *  03 在用的知识库 — confirmed knowledge 咔哒 answers customers with, one file per category;
 *  04 旧版本   — knowledge replaced by a newer file or turned off, kept for reading;
 *  05 朋友圈图片 — pictures the owner uses often (朋友圈 / 群); never read as knowledge, never changed. Pictures
 *                 咔哒 generates for posts go to its own 「咔哒生成/<date>」 sub-folder (desktop/daily-moments.ts).
 * 02–04 are generated for reading only; the app stays the place where knowledge is confirmed and edited.
 */
export const LIBRARY_DIRS = { source: '01 原始资料（把文件放这里）', pending: '02 新整理（等你确认）', live: '03 在用的知识库', old: '04 旧版本', images: '05 朋友圈图片' } as const;
export const LIBRARY_NAME = '咔哒资料库';
const MARK = '<!-- 咔哒自动生成：在这里改不会生效 -->';
const README = `咔哒资料库 · 说明

01 原始资料（把文件放这里）
  把产品介绍、价目表、常见问题、聊天记录等文件放进来（PDF、Word、Excel、CSV、TXT、Markdown、网页）。可以建子文件夹分类。
  咔哒每 2 分钟看一次：有新文件或文件改过，就自动读取整理。咔哒只读，不会修改、移动或删除你的文件。
  价格变了：直接用新文件替换旧文件（同名覆盖最好），咔哒会把旧说法放进「04 旧版本」，新内容等你确认。

02 新整理（等你确认）
  咔哒从新文件里拆出来、还没启用的问答。开着「咔哒整理好的知识直接用来回复客户」时，没有冲突的会直接启用，这里只剩要你处理的；
  关掉时，要在咔哒的「知识」页点「确认」后才会用来回复客户。

03 在用的知识库
  已经确认、正在用来回复客户的知识，按类别一个文件，方便你随时翻看。

04 旧版本
  被新资料替换、或者被你停用的旧知识，按日期保存，想找回可以在咔哒里重新启用。

05 朋友圈图片
  常用的图片放这里（产品图、活动照片、个人照片…），可以建子文件夹，文件夹名就是分类，比如「产品截图」「活动现场」。
  咔哒起草朋友圈或群消息时，只会从这里挑图，并且发之前给你看。你放的图咔哒只读，不会修改或删除。
  文件夹里没有合适的图时，咔哒用 AI 生成的配图会单独放在「咔哒生成」子文件夹里（按日期分好），不会动你的图。

02、03、04 由咔哒自动生成，只用来看；在这些文件里修改不会生效，请到咔哒「知识」页修改。
`;

export const defaultLibraryRoot = (documentsDir: string) => join(documentsDir, LIBRARY_NAME);

/** Creates the four folders and the 说明 file (existing files are left alone). */
export async function ensureLibraryLayout(root: string): Promise<void> {
  for (const dir of Object.values(LIBRARY_DIRS)) await mkdir(join(root, dir), { recursive: true });
  await writeFile(join(root, '说明.txt'), README, 'utf8');
}

/** Free space on the disk holding `path` (the nearest existing parent), in bytes; undefined when it cannot be read. */
export async function freeSpace(path: string): Promise<number | undefined> {
  let p = path;
  for (let i = 0; i < 8; i++) { try { const s = await statfs(p); return Number(s.bavail) * Number(s.bsize); } catch { const parent = join(p, '..'); if (parent === p) break; p = parent; } }
  return undefined;
}

/** Files and bytes under `dir` (bounded walk; hidden files skipped). The signature changes when any file is added, removed or edited. */
export async function folderSummary(dir: string): Promise<{ files: number; bytes: number; signature: string }> {
  let files = 0, bytes = 0; const parts: string[] = [];
  async function walk(d: string, depth: number) {
    if (depth > 10 || files > 5000) return;
    let entries; try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      // Word's ~$ lock file appears while a document is open: not an edit, no reason to read the folder again.
      if (ignoredDocumentName(e.name)) continue; const p = join(d, e.name);
      if (e.isDirectory()) { await walk(p, depth + 1); continue; }
      if (!e.isFile()) continue;
      try { const s = await stat(p); files++; bytes += s.size; parts.push(`${p}|${s.size}|${Math.round(s.mtimeMs)}`); } catch { /* vanished */ }
    }
  }
  await walk(dir, 0);
  return { files, bytes, signature: parts.join('\n') };
}

const day = (iso: string) => (iso || '').slice(0, 10) || '日期未知';
const safeName = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 80).trim() || '未命名';
const replaced = (k: Knowledge) => k.tags.includes('资料版本:已替换');
/** The file a fact came from: for the library's own folder that is the file inside 01, not the folder. */
const fileOf = (k: Knowledge) => k.source?.startsWith(LIBRARY_DIRS.source.slice(0, 2)) && k.sourceLocator ? k.sourceLocator.split(' · ')[0] : (k.source || '手动录入');
const where = (k: Knowledge) => [k.source && !k.source.startsWith(LIBRARY_DIRS.source.slice(0, 2)) ? k.source : '', k.sourceLocator].filter(Boolean).join(' · ') || '手动录入';
const localStamp = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const entry = (k: Knowledge) => [`## ${k.question?.trim() || k.title}`, '', k.content.trim(), '', `来源：${where(k)} ｜ 更新：${day(k.updatedAt)}`, ''].join('\n');
const page = (title: string, items: Knowledge[], note: string) => [MARK, `# ${title}（${items.length} 条）`, '', `> ${note}`, '', ...items.map(entry)].join('\n');

/** The generated files for 02–04: relative path → content. */
export function libraryMirror(knowledge: Knowledge[], now = new Date()): Map<string, string> {
  const out = new Map<string, string>(); const stamp = localStamp(now);
  const pending = knowledge.filter(k => k.reviewStatus === 'pending' && !replaced(k));
  const live = knowledge.filter(k => k.enabled && k.reviewStatus !== 'pending' && !replaced(k));
  const old = knowledge.filter(k => replaced(k) || (!k.enabled && k.reviewStatus !== 'pending'));
  const bySource = new Map<string, Knowledge[]>();
  for (const k of pending) { const key = safeName(fileOf(k).replace(/\.[a-z0-9]+$/i, '')); bySource.set(key, [...(bySource.get(key) ?? []), k]); }
  for (const [src, items] of bySource) out.set(join(LIBRARY_DIRS.pending, `来自 ${src}.md`), page(`来自「${src}」的新整理`, items, `等你在咔哒「知识」页确认后才会用来回复客户。生成于 ${stamp}。`));
  for (const cat of KNOWLEDGE_CATEGORIES) {
    const items = live.filter(k => categorize(`${k.title} ${k.question ?? ''}`, k.tags) === cat);
    if (items.length) out.set(join(LIBRARY_DIRS.live, `${cat}${cat === '内部资料' ? '（不发给客户）' : ''}.md`), page(cat, items, `正在用来回复客户的知识。生成于 ${stamp}。要修改请到咔哒「知识」页。`));
  }
  const byDay = new Map<string, Knowledge[]>();
  for (const k of old) byDay.set(day(k.updatedAt), [...(byDay.get(day(k.updatedAt)) ?? []), k]);
  for (const [d, items] of byDay) out.set(join(LIBRARY_DIRS.old, `${d}.md`), page(`${d} 停用或被替换的知识`, items, '这些说法已经不再用来回复客户。想找回，到咔哒「知识 → 管理资料」重新启用。'));
  return out;
}

/** Writes 02–04 and removes generated files that are no longer current; files the owner put there by hand are kept. */
export async function writeLibraryMirror(root: string, knowledge: Knowledge[], now = new Date()): Promise<{ pending: number; live: number; old: number }> {
  const files = libraryMirror(knowledge, now);
  for (const dir of [LIBRARY_DIRS.pending, LIBRARY_DIRS.live, LIBRARY_DIRS.old]) {
    await mkdir(join(root, dir), { recursive: true });
    for (const name of await readdir(join(root, dir))) {
      const rel = join(dir, name); if (!name.endsWith('.md') || files.has(rel)) continue;
      try { if ((await readFile(join(root, rel), 'utf8')).startsWith(MARK)) await unlink(join(root, rel)); } catch { /* keep */ }
    }
  }
  for (const [rel, content] of files) {
    const target = join(root, rel); let same = false;
    try { same = (await readFile(target, 'utf8')).replace(/生成于 [0-9: -]+。/g, '') === content.replace(/生成于 [0-9: -]+。/g, ''); } catch { /* new */ }
    if (!same) await writeFile(target, content, 'utf8');
  }
  return {
    pending: knowledge.filter(k => k.reviewStatus === 'pending' && !replaced(k)).length,
    live: knowledge.filter(k => k.enabled && k.reviewStatus !== 'pending' && !replaced(k)).length,
    old: knowledge.filter(k => replaced(k) || (!k.enabled && k.reviewStatus !== 'pending')).length,
  };
}
