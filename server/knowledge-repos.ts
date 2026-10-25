import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, parse as parsePath, relative, resolve, sep } from 'node:path';
import type { AppState, Knowledge } from '../shared/types';
import type { KnowledgeDraft, KnowledgeImportInput, KnowledgeReviewResult } from '../shared/knowledge';
import { CATEGORY_TAG_PREFIX, categorize, withCategoryTag } from '../shared/knowledge-categories';
import { redactSecrets } from '../shared/secret-guard';
import {
  REPO_SYNC_LIMITS, STYLE_REFERENCE_TAG, cleanRepoText, defaultRules, parseRepoUrl, purposeFor, readRules, repoFileWanted, summarizeFolders,
  type RepoChange, type RepoFolder, type RepoLimits, type RepoPurpose, type RepoRules, type RepoSourceView, type RepoView,
} from '../shared/knowledge-repos';
import { knowledgeFingerprint, readKnowledgeDraft } from './knowledge';
import type { OrganizedKnowledge, OrganizeSource } from './knowledge-organize';
import { GITHUB_OFFLINE, GITHUB_RATE_LIMIT, githubFetch } from './knowledge-expand';
import { GIT_MISSING, GitProblem, type GitClient } from './knowledge-repo-git';

/**
 * 自动更新的知识来源 (engine). A source is a GitHub repository or a folder on this computer. Each sync:
 *  1. light check: the remote commit (git ls-remote, or GitHub's API for a public repository) or the folder's file
 *     sizes and times; nothing changed and nothing waiting → done, no model call, nothing read;
 *  2. bring the files up to date (shallow clone / fetch into kadadesk's data folder, the API tree, or the folder listing);
 *  3. per file (path + content hash): new and changed files of the chosen folders are cleaned, read by the ordinary
 *     import parser, secrets are hidden, 「回复客户用」 files are organized by the owner's own reply model (capped per
 *     sync, never on the free trial relay), and the entries replace that file's previous entries. Entries the owner
 *     edited are never overwritten: the new version waits for the owner. A file gone upstream disables its entries.
 * Knowledge content is never logged; only counts leave this module.
 */

export interface RepoListed { path: string; size: number; hash?: string; mtimeMs?: number }
/** What kadadesk remembers per file of a source. `fps` holds each entry's content as imported, to see owner edits. */
export interface RepoFileRecord { hash: string; purpose: RepoPurpose; ids: string[]; fps: Record<string, string>; organized: boolean; status: 'done' | 'failed' | 'removed'; reason?: string; size?: number; mtimeMs?: number }
export type RepoIndex = Record<string, RepoFileRecord>;
export interface RepoWork { path: string; size: number; hash: string; purpose: RepoPurpose; why: 'new' | 'changed' | 'purpose' | 'upgrade' }
export interface RepoPlan { work: RepoWork[]; removed: Array<{ path: string; reason: 'deleted' | 'unselected' | 'skipped' }>; skipped: Array<{ path: string; reason: string }>; selected: number }

interface SourceRecord extends RepoSourceView { owner?: string; repo?: string; revision?: string; rulesHash?: string; errorNotifiedAt?: string; readyToUpgrade?: number }
export interface RepoNotice { kind: 'changed' | 'error'; title: string; body: string; counts?: RepoChange }
export type ModelMode = 'own' | 'trial' | 'none';

export interface RepoEngineOptions {
  dataDir: string;
  getState(): AppState;
  mutate(action: string, taskId: string | undefined, detail: string, change: () => void): Promise<void>;
  parse(input: KnowledgeImportInput): Promise<{ rows: KnowledgeDraft[]; warnings: string[] }>;
  organize(rows: OrganizeSource[]): Promise<OrganizedKnowledge>;
  /** 'own': the owner's model is configured; 'trial': only kadadesk's free trial relay (never used for organizing); 'none'. */
  modelMode(): Promise<ModelMode>;
  /** 「整理完直接启用」: approves what can be approved; undefined when the owner turned it off. */
  autoEnable(ids: string[]): Promise<KnowledgeReviewResult | undefined>;
  git: GitClient;
  fetchImpl?: typeof fetch;
  now?: () => number;
  notify?(notice: RepoNotice): void;
  limits?: Partial<RepoLimits>;
}

const REMOVED_TAG = '资料状态:来源已删除';
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
/** The entry as the owner sees it: title, answer, question, other phrasings, scenario and tags (not kadadesk's status tags). */
export const entryFingerprint = (k: Pick<Knowledge, 'title' | 'content' | 'question' | 'aliases' | 'scenario' | 'tags'>) => sha256(JSON.stringify([k.title, k.content, k.question ?? '', [...(k.aliases ?? [])].sort(), k.scenario ?? 'all', k.tags.filter(t => !/^资料(?:状态|版本):/.test(t)).sort()]));
/** Edited by the owner since kadadesk imported it (content differs from what was imported; unknown → the editor's mark). */
const ownerEdited = (k: Knowledge, fps: Record<string, string> | undefined) => fps?.[k.id] !== undefined ? entryFingerprint(k) !== fps[k.id] : k.heldForReview === true;
export const repoImportId = (sourceId: string) => `repo_${sourceId}`;
const plural = (c: RepoChange) => `新增 ${c.added} 份、更新 ${c.updated} 份、停用 ${c.disabled} 份`;

/** Which files need work, which are unchanged, which are gone. Pure: the test suite drives it directly. */
export function planRepoSync(listing: RepoListed[], index: RepoIndex, rules: RepoRules, options: { canOrganize: boolean; limits?: Pick<RepoLimits, 'fileBytes'> }): RepoPlan {
  const work: RepoWork[] = [], removed: RepoPlan['removed'] = [], skipped: RepoPlan['skipped'] = []; let selected = 0;
  const seen = new Set<string>();
  for (const file of listing) {
    seen.add(file.path);
    const wanted = repoFileWanted(file.path, file.size, options.limits);
    const purpose = wanted === false ? undefined : purposeFor(file.path, rules);
    const record = index[file.path];
    const active = record && record.status !== 'removed';
    if (!purpose || wanted !== true) {
      if (purpose && typeof wanted === 'string') skipped.push({ path: file.path, reason: wanted });
      if (active && record.ids.length) removed.push({ path: file.path, reason: purpose ? 'skipped' : 'unselected' });
      continue;
    }
    selected++;
    const hash = file.hash ?? '';
    if (!record || record.status === 'removed') work.push({ path: file.path, size: file.size, hash, purpose, why: 'new' });
    else if (record.hash !== hash) work.push({ path: file.path, size: file.size, hash, purpose, why: 'changed' });
    else if (record.purpose !== purpose) work.push({ path: file.path, size: file.size, hash, purpose, why: 'purpose' });
    else if (purpose === 'reply' && record.status === 'done' && !record.organized && options.canOrganize) work.push({ path: file.path, size: file.size, hash, purpose, why: 'upgrade' });
  }
  for (const [path, record] of Object.entries(index)) if (!seen.has(path) && record.status !== 'removed' && record.ids.length) removed.push({ path, reason: 'deleted' });
  const order = { changed: 0, purpose: 1, new: 2, upgrade: 3 };
  work.sort((a, b) => order[a.why] - order[b.why] || a.path.localeCompare(b.path));
  return { work, removed, skipped, selected };
}

/**
 * Puts one file's new rows in place of its previous entries. Unchanged facts keep their entry (and approval); entries
 * the owner edited stay exactly as they are and the file's new rows then wait for the owner (heldForReview), so the
 * usual review shows 「停用旧条目并启用新条目」. Other previous entries are removed. Mutates `knowledge`.
 */
export function applyRepoFile(knowledge: Knowledge[], input: { importId: string; previous?: Pick<RepoFileRecord, 'ids' | 'fps'>; rows: KnowledgeDraft[]; now: string; newId?: () => string }): { created: Knowledge[]; kept: Knowledge[]; removed: string[]; edited: string[]; duplicates: number; record: Pick<RepoFileRecord, 'ids' | 'fps'> } {
  const previousIds = new Set(input.previous?.ids ?? []);
  const own = knowledge.filter(k => previousIds.has(k.id) && k.importId === input.importId);
  const edited = own.filter(k => ownerEdited(k, input.previous?.fps));
  const untouched = own.filter(k => !edited.includes(k));
  const byFingerprint = new Map(untouched.map(k => [knowledgeFingerprint(k), k]));
  const editedFingerprints = new Set(edited.map(k => knowledgeFingerprint(k)));
  const ownIds = new Set(own.map(k => k.id));
  const elsewhere = new Set(knowledge.filter(k => !ownIds.has(k.id)).map(k => knowledgeFingerprint(k)));
  const created: Knowledge[] = [], kept: Knowledge[] = []; let duplicates = 0;
  const fps: Record<string, string> = {};
  for (const row of input.rows) {
    const fingerprint = knowledgeFingerprint(row);
    const same = byFingerprint.get(fingerprint);
    if (same) {
      byFingerprint.delete(fingerprint);
      // The fact came back unchanged: it keeps answering, approval intact (also after the file was deleted and restored).
      if (same.tags.includes(REMOVED_TAG)) { same.tags = same.tags.filter(t => t !== REMOVED_TAG); if (same.approvedAt && same.reviewStatus !== 'pending') same.enabled = true; }
      if (same.sourceLocator !== row.sourceLocator) same.sourceLocator = row.sourceLocator;
      same.updatedAt = input.now; kept.push(same); fps[same.id] = entryFingerprint(same); continue;
    }
    if (editedFingerprints.has(fingerprint) || elsewhere.has(fingerprint)) { duplicates++; continue; }
    elsewhere.add(fingerprint);
    const entry: Knowledge = { ...row, id: input.newId?.() ?? `knowledge_${randomUUID()}`, enabled: false, reviewStatus: 'pending', importId: input.importId, createdAt: input.now, updatedAt: input.now, ...(edited.length ? { heldForReview: true as const } : {}) };
    knowledge.push(entry); created.push(entry); fps[entry.id] = entryFingerprint(entry);
  }
  const removed = [...byFingerprint.values()].map(k => k.id);
  for (let i = knowledge.length - 1; i >= 0; i--) if (removed.includes(knowledge[i]!.id)) knowledge.splice(i, 1);
  for (const k of edited) fps[k.id] = input.previous!.fps[k.id] ?? entryFingerprint(k);
  return { created, kept, removed, edited: edited.map(k => k.id), duplicates, record: { ids: [...kept, ...created, ...edited].map(k => k.id), fps } };
}

/** A file gone upstream (or no longer chosen): its entries stop answering and say why; entries the owner edited stay. */
export function disableRepoFile(knowledge: Knowledge[], input: { importId: string; previous: Pick<RepoFileRecord, 'ids' | 'fps'>; now: string }): { disabled: number; edited: number } {
  let disabled = 0, edited = 0;
  for (const k of knowledge) {
    if (!input.previous.ids.includes(k.id) || k.importId !== input.importId) continue;
    if (ownerEdited(k, input.previous.fps)) { edited++; continue; }
    if (!k.tags.includes(REMOVED_TAG)) { k.tags = [...k.tags, REMOVED_TAG].slice(-20); k.enabled = false; k.updatedAt = input.now; disabled++; }
  }
  return { disabled, edited };
}

/** Tags by purpose. 写法参考 carries 「写法参考·文案」 (style finders key on 文案); 内部参考 is 内部资料. */
export function purposeTags(purpose: RepoPurpose, row: Pick<KnowledgeDraft, 'title' | 'question' | 'content' | 'tags'>): string[] {
  if (purpose === 'style') return [STYLE_REFERENCE_TAG];
  if (purpose === 'internal') return [CATEGORY_TAG_PREFIX + '内部资料'];
  const tags = [...new Set(row.tags.map(t => t.trim()).filter(t => t && t.length <= 100 && !t.startsWith(CATEGORY_TAG_PREFIX) && t !== STYLE_REFERENCE_TAG))].slice(0, 18);
  return withCategoryTag(tags, categorize(`${row.title} ${row.question ?? ''} ${row.content.slice(0, 200)}`, tags));
}

/** Every secret-shaped string hidden from a row (title, question, phrasings, answer) before it is stored or organized. */
export function redactRow<T extends KnowledgeDraft>(row: T): { row: T; count: number } {
  let count = 0;
  const hide = (text: string) => { const r = redactSecrets(text); count += r.count; return r.count ? r.text : text; };
  const out = { ...row, title: hide(row.title), content: hide(row.content), ...(row.question ? { question: hide(row.question) } : {}), ...(row.aliases ? { aliases: row.aliases.map(hide) } : {}) };
  return { row: out, count };
}

class ModelUnavailable extends Error {}
class Stopped extends Error {}

export async function createKnowledgeRepos(options: RepoEngineOptions) {
  const limits: RepoLimits = { ...REPO_SYNC_LIMITS, ...options.limits };
  const now = options.now ?? Date.now;
  const iso = (t = now()) => new Date(t).toISOString();
  const fetchImpl = options.fetchImpl ?? fetch;
  const root = join(options.dataDir, 'knowledge-repos');
  const storeFile = join(options.dataDir, 'knowledge-repos.json');
  let sources: SourceRecord[] = [];
  try {
    const raw = JSON.parse(await readFile(storeFile, 'utf8')) as { sources?: SourceRecord[] };
    if (!Array.isArray(raw?.sources)) throw new Error('bad');
    sources = raw.sources.filter(s => s && typeof s.id === 'string' && /^[a-z0-9-]{8,64}$/.test(s.id) && (s.kind === 'github' || s.kind === 'folder') && typeof s.location === 'string').slice(0, limits.sources);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') sources = []; }
  for (const s of sources) if (s.status === 'syncing' || s.status === 'preparing') { s.status = s.folders?.length ? 'ready' : 'error'; s.detail = '上次更新被打断了，下次会接着整理。'; }
  let writeTail: Promise<void> = Promise.resolve();
  const atomic = async (file: string, value: unknown) => { await mkdir(join(file, '..'), { recursive: true }); await writeFile(file + '.tmp', JSON.stringify(value), 'utf8'); await rename(file + '.tmp', file); };
  const persist = () => { const snapshot = { version: 1, sources: structuredClone(sources) }; const run = writeTail.then(() => atomic(storeFile, snapshot)); writeTail = run.catch(() => undefined); return run; };
  const sourceDir = (s: SourceRecord) => join(root, s.id);
  const indexFile = (s: SourceRecord) => join(sourceDir(s), 'index.json');
  const loadIndex = async (s: SourceRecord): Promise<RepoIndex> => { try { const v = JSON.parse(await readFile(indexFile(s), 'utf8')); return v && typeof v === 'object' && v.files && typeof v.files === 'object' ? v.files : {}; } catch { return {}; } };
  const saveIndex = (s: SourceRecord, files: RepoIndex) => atomic(indexFile(s), { files });

  let job: Promise<void> | undefined, running: RepoView['running'], stopRequested = false, aborter: AbortController | undefined;
  const view = (): RepoView => ({ sources: sources.map(({ owner: _o, repo: _r, revision: _v, rulesHash: _h, errorNotifiedAt: _e, readyToUpgrade: _u, ...s }) => structuredClone(s)), ...(running ? { running: { ...running } } : {}), stopRequested, intervalHours: limits.intervalHours });
  const find = (id: unknown) => { const s = sources.find(x => x.id === id); if (!s) throw new Error('这个知识来源已经不在了，请刷新。'); return s; };
  function start(s: SourceRecord, manual: boolean, phase: string, work: (signal: AbortSignal) => Promise<void>) {
    if (job) throw new Error(running?.id === s.id ? '这个来源正在更新，请稍等。' : '正在更新另一个知识来源，请等它完成或点「停下」。');
    stopRequested = false; aborter = new AbortController();
    running = { id: s.id, phase, done: 0, total: 0, manual };
    const signal = aborter.signal;
    job = work(signal).catch(() => undefined).finally(() => { job = undefined; running = undefined; aborter = undefined; stopRequested = false; void persist().catch(() => undefined); });
  }
  const checkStop = () => { if (stopRequested) throw new Stopped(); };

  // —— GitHub over its public API (no git needed) ——
  class ApiUnavailable extends Error { constructor(public reason: 'private' | 'rate' | 'offline' | 'big') { super(reason); } }
  async function apiRevision(s: SourceRecord, signal: AbortSignal): Promise<string> {
    let r: Awaited<ReturnType<typeof githubFetch>>;
    try { r = await githubFetch(fetchImpl, `https://api.github.com/repos/${encodeURIComponent(s.owner!)}/${encodeURIComponent(s.repo!)}/commits/HEAD`, 64 * 1024, 20000, 'application/vnd.github.sha'); }
    catch { throw new ApiUnavailable('offline'); }
    checkStop(); if (signal.aborted) throw new Stopped();
    if (r.response.status === 404 || r.response.status === 401 || r.response.status === 451) { await r.response.body?.cancel().catch(() => {}); throw new ApiUnavailable('private'); }
    if (r.response.status === 403 || r.response.status === 429) { await r.response.body?.cancel().catch(() => {}); throw new ApiUnavailable('rate'); }
    if (!r.response.ok) { await r.response.body?.cancel().catch(() => {}); throw new ApiUnavailable('offline'); }
    const text = (await r.read()).toString('utf8').trim();
    if (!/^[0-9a-f]{40}$/.test(text)) throw new ApiUnavailable('offline');
    return text;
  }
  async function apiTree(s: SourceRecord, revision: string): Promise<RepoListed[]> {
    let r: Awaited<ReturnType<typeof githubFetch>>;
    try { r = await githubFetch(fetchImpl, `https://api.github.com/repos/${encodeURIComponent(s.owner!)}/${encodeURIComponent(s.repo!)}/git/trees/${revision}?recursive=1`, 24 * 1024 * 1024, 30000); }
    catch { throw new ApiUnavailable('offline'); }
    if (r.response.status === 404 || r.response.status === 401) { await r.response.body?.cancel().catch(() => {}); throw new ApiUnavailable('private'); }
    if (r.response.status === 403 || r.response.status === 429) { await r.response.body?.cancel().catch(() => {}); throw new ApiUnavailable('rate'); }
    if (!r.response.ok) { await r.response.body?.cancel().catch(() => {}); throw new ApiUnavailable('offline'); }
    let tree: { tree?: Array<{ path?: unknown; type?: unknown; size?: unknown; sha?: unknown; mode?: unknown }>; truncated?: unknown };
    try { tree = JSON.parse((await r.read()).toString('utf8')); } catch { throw new ApiUnavailable('offline'); }
    if (tree.truncated === true) throw new ApiUnavailable('big');
    return (tree.tree ?? []).filter(e => e.type === 'blob' && typeof e.path === 'string' && typeof e.sha === 'string' && (e.mode === '100644' || e.mode === '100755'))
      .map(e => ({ path: e.path as string, size: typeof e.size === 'number' ? e.size : 0, hash: e.sha as string }));
  }
  async function apiRead(s: SourceRecord, revision: string, path: string): Promise<Buffer> {
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    const r = await githubFetch(fetchImpl, `https://raw.githubusercontent.com/${encodeURIComponent(s.owner!)}/${encodeURIComponent(s.repo!)}/${revision}/${encoded}`, limits.fileBytes, 30000, '*/*');
    if (!r.response.ok) { await r.response.body?.cancel().catch(() => {}); throw new Error(r.response.status === 404 ? '文件找不到了' : '下载失败'); }
    return r.read();
  }
  const apiMessage = (reason: ApiUnavailable['reason']) => reason === 'private' ? '这个仓库是私有的（或打不开）。读私有仓库要用这台电脑的 git 和已经登录的 GitHub 账号。' + GIT_MISSING : reason === 'rate' ? GITHUB_RATE_LIMIT : reason === 'big' ? '仓库太大，GitHub 网页接口只给了一部分文件列表；装好 git 后就能完整读取。' + GIT_MISSING : GITHUB_OFFLINE;

  // —— a folder on this computer ——
  async function walkFolder(location: string): Promise<RepoListed[]> {
    const actual = await realpath(location).catch(() => { throw new Error('找不到这个文件夹了：可能被移动、改名，或移动硬盘没插上。'); });
    if (actual === parsePath(actual).root) throw new Error('请选择具体的资料文件夹，不要选整个磁盘。');
    const out: RepoListed[] = []; let examined = 0;
    async function walk(directory: string, depth: number) {
      if (depth > 12) return;
      let entries: import('node:fs').Dirent[];
      try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (++examined > limits.listedFiles * 2) throw new Error(`文件夹里的东西太多了（超过 ${limits.listedFiles * 2} 项），请选一个更具体的资料文件夹。`);
        const file = join(directory, entry.name), rel = relative(actual, file).split(sep).join('/');
        let st: import('node:fs').Stats; try { st = await lstat(file); } catch { continue; }
        if (st.isSymbolicLink()) continue;
        if (st.isDirectory()) { if (repoFileWanted(rel + '/x.md', 1, limits) === false) continue; await walk(file, depth + 1); continue; }
        if (!st.isFile() || repoFileWanted(rel, st.size, limits) === false) continue;
        out.push({ path: rel, size: st.size, mtimeMs: st.mtimeMs });
      }
    }
    await walk(actual, 0);
    return out;
  }
  /** Reads a file inside the folder only: no symlink, no path outside it, unchanged while read. */
  async function safeRead(base: string, path: string): Promise<Buffer> {
    if (!path || isAbsolute(path) || path.split('/').some(p => !p || p === '..' || p === '.')) throw new Error('路径无效');
    const baseReal = await realpath(base), file = resolve(baseReal, ...path.split('/'));
    const rel = relative(baseReal, file); if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('路径无效');
    const before = await lstat(file); if (before.isSymbolicLink() || !before.isFile()) throw new Error('不是普通文件');
    if (before.size > limits.fileBytes) throw new Error('文件太大');
    const real = await realpath(file), realRel = relative(baseReal, real); if (realRel.startsWith('..') || isAbsolute(realRel)) throw new Error('路径无效');
    const bytes = await readFile(real); const after = await lstat(real);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error('文件正在被修改，下次再读');
    return bytes;
  }

  /** The transport of a source for this round: light check, listing, reading. */
  async function transportFor(s: SourceRecord, signal: AbortSignal) {
    if (s.kind === 'folder') {
      let listed: RepoListed[] | undefined;
      return {
        kind: 'folder' as const,
        revision: async () => { listed = await walkFolder(s.location); return sha256(listed.map(f => `${f.path}\0${f.size}\0${Math.round(f.mtimeMs ?? 0)}`).join('\n')); },
        list: async () => listed ?? await walkFolder(s.location),
        read: (f: RepoListed) => safeRead(s.location, f.path),
      };
    }
    const gitTransport = () => ({
      kind: 'git' as const,
      revision: () => options.git.remoteHead(s.location, signal),
      list: async (): Promise<RepoListed[]> => { await mkdir(sourceDir(s), { recursive: true }); await options.git.update(s.location, join(sourceDir(s), 'repo'), signal); return (await options.git.tree(join(sourceDir(s), 'repo'), signal)).map(e => ({ path: e.path, size: e.size, hash: e.hash })); },
      read: (f: RepoListed) => safeRead(join(sourceDir(s), 'repo'), f.path),
    });
    if (s.transport === 'git') return gitTransport();
    // Public repositories are read through GitHub's API (no git needed); a private one, or one the API cannot list, uses git.
    let revision: string;
    try { revision = await apiRevision(s, signal); }
    catch (error) {
      if (error instanceof Stopped || !(error instanceof ApiUnavailable)) throw error;
      if (!await options.git.locate()) throw new Error(apiMessage(error.reason));
      const t = gitTransport(); if (error.reason === 'private') s.transport = 'git'; return t;
    }
    const api = {
      kind: 'api' as const,
      revision: async () => revision,
      list: async (): Promise<RepoListed[]> => {
        try { return await apiTree(s, revision); }
        catch (error) {
          if (!(error instanceof ApiUnavailable) || !await options.git.locate()) throw error instanceof ApiUnavailable ? new Error(apiMessage(error.reason)) : error;
          s.transport = 'git'; return gitTransport().list();
        }
      },
      read: (f: RepoListed) => s.transport === 'git' ? safeRead(join(sourceDir(s), 'repo'), f.path) : apiRead(s, revision, f.path),
    };
    s.transport = 'api';
    return api;
  }
  const problemText = (error: unknown) => error instanceof GitProblem ? error.message : error instanceof Error && error.message ? error.message.replace(/^Error: /, '') : '更新没成功，下次再试。';

  async function prepare(s: SourceRecord, signal: AbortSignal) {
    s.status = 'preparing'; s.detail = s.kind === 'github' ? '正在连接 GitHub，看看仓库里有什么…' : '正在看文件夹里有什么…'; await persist();
    try {
      const t = await transportFor(s, signal); checkStop();
      s.revision = undefined;
      await t.revision(); checkStop();
      const listing = await t.list(); checkStop();
      const readable = listing.filter(f => repoFileWanted(f.path, f.size, limits) === true).map(f => f.path);
      s.folders = summarizeFolders(readable); s.rules = defaultRules(s.folders); s.transport = t.kind;
      const picked = readable.filter(p => purposeFor(p, s.rules)).length;
      s.status = 'ready'; s.error = undefined; s.newFolders = undefined;
      s.progress = { done: 0, total: picked };
      s.detail = readable.length ? `找到 ${readable.length} 份能读的资料。下面按文件夹名字先选好了 ${picked} 份（看着像内部资料的没选），看一眼没问题就点「按这个选择开始导入」。` : '里面没有能读的资料（支持 Markdown、TXT、Word、PDF、Excel、CSV、网页）。';
    } catch (error) {
      s.status = 'error'; s.error = error instanceof Stopped ? undefined : problemText(error); s.detail = error instanceof Stopped ? '已停下。' : s.error!;
      if (error instanceof Stopped) s.status = s.folders.length ? 'ready' : 'error';
    }
    s.lastCheckAt = iso(); await persist();
  }

  /** One file: read → clean → parse → hide secrets → (organize) → tagged drafts. */
  async function readFileRows(s: SourceRecord, t: Awaited<ReturnType<typeof transportFor>>, item: RepoWork, organizeOn: boolean, budget: { calls: number }) {
    const bytes = await t.read({ path: item.path, size: item.size, hash: item.hash });
    const name = item.path.split('/').pop()!;
    const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
    let input: KnowledgeImportInput;
    if (['.md', '.markdown', '.txt'].includes(ext)) {
      const text = cleanRepoText(new TextDecoder('utf-8').decode(bytes));
      if (!text) return { rows: [] as KnowledgeDraft[], organized: false, redacted: 0, calls: 0, empty: true };
      const fileName = ext === '.markdown' ? name.slice(0, -'.markdown'.length) + '.md' : name;
      const buffer = Buffer.from(text, 'utf8');
      input = { files: [{ name: fileName.slice(-200), size: buffer.length, base64: buffer.toString('base64') }] };
    } else input = { files: [{ name: name.slice(-200), size: bytes.length, base64: bytes.toString('base64') }] };
    const parsed = await options.parse(input);
    if (parsed.rows.length > limits.rowsPerFile) throw new Error(`内容太长（拆出来超过 ${limits.rowsPerFile} 段），请拆成几个小文件`);
    let redacted = 0;
    const locator = (row: KnowledgeDraft) => `${item.path} · ${row.sourceLocator ?? ''}`.slice(0, 300);
    let rows = parsed.rows.map(raw => { const r = redactRow({ ...raw, source: s.name.slice(0, 200), sourceLocator: locator(raw) }); redacted += r.count; return r.row; });
    let organized = false, calls = 0;
    if (item.purpose === 'reply' && organizeOn && rows.length) {
      const room = Math.min(limits.modelCallsPerFile, budget.calls);
      // Batches of at most 20 rows and 28,000 characters (the organizer refuses more than 32,000).
      const batches: OrganizeSource[][] = [];
      for (const [i, r] of rows.entries()) {
        const source = { ...r, rowId: String(i + 1) }, size = JSON.stringify(source).length;
        const last = batches[batches.length - 1];
        if (last && last.length < limits.rowsPerModelCall && JSON.stringify(last).length + size <= 28000) last.push(source);
        else if (batches.length < room && size <= 28000) batches.push([source]);
        else if (batches.length >= room) break;
      }
      const better = new Map<string, OrganizeSource>();
      for (const batch of batches) {
        checkStop();
        let result: OrganizedKnowledge;
        try { result = await options.organize(batch); } catch (error) { throw new ModelUnavailable(error instanceof Error ? error.message : '整理模型没连上'); }
        calls++; budget.calls--;
        for (const r of result.rows) better.set(r.rowId, r);
      }
      // The model only adds titles, questions, phrasings and tags; the original text stays the fact.
      rows = rows.map((r, i) => { const b = better.get(String(i + 1)); return b ? redactRow({ ...r, title: b.title, question: b.question, aliases: b.aliases, tags: b.tags, scenario: b.scenario }).row : r; });
      organized = true;
    }
    const drafts: KnowledgeDraft[] = [];
    for (const r of rows) { try { drafts.push(readKnowledgeDraft({ ...r, tags: purposeTags(item.purpose, r) })); } catch { /* a row the store cannot hold is left out */ } }
    return { rows: drafts, organized, redacted, calls, empty: !drafts.length };
  }

  async function sync(s: SourceRecord, manual: boolean, signal: AbortSignal, idle?: () => { idle: boolean; reason?: string }) {
    if (!s.confirmed) return prepare(s, signal);
    s.status = 'syncing'; s.error = undefined; s.detail = '正在检查有没有更新…'; await persist();
    const index = await loadIndex(s);
    const importId = repoImportId(s.id);
    const change: RepoChange = { added: 0, updated: 0, disabled: 0, kept: 0, entries: 0, redacted: 0 };
    let modelCalls = 0, stoppedFor: string | undefined, modelNote: string | undefined, modelFailed = false;
    const notes: string[] = [];
    try {
      const mode = await options.modelMode();
      const organizeOn = mode === 'own';
      // Raw entries become organized ones only when the owner lets organized knowledge answer right away: otherwise an
      // upgrade would swap approved entries for ones waiting for review.
      const upgradeOn = organizeOn && options.getState().preferences.autoEnableKnowledge !== false;
      const t = await transportFor(s, signal); checkStop();
      const revision = await t.revision(); checkStop();
      const rulesHash = sha256(JSON.stringify(Object.entries(s.rules).sort()));
      const waiting = s.remaining > 0 || (upgradeOn && (s.readyToUpgrade ?? 0) > 0);
      if (revision === s.revision && rulesHash === s.rulesHash && !waiting) {
        s.status = 'ready'; s.detail = `没有变化（已整理 ${s.progress.done} / 共 ${s.progress.total} 份）。`; s.lastCheckAt = iso();
        s.nextCheckAt = iso(now() + limits.intervalHours * 3600_000); s.errorNotifiedAt = undefined; await persist(); return;
      }
      if (running) running.phase = '正在下载更新';
      const listing: RepoListed[] = await t.list(); checkStop();
      if (listing.length > limits.listedFiles) throw new Error(`仓库里的文件太多了（${listing.length} 个），咔哒最多看 ${limits.listedFiles} 个。`);
      // Folder files: a size or time change is only a hint; the content hash decides whether the file really changed.
      if (t.kind === 'folder') for (const f of listing) {
        const record = index[f.path];
        if (record && record.size === f.size && record.mtimeMs === f.mtimeMs) { f.hash = record.hash; continue; }
        if (repoFileWanted(f.path, f.size, limits) !== true || !purposeFor(f.path, s.rules)) continue;
        try { f.hash = sha256(await t.read(f)); } catch { f.hash = record?.hash ?? `unreadable:${f.size}:${f.mtimeMs}`; }
      }
      const readable = listing.filter(f => repoFileWanted(f.path, f.size, limits) === true).map(f => f.path);
      s.folders = summarizeFolders(readable);
      const newTop = s.folders.filter(f => s.rules[f.path] === undefined).map(f => f.name);
      s.newFolders = newTop.length ? newTop.slice(0, 10) : undefined;
      const plan = planRepoSync(listing, index, s.rules, { canOrganize: upgradeOn, limits });
      const total = plan.selected;
      let done = total - plan.work.length;
      const setProgress = () => { s.progress = { done, total }; if (running) { running.done = done; running.total = total; running.phase = `已整理 ${done} / 共 ${total} 份`; } };
      setProgress(); await persist();

      // Files gone upstream or no longer chosen: their entries stop answering.
      if (plan.removed.length) {
        await options.mutate('knowledge_repo_removed', undefined, `知识来源里有 ${plan.removed.length} 份文件删除或不再导入，相关知识已停用`, () => {
          const knowledge = options.getState().knowledge;
          for (const r of plan.removed) { const record = index[r.path]!; const out = disableRepoFile(knowledge, { importId, previous: record, now: iso() }); if (out.disabled) change.disabled++; change.kept += out.edited; record.status = 'removed'; }
        });
      }
      const budget = { calls: limits.modelCallsPerSync };
      let organizedFiles = 0, processed = 0;
      type Done = { item: RepoWork; rows: KnowledgeDraft[]; organized: boolean; size: number; mtimeMs?: number };
      let pending: Done[] = [];
      const created: string[] = [];
      const listingByPath = new Map(listing.map(f => [f.path, f]));
      const flush = async () => {
        if (!pending.length) return;
        const batch = pending; pending = [];
        await options.mutate('knowledge_repo_synced', undefined, `知识来源更新：整理 ${batch.length} 份文件，新内容按「整理完直接启用」的设置处理`, () => {
          const state = options.getState();
          let count = state.knowledge.filter(k => k.importId === importId).length;
          for (const d of batch) {
            const previous = index[d.item.path];
            const growth = d.rows.length - (previous?.ids.length ?? 0);
            if (count + growth > limits.entriesPerSource || state.knowledge.length + Math.max(0, growth) > 10000) {
              index[d.item.path] = { hash: d.item.hash, purpose: d.item.purpose, ids: previous?.ids ?? [], fps: previous?.fps ?? {}, organized: false, status: 'failed', reason: '知识太多了：这个来源最多 ' + limits.entriesPerSource + ' 条（整个知识库最多一万条），请少选几个文件夹', size: d.size, mtimeMs: d.mtimeMs };
              continue;
            }
            const out = applyRepoFile(state.knowledge, { importId, previous, rows: d.rows, now: iso() });
            if (out.removed.length) for (const task of state.tasks) task.knowledgeIds = task.knowledgeIds.filter(id => !out.removed.includes(id));
            count += out.created.length - out.removed.length;
            change.entries += out.created.length; change.kept += out.edited.length;
            if (d.item.why === 'new') change.added++; else change.updated++;
            if (d.item.purpose !== 'internal') created.push(...out.created.filter(k => !k.heldForReview).map(k => k.id));
            index[d.item.path] = { hash: d.item.hash, purpose: d.item.purpose, ids: out.record.ids, fps: out.record.fps, organized: d.organized, status: 'done', size: d.size, mtimeMs: d.mtimeMs };
          }
        });
        await saveIndex(s, index);
      };
      const fail = (item: RepoWork, reason: string) => {
        const previous = index[item.path], f = listingByPath.get(item.path);
        index[item.path] = { hash: item.hash, purpose: item.purpose, ids: previous?.ids ?? [], fps: previous?.fps ?? {}, organized: false, status: 'failed', reason: reason.slice(0, 200), size: f?.size, mtimeMs: f?.mtimeMs };
      };
      for (const item of plan.work) {
        if (stopRequested || signal.aborted) { stoppedFor = 'stop'; break; }
        if (!manual && idle) { const check = idle(); if (!check.idle) { stoppedFor = check.reason ?? '咔哒忙起来了'; break; } }
        if (processed >= limits.filesPerSync) break;
        // 「回复客户用」 with the owner's model: organized, within this sync's budget; otherwise it waits for the next round.
        const wantsModel = item.purpose === 'reply' && organizeOn;
        if (wantsModel && (modelFailed || organizedFiles >= limits.organizeFilesPerSync || budget.calls <= 0)) continue;
        if (item.why === 'upgrade' && !wantsModel) continue;
        const f = listingByPath.get(item.path);
        try {
          const result = await readFileRows(s, t, item, wantsModel, budget);
          modelCalls += result.calls; change.redacted += result.redacted;
          if (result.organized) organizedFiles++;
          if (result.empty) fail(item, '没有读到能用的文字');
          else pending.push({ item, rows: result.rows, organized: result.organized || item.purpose !== 'reply', size: item.size, mtimeMs: f?.mtimeMs });
        } catch (error) {
          if (error instanceof Stopped) { stoppedFor = 'stop'; break; }
          if (error instanceof ModelUnavailable) {
            // The owner's model did not answer: the 「回复客户用」 files wait for the next round instead of going in unorganized.
            modelFailed = true; modelNote = `整理模型这次没连上（${error.message.slice(0, 80)}），要整理的文件下次再整理。`; continue;
          }
          fail(item, problemText(error).slice(0, 120));
        }
        processed++; done++; setProgress();
        if (pending.length >= 25) await flush();
      }
      await flush();
      const enabled = created.length ? await options.autoEnable(created).catch(() => undefined) : undefined;

      // What is still waiting: unprocessed work (cap, stop, busy) and unorganized 回复客户用 files once a model is there.
      const left = planRepoSync(listing, index, s.rules, { canOrganize: upgradeOn, limits });
      s.remaining = left.work.filter(w => w.why !== 'upgrade').length;
      s.readyToUpgrade = Object.values(index).filter(r => r.status === 'done' && r.purpose === 'reply' && !r.organized).length;
      s.progress = { done: total - left.work.length, total };
      const complete = !stoppedFor && !s.remaining;
      s.revision = revision; s.rulesHash = rulesHash;
      s.status = 'ready'; s.lastCheckAt = iso(); s.lastSyncAt = iso(); s.errorNotifiedAt = undefined;
      s.lastChange = change;
      const changed = change.added + change.updated + change.disabled > 0;
      if (changed) notes.push(`这次${plural(change)}（${change.entries} 条新知识）。`);
      else notes.push('这次没有新的变化。');
      if (enabled?.approved.length) notes.push(`已直接启用 ${enabled.approved.length} 条${enabled.conflicts.length ? `，${enabled.conflicts.length} 条等你在「管理资料」里处理` : ''}。`);
      else if (change.entries && !enabled) notes.push('新知识等你在「管理资料」里确认后才会用。');
      if (change.kept) notes.push(`有 ${change.kept} 条你改过的知识没有覆盖；原文件更新出的新版本等你在「管理资料」里决定用哪个。`);
      if (change.redacted) notes.push(`资料里有 ${change.redacted} 处像密钥、密码的内容，已隐藏。`);
      if (modelCalls) notes.push(`本次调用整理模型 ${modelCalls} 次。`);
      if (mode === 'trial' && plan.work.some(w => w.purpose === 'reply')) notes.push('免费试用的模型不用来整理大批资料：「回复客户用」的文件先按原文导入，接上自己的模型后会自动整理成问答。');
      if (mode === 'none' && plan.work.some(w => w.purpose === 'reply')) notes.push('还没接好回复模型：资料按原文导入，没有改写成客户问答。');
      if (modelNote) notes.push(modelNote);
      if (stoppedFor === 'stop') notes.push(`已停下：剩下的 ${s.remaining} 份下次继续。`);
      else if (stoppedFor) notes.push(`${stoppedFor}，先停下：剩下的 ${s.remaining} 份等咔哒不忙时继续。`);
      else if (s.remaining) notes.push(`每次最多整理 ${limits.organizeFilesPerSync} 份要整理的文件（${limits.filesPerSync} 份文件），剩下的 ${s.remaining} 份下次继续。`);
      if (plan.skipped.length) notes.push(`跳过 ${plan.skipped.length} 份（${plan.skipped[0]!.reason}）。`);
      const failed = Object.values(index).filter(r => r.status === 'failed').length;
      if (failed) notes.push(`${failed} 份没读成（比如扫描件、加密文件），文件改了会再试。`);
      if (s.newFolders?.length) notes.push(`仓库里多了文件夹「${s.newFolders.slice(0, 3).join('」「')}」，还没导入；要用的话在「选文件夹」里勾上。`);
      s.detail = notes.join(' ');
      s.nextCheckAt = iso(now() + (complete ? limits.intervalHours * 3600_000 : stoppedFor && stoppedFor !== 'stop' ? 10 * 60_000 : limits.catchUpMinutes * 60_000));
      await persist();
      if (changed && !manual) options.notify?.({ kind: 'changed', title: '知识库更新了', body: `${s.name}：${plural(change)}${change.entries && !enabled ? '，新知识等你确认' : ''}`, counts: change });
    } catch (error) {
      const stopped = error instanceof Stopped || signal.aborted;
      s.status = stopped ? 'ready' : 'error';
      s.error = stopped ? undefined : problemText(error);
      s.detail = stopped ? '已停下，下次继续。' : s.error!;
      s.lastCheckAt = iso();
      const network = /网络|连不上|暂时不让/.test(s.error ?? '');
      s.nextCheckAt = iso(now() + (stopped ? limits.catchUpMinutes * 60_000 : network ? 3600_000 : limits.intervalHours * 3600_000));
      if (!stopped && !manual && (!s.errorNotifiedAt || now() - Date.parse(s.errorNotifiedAt) >= 24 * 3600_000)) {
        s.errorNotifiedAt = iso();
        options.notify?.({ kind: 'error', title: '知识来源没更新成功', body: `${s.name}：${s.error!.slice(0, 120)}` });
      }
      await persist();
    }
  }

  function addSource(record: Omit<SourceRecord, 'id' | 'confirmed' | 'autoSync' | 'folders' | 'rules' | 'status' | 'detail' | 'progress' | 'remaining'>) {
    if (sources.length >= limits.sources) throw new Error(`最多添加 ${limits.sources} 个知识来源。`);
    const s: SourceRecord = { id: randomUUID(), confirmed: false, autoSync: true, folders: [], rules: {}, status: 'preparing', detail: '正在准备…', progress: { done: 0, total: 0 }, remaining: 0, ...record };
    sources.push(s);
    start(s, true, '正在看里面有什么', signal => prepare(s, signal));
    return s;
  }

  return {
    view,
    /** Main-process only (the folder comes from the system's folder dialog, never from the page). */
    async addFolder(path: string): Promise<RepoView> {
      const actual = await realpath(path);
      if (actual === parsePath(actual).root) throw new Error('请选择具体的资料文件夹，不要选整个磁盘。');
      if (actual.startsWith(root + sep) || actual === root) throw new Error('这是咔哒自己的数据文件夹，请选你的资料文件夹。');
      const existing = sources.find(s => s.kind === 'folder' && s.location === actual);
      if (existing) return view();
      addSource({ kind: 'folder', name: basename(actual).slice(0, 120) || '文件夹', location: actual, transport: 'folder' });
      await persist(); return view();
    },
    /** Runs a due automatic update when kadadesk is idle; never more than one at a time. */
    async autoTick(idle: () => { idle: boolean; reason?: string }): Promise<boolean> {
      if (job) return false;
      const due = sources.find(s => s.confirmed && s.autoSync && (!s.nextCheckAt || Date.parse(s.nextCheckAt) <= now()));
      if (!due || !idle().idle) return false;
      start(due, false, '正在检查有没有更新', signal => sync(due, false, signal, idle));
      return true;
    },
    /** Tests and shutdown: resolves when the current background job is over. */
    whenIdle: () => job ?? Promise.resolve(),
    async close() { stopRequested = true; aborter?.abort(); await job; await writeTail; },
    async handle(method: string, path: string, body: Record<string, unknown>): Promise<RepoView> {
      if (path === '/knowledge/repos' && method === 'GET') return view();
      if (path === '/knowledge/repos' && method === 'POST') {
        const { owner, repo, url } = parseRepoUrl(body.url);
        if (sources.some(s => s.kind === 'github' && s.location.toLowerCase() === url.toLowerCase())) throw new Error('这个仓库已经在列表里了。');
        addSource({ kind: 'github', name: `GitHub · ${owner}/${repo}`.slice(0, 120), location: url, owner, repo });
        await persist(); return view();
      }
      if (path === '/knowledge/repos' && method === 'DELETE') {
        const s = find(body.id);
        if (running?.id === s.id) throw new Error('这个来源正在更新，先点「停下」再移除。');
        sources = sources.filter(x => x !== s); await persist();
        await rm(sourceDir(s), { recursive: true, force: true }).catch(() => undefined);
        return view();
      }
      if (path === '/knowledge/repos/folders' && method === 'POST') {
        const s = find(body.id);
        if (running?.id === s.id) throw new Error('这个来源正在更新，请等它完成或先点「停下」。');
        s.rules = readRules(body.rules, s.folders);
        if (!Object.values(s.rules).some(r => r !== 'skip')) throw new Error('至少选一个文件夹。');
        s.confirmed = true; s.nextCheckAt = undefined; await persist();
        start(s, true, '正在整理', signal => sync(s, true, signal));
        return view();
      }
      if (path === '/knowledge/repos/sync' && method === 'POST') {
        const s = find(body.id);
        start(s, true, s.confirmed ? '正在检查有没有更新' : '正在看里面有什么', signal => sync(s, true, signal));
        return view();
      }
      if (path === '/knowledge/repos/auto' && method === 'POST') {
        const s = find(body.id); if (typeof body.on !== 'boolean') throw new Error('设置无效。');
        s.autoSync = body.on; await persist(); return view();
      }
      if (path === '/knowledge/repos/stop' && method === 'POST') { if (job) { stopRequested = true; aborter?.abort(); } return view(); }
      throw new Error('接口不存在');
    },
  };
}
export type KnowledgeRepos = Awaited<ReturnType<typeof createKnowledgeRepos>>;
export type { RepoFolder };
