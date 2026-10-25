/**
 * 自动更新的知识来源: a GitHub repository (public or private) or a folder on this computer that kadadesk checks for
 * changes when it is not busy, and whose new or changed files it organizes into the knowledge base. Shared by the
 * engine (server/knowledge-repos.ts), the desktop scheduler (desktop/main.ts) and the page (src/KnowledgeRepos.tsx).
 */
import { STYLE_REFERENCE_TAG } from './knowledge-categories';
import { ignoredDocumentPath } from './knowledge-files';

export { STYLE_REFERENCE_TAG };

/** What a selected folder is for. Folders that are not selected are not imported at all. */
export type RepoPurpose = 'reply' | 'style' | 'internal';
export const REPO_PURPOSES: Record<RepoPurpose, { label: string; hint: string }> = {
  reply: { label: '回复客户用', hint: '整理成客户问答，用来回答客户' },
  style: { label: '写法参考', hint: '只学写法和语气，不当成事实告诉客户' },
  internal: { label: '内部参考', hint: '存成内部资料，不用来回复客户' },
};
export const isRepoPurpose = (value: unknown): value is RepoPurpose => value === 'reply' || value === 'style' || value === 'internal';
/** Folder path → purpose, or 'skip' (not imported). '.' holds the files at the top of the repository. */
export type RepoRules = Record<string, RepoPurpose | 'skip'>;

export const REPO_SYNC_LIMITS = {
  /** Files organized by the reply model in one sync; the rest continue next time. */
  organizeFilesPerSync: 100,
  /** Model calls in one sync (each call organizes at most 20 rows of one file). */
  modelCallsPerSync: 100,
  rowsPerModelCall: 20,
  /** A long file gets at most this many calls; rows beyond them keep their original text. */
  modelCallsPerFile: 2,
  /** Files read in one sync, whatever their purpose. */
  filesPerSync: 300,
  fileBytes: 2 * 1024 * 1024,
  rowsPerFile: 200,
  entriesPerSource: 4000,
  listedFiles: 20000,
  intervalHours: 6,
  /** After a sync that stopped at a cap, the next automatic round comes this soon (still only when idle). */
  catchUpMinutes: 30,
  sources: 20,
};
export type RepoLimits = typeof REPO_SYNC_LIMITS;

export type RepoKind = 'github' | 'folder';
export interface RepoFolder { path: string; name: string; files: number; suggested?: RepoPurpose; children?: RepoFolder[] }
export interface RepoChange { added: number; updated: number; disabled: number; kept: number; entries: number; redacted: number }
export interface RepoSourceView {
  id: string; kind: RepoKind; name: string;
  /** https://github.com/owner/repo, or the folder's real path. */
  location: string;
  transport?: 'api' | 'git' | 'folder';
  /** The owner looked at the folder choice and started the import; automatic updates wait for this. */
  confirmed: boolean;
  autoSync: boolean;
  folders: RepoFolder[];
  rules: RepoRules;
  status: 'preparing' | 'ready' | 'syncing' | 'error';
  detail: string;
  /** Selected files already organized (N) out of all selected files (M): 已整理 N / 共 M. */
  progress: { done: number; total: number };
  /** Selected files still waiting (budget, stop or busy). */
  remaining: number;
  lastCheckAt?: string; lastSyncAt?: string; nextCheckAt?: string;
  lastChange?: RepoChange;
  error?: string;
  /** Top-level folders that appeared upstream after the owner chose; they are not imported until chosen. */
  newFolders?: string[];
}
export interface RepoView {
  sources: RepoSourceView[];
  running?: { id: string; phase: string; done: number; total: number; manual: boolean };
  stopRequested: boolean;
  intervalHours: number;
}

/** github.com/{owner}/{repo} only (with or without .git, a trailing /tree/... part is ignored). Never credentials. */
export function parseRepoUrl(raw: unknown): { owner: string; repo: string; url: string } {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 500) throw new Error('请粘贴 GitHub 仓库地址，例如 https://github.com/用户名/仓库名');
  let text = raw.trim();
  const ssh = /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(text);
  if (ssh) text = `https://github.com/${ssh[1]}/${ssh[2]}`;
  if (!/^[a-z]+:\/\//i.test(text) && /^(www\.)?github\.com\//i.test(text)) text = 'https://' + text;
  let url: URL;
  try { url = new URL(text); } catch { throw new Error('链接格式不对：请粘贴 GitHub 仓库地址，例如 https://github.com/用户名/仓库名'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('只支持 https://github.com/ 开头的仓库地址。');
  if (url.username || url.password) throw new Error('链接里不要带账号、密码或令牌：直接粘贴仓库地址就行，咔哒会用这台电脑已经登录的 GitHub 账号读取。');
  if (!['github.com', 'www.github.com'].includes(url.hostname.toLowerCase()) || url.port) throw new Error('目前只支持 GitHub 仓库（github.com）。其他网站的资料可以下载后拖进来，或用「添加本地文件夹」。');
  const parts = url.pathname.split('/').filter(Boolean);
  const owner = parts[0] ?? '', repo = (parts[1] ?? '').replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(repo) || repo === '.' || repo === '..') throw new Error('请粘贴仓库首页地址，例如 https://github.com/用户名/仓库名');
  if (parts.length > 2 && !['tree', 'blob'].includes(parts[2])) throw new Error('这个地址不是仓库首页：请粘贴 https://github.com/用户名/仓库名');
  return { owner, repo, url: `https://github.com/${owner}/${repo}` };
}

const norm = (s: string) => s.normalize('NFKC').toLowerCase();
// Internal material wins over everything: architecture, decisions, reviews, indexes, specs, accounts.
const INTERNAL = /架构|技术|复盘|决策|索引|规范|内部|战略|方法论|交付|工作流|工具|开发|代码|源码|配置|部署|运维|财务|合同|人事|招聘|会议|周报|日报|月报|草稿|归档|待办|名单|通讯录|账号|密码|密钥|备份|日志|测试|实验|\b(?:archive|drafts?|internal|private|secrets?|scripts?|src|code|config|dev|tests?|tmp|logs?|backups?|vendor|dist|build|node_modules)\b/;
// Posts and copy written for an audience: good to learn the voice from, never facts for a customer.
const STYLE = /文案|爆款|自媒体|口播|朋友圈|小红书|抖音|视频号|公众号|推文|内容|选题|金句|标题|素材|\b(?:copywriting|content|posts?|social)\b/;
// What a customer may be told: sales, scripts, brand, cases, FAQ, product introductions, prices.
const REPLY = /销售|获客|话术|品牌|案例|常见问题|问答|答疑|产品介绍|产品|价格|价目|报价|收费|套餐|售后|服务|介绍|客户|帮助|教程|使用|手册|指南|说明|\b(?:help|guides?|manuals?|pricing|prices?|sales|products?|services?|support|brand|cases?|faqs?)\b/;

/** The default for a folder found in a source, from its name only: undefined means not imported. */
export function suggestPurpose(folderName: string): RepoPurpose | undefined {
  const name = norm(folderName).replace(/^[\d\s._-]+/, '');
  if (!name || INTERNAL.test(name)) return undefined;
  if (STYLE.test(name)) return 'style';
  if (REPLY.test(name)) return 'reply';
  return undefined;
}

/** Extensions a source reads. JSON in a repository is configuration or data, so it is left out. */
export const REPO_FILE_EXTENSIONS = ['.md', '.markdown', '.txt', '.docx', '.pdf', '.xlsx', '.csv', '.html', '.htm'] as const;
const REPO_EXTENSIONS = new Set<string>(REPO_FILE_EXTENSIONS);
/** Build output, dependencies and tooling folders: never business documents. */
const BUILD_FOLDERS = new Set(['dist', 'build', 'out', 'target', 'vendor', 'coverage', '__pycache__', 'venv', '.venv', 'bower_components', '.next', '.nuxt', 'site-packages']);
const SECRET_NAME = /(secret|credential|password|passwd|token|apikey|api[_-]key|private[_-]?key|密码|密钥|秘钥|令牌|账号)/i;
const extensionOf = (path: string) => { const name = path.split('/').pop() ?? ''; const dot = name.lastIndexOf('.'); return dot <= 0 ? '' : name.slice(dot).toLowerCase(); };

/** Whether a file of a source is read: true, a reason to show it as skipped, or false to ignore it quietly. */
export function repoFileWanted(path: string, size: number | undefined, limits: Pick<RepoLimits, 'fileBytes'> = REPO_SYNC_LIMITS): true | string | false {
  const parts = path.split('/');
  if (!path || path.length > 600 || parts.some(p => !p || p === '.' || p === '..')) return false;
  if (ignoredDocumentPath(path) || parts.slice(0, -1).some(p => BUILD_FOLDERS.has(p.toLowerCase()))) return false;
  if (!REPO_EXTENSIONS.has(extensionOf(path))) return false;
  if (SECRET_NAME.test(parts[parts.length - 1]!)) return '文件名像是保存密码或密钥的文件，没有读取';
  if (size !== undefined && size > limits.fileBytes) return `超过 ${Math.round(limits.fileBytes / 1024 / 1024)}MB，没有读取`;
  if (size === 0) return false;
  return true;
}

/** The purpose a file gets from the folder rules: the deepest chosen folder wins; root files use '.'. */
export function purposeFor(path: string, rules: RepoRules): RepoPurpose | undefined {
  const parts = path.split('/');
  if (parts.length === 1) { const r = rules['.']; return r && r !== 'skip' ? r : undefined; }
  for (let depth = parts.length - 1; depth >= 1; depth--) {
    const rule = rules[parts.slice(0, depth).join('/')];
    if (rule !== undefined) return rule === 'skip' ? undefined : rule;
  }
  return undefined;
}

/** Top-level folders (and one level down) with how many readable files each holds, plus root files as '.'. */
export function summarizeFolders(paths: string[]): RepoFolder[] {
  const top = new Map<string, { files: number; children: Map<string, number> }>(); let root = 0;
  for (const path of paths) {
    const parts = path.split('/');
    if (parts.length === 1) { root++; continue; }
    const entry = top.get(parts[0]!) ?? { files: 0, children: new Map() }; entry.files++;
    if (parts.length > 2) entry.children.set(parts[1]!, (entry.children.get(parts[1]!) ?? 0) + 1);
    top.set(parts[0]!, entry);
  }
  const folders: RepoFolder[] = [...top.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh-Hans-CN')).map(([name, e]) => {
    const suggested = suggestPurpose(name);
    const children = [...e.children.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh-Hans-CN')).slice(0, 60)
      .map(([child, files]) => ({ path: `${name}/${child}`, name: child, files, ...(suggestPurpose(child) ? { suggested: suggestPurpose(child) } : {}) }));
    return { path: name, name, files: e.files, ...(suggested ? { suggested } : {}), ...(children.length ? { children } : {}) };
  });
  if (root) folders.unshift({ path: '.', name: '（最外层的文件）', files: root });
  return folders.slice(0, 200);
}

/** Defaults: customer-facing and style folders are selected with their purpose; everything else is left out. */
export function defaultRules(folders: RepoFolder[]): RepoRules {
  const rules: RepoRules = {};
  for (const f of folders) rules[f.path] = f.suggested ?? 'skip';
  return rules;
}

/** Owner-chosen rules, checked: only known folder paths (or their direct children), known purposes, bounded size. */
export function readRules(raw: unknown, folders: RepoFolder[]): RepoRules {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('文件夹选择无效，请刷新后重选。');
  const known = new Set(folders.flatMap(f => [f.path, ...(f.children ?? []).map(c => c.path)]));
  const rules: RepoRules = {};
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > 2000) throw new Error('文件夹太多了，请少选几个。');
  for (const [path, value] of entries) {
    if (!known.has(path)) continue;
    if (value !== 'skip' && !isRepoPurpose(value)) throw new Error('文件夹用途无效，请刷新后重选。');
    rules[path] = value;
  }
  return rules;
}

/**
 * Text a source file contributes, cleaned: front matter, HTML comments, Obsidian comments, image-only and badge lines
 * removed, wiki links reduced to their label, runs of blank lines collapsed. Facts are never rewritten.
 */
export function cleanRepoText(text: string): string {
  let t = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  t = t.replace(/^---\n[\s\S]*?\n---[ \t]*(?:\n|$)/, '').replace(/^\+\+\+\n[\s\S]*?\n\+\+\+[ \t]*(?:\n|$)/, '');
  t = t.replace(/<!--[\s\S]*?-->/g, '').replace(/%%[\s\S]*?%%/g, '');
  t = t.replace(/^[ \t]*(?:\[?!\[[^\]]*\]\([^)]*\)\]?(?:\([^)]*\))?[ \t]*)+$/gm, '');
  t = t.replace(/<img\b[^>]*>/gi, '');
  t = t.replace(/!\[\[[^\]]*\]\]/g, '').replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1');
  t = t.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

/**
 * Whether an automatic update may run now. kadadesk is idle only when no customer is waiting, no reply is being
 * written or sent, no other desktop work runs, the computer is not under pressure and the owner did not press 急停.
 */
export function repoSyncIdle(input: { emergency: boolean; resource: 'normal' | 'tight'; desktopBusy: boolean; reception?: { busy: boolean; awaiting: number; inFlight: number } }): { idle: boolean; reason?: string } {
  if (input.emergency) return { idle: false, reason: '按过急停' };
  if (input.resource !== 'normal') return { idle: false, reason: '电脑有点吃紧' };
  if (input.desktopBusy) return { idle: false, reason: '正在操作电脑' };
  const r = input.reception;
  if (r && r.awaiting > 0) return { idle: false, reason: '有客户在等回复' };
  if (r && r.inFlight > 0) return { idle: false, reason: '正在写或发回复' };
  if (r && r.busy) return { idle: false, reason: '正在看聊天' };
  return { idle: true };
}
