import type { KnowledgeImportFile } from '../shared/knowledge';
import { ONE_STEP_IMPORT_LIMITS, ignoredDocumentPath, importNameFromPath, supportedDocumentName, zipFileName } from '../shared/knowledge-files';
import { ApiError } from './api-error';
import { readZip, ZipError } from './zip-reader';
import { downloadPublicKnowledge } from './knowledge-web';

/**
 * 「一股脑丢进来」: turns a ZIP, a GitHub repository or a web page into ordinary import files, which the renderer then
 * previews like any dropped file. Nothing here is stored; file contents are never logged.
 */
export interface ExpandSkip { name: string; reason: string }
export interface ExpandResult { files: KnowledgeImportFile[]; skipped: ExpandSkip[]; ignored: number; source: string }
export interface ExpandOptions {
  fetchImpl?: typeof fetch;
  /** Generic public pages; defaults to the DNS-pinned reader in knowledge-web.ts. */
  downloadPage?: (url: string) => Promise<{ file: KnowledgeImportFile; url: string }>;
  timeoutMs?: number;
}

const FILE_BYTES = 8 * 1024 * 1024;
export const GITHUB_PRIVATE = '这个 GitHub 仓库打不开（可能是私有仓库）。私有仓库请用「自动更新的知识来源」→「添加 GitHub 仓库」，咔哒会用这台电脑已经登录的 GitHub 账号读取；或者在 GitHub 页面点绿色的「Code」→「Download ZIP」，把下载好的 ZIP 拖进来。';
export const GITHUB_RATE_LIMIT = 'GitHub 暂时不让读了（短时间读得太多）。过一小时再试，或者在 GitHub 页面点绿色的「Code」→「Download ZIP」，把下载好的 ZIP 拖进来。';
export const GITHUB_OFFLINE = '连不上 GitHub（可能是网络问题）。可以在 GitHub 页面点绿色的「Code」→「Download ZIP」，把下载好的 ZIP 拖进来。';
const GITHUB_HOSTS = new Set(['api.github.com', 'raw.githubusercontent.com', 'github.com', 'codeload.github.com', 'objects.githubusercontent.com']);

function budget(body: Record<string, unknown>) {
  const n = (v: unknown, max: number) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? Math.min(v, max) : max;
  return { files: n(body.maxFiles, ONE_STEP_IMPORT_LIMITS.files), bytes: n(body.maxBytes, ONE_STEP_IMPORT_LIMITS.totalBytes) };
}
const encode = (bytes: Uint8Array, name: string): KnowledgeImportFile => ({ name, size: bytes.byteLength, base64: Buffer.from(bytes).toString('base64') });
const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)}MB`;

/** Which entry of a folder, ZIP or repository is read: true, a reason to list it as skipped, or false to ignore it. */
export function wantedDocument(path: string, size?: number): string | boolean {
  if (ignoredDocumentPath(path)) return false;
  if (zipFileName(path)) return '压缩包里的压缩包，请先解压';
  if (!supportedDocumentName(path)) return false;
  if (size !== undefined && size > FILE_BYTES) return `超过 ${mb(FILE_BYTES)}`;
  return true;
}

export function expandZip(raw: unknown, limit = budget({})): ExpandResult {
  const zip = raw as Partial<KnowledgeImportFile> | undefined;
  if (!zip || typeof zip.name !== 'string' || !zip.name.trim() || zip.name.length > 300 || typeof zip.base64 !== 'string' || !Number.isSafeInteger(zip.size)
    || zip.base64.length > Math.ceil(ONE_STEP_IMPORT_LIMITS.zipBytes / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(zip.base64)) throw new ApiError(400, `压缩包无效或超过 ${mb(ONE_STEP_IMPORT_LIMITS.zipBytes)}，请解压后把文件夹直接拖进来。`);
  const data = Buffer.from(zip.base64, 'base64');
  if (data.length !== zip.size) throw new ApiError(400, '压缩包读取不完整，请重新拖一次。');
  const base = zip.name.replaceAll('\\', '/').split('/').pop()!.replace(/\.zip$/i, '').trim() || '压缩包';
  try {
    const { files, skipped, ignored } = readZip(data, path => wantedDocument(path), { entries: 5000, entryBytes: FILE_BYTES, totalBytes: limit.bytes, ratio: 200 }, limit.files);
    const label = (path: string) => importNameFromPath(path.includes('/') ? path : `${base}/${path}`);
    return { files: files.map(f => encode(f.bytes, label(f.path))), skipped: skipped.map(s => ({ name: label(s.path), reason: s.reason })), ignored, source: zip.name };
  } catch (error) {
    if (error instanceof ZipError) throw new ApiError(400, `「${zip.name}」：${error.message}`);
    throw error;
  }
}

export interface GitHubTarget { owner: string; repo: string; /** Segments after /tree/ or /blob/: branch (maybe with slashes) and path. */ rest: string[]; blob: boolean }
/** github.com/{owner}/{repo}[/tree|blob/{branch}/{path}]; undefined for any other host. */
export function parseGitHubUrl(raw: string): GitHubTarget | undefined {
  let url: URL; try { url = new URL(raw.trim()); } catch { return undefined; }
  if (!['github.com', 'www.github.com'].includes(url.hostname.toLowerCase())) return undefined;
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  const parts = url.pathname.split('/').filter(Boolean).map(p => { try { return decodeURIComponent(p); } catch { return p; } });
  const name = /^[A-Za-z0-9_.-]{1,100}$/;
  if (parts.length < 2 || !name.test(parts[0]) || !name.test(parts[1].replace(/\.git$/, ''))) throw new ApiError(400, '请粘贴 GitHub 仓库地址，例如 https://github.com/用户名/仓库名');
  const owner = parts[0], repo = parts[1].replace(/\.git$/, '');
  if (parts.length === 2) return { owner, repo, rest: [], blob: false };
  if ((parts[2] === 'tree' || parts[2] === 'blob') && parts.length > 3 && parts.slice(3).every(p => p !== '..' && p !== '.')) return { owner, repo, rest: parts.slice(3), blob: parts[2] === 'blob' };
  throw new ApiError(400, '这个 GitHub 地址读不了：请粘贴仓库首页地址，或某个文件夹的地址。');
}

/** fetch that follows at most 3 redirects, only to GitHub's own HTTPS hosts, and reads at most `max` bytes. */
export async function githubFetch(fetchImpl: typeof fetch, raw: string, max: number, timeoutMs: number, accept = 'application/vnd.github+json') {
  let url = new URL(raw);
  for (let hop = 0; hop <= 3; hop++) {
    if (url.protocol !== 'https:' || !GITHUB_HOSTS.has(url.hostname) || url.username || url.password) throw new ApiError(502, GITHUB_OFFLINE);
    let response: Response;
    try { response = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { Accept: accept, 'User-Agent': 'kadadesk/knowledge-import' } }); }
    catch { throw new ApiError(502, GITHUB_OFFLINE); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location'); await response.body?.cancel().catch(() => {});
      if (!location || hop === 3) throw new ApiError(502, GITHUB_OFFLINE);
      url = new URL(location, url); continue;
    }
    return { response, read: () => readCapped(response, max) };
  }
  throw new ApiError(502, GITHUB_OFFLINE);
}
async function readCapped(response: Response, max: number): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) { await response.body?.cancel().catch(() => {}); throw new ApiError(413, `超过 ${mb(max)}`); }
  if (!response.body) return Buffer.from(await response.arrayBuffer());
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength; if (size > max) { await reader.cancel().catch(() => {}); throw new ApiError(413, `超过 ${mb(max)}`); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
function githubStatus(status: number): never {
  if (status === 403 || status === 429) throw new ApiError(429, GITHUB_RATE_LIMIT);
  if (status === 404 || status === 401 || status === 451) throw new ApiError(404, GITHUB_PRIVATE);
  throw new ApiError(502, GITHUB_OFFLINE);
}
const rawPath = (parts: string[]) => parts.map(encodeURIComponent).join('/');

export async function expandGitHub(link: GitHubTarget, fetchImpl: typeof fetch, limit = budget({}), timeoutMs = 20000): Promise<ExpandResult> {
  const repoResponse = await githubFetch(fetchImpl, `https://api.github.com/repos/${encodeURIComponent(link.owner)}/${encodeURIComponent(link.repo)}`, 256 * 1024, timeoutMs);
  if (!repoResponse.response.ok) githubStatus(repoResponse.response.status);
  let info: { default_branch?: unknown; private?: unknown; full_name?: unknown };
  try { info = JSON.parse((await repoResponse.read()).toString('utf8')); } catch { throw new ApiError(502, GITHUB_OFFLINE); }
  if (info.private === true) throw new ApiError(404, GITHUB_PRIVATE);
  // A renamed or transferred repository answers under its new name; later requests use that name directly.
  const canonical = typeof info.full_name === 'string' && /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(info.full_name) ? info.full_name.split('/') : [link.owner, link.repo];
  const target = { ...link, owner: canonical[0], repo: canonical[1] };
  const api = `https://api.github.com/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`;
  // /tree/feature/x/docs: the branch may itself contain slashes, so the shortest branch that exists wins.
  const candidates: Array<{ ref: string[]; path: string[] }> = target.rest.length
    ? Array.from({ length: Math.min(target.rest.length, 4) }, (_, i) => ({ ref: target.rest.slice(0, i + 1), path: target.rest.slice(i + 1) }))
    : [{ ref: [typeof info.default_branch === 'string' && info.default_branch ? info.default_branch : 'main'], path: [] }];
  let tree: { tree?: Array<{ path?: unknown; type?: unknown; size?: unknown }>; truncated?: unknown } | undefined, chosen = candidates[0];
  for (const candidate of candidates) {
    const result = await githubFetch(fetchImpl, `${api}/git/trees/${rawPath(candidate.ref)}?recursive=1`, 24 * 1024 * 1024, timeoutMs);
    if (result.response.status === 404 || result.response.status === 422) { await result.response.body?.cancel().catch(() => {}); continue; }
    if (!result.response.ok) githubStatus(result.response.status);
    try { tree = JSON.parse((await result.read()).toString('utf8')); } catch { throw new ApiError(502, GITHUB_OFFLINE); }
    chosen = candidate; break;
  }
  if (!tree || !Array.isArray(tree.tree)) throw new ApiError(404, '这个 GitHub 地址里的分支或文件夹找不到了，请粘贴仓库首页地址再试。');
  const prefix = chosen.path.join('/');
  const inside = (path: string) => !prefix || (target.blob ? path === prefix : path === prefix || path.startsWith(prefix + '/'));
  const files: KnowledgeImportFile[] = [], skipped: ExpandSkip[] = []; let ignored = 0, total = 0;
  const label = (path: string) => importNameFromPath(`${target.repo}/${path}`);
  const queue: Array<{ path: string; size: number }> = [];
  for (const item of tree.tree) {
    if (item.type !== 'blob' || typeof item.path !== 'string' || !inside(item.path)) continue;
    const size = typeof item.size === 'number' ? item.size : 0;
    const verdict = wantedDocument(item.path, size);
    if (verdict !== true) { if (verdict) skipped.push({ name: label(item.path), reason: verdict }); else ignored++; continue; }
    if (queue.length >= limit.files) { skipped.push({ name: label(item.path), reason: `一次最多读 ${limit.files} 份` }); continue; }
    if (total + size > limit.bytes) { skipped.push({ name: label(item.path), reason: `合计超过 ${mb(limit.bytes)}` }); continue; }
    total += size; queue.push({ path: item.path, size });
  }
  if (tree.truncated === true) skipped.push({ name: target.repo, reason: '仓库太大，GitHub 只给了一部分文件列表；可以下载 ZIP 拖进来' });
  // Four downloads at a time; a file that fails is listed and the rest continue.
  const results: Array<KnowledgeImportFile | undefined> = new Array(queue.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < queue.length; i = next++) {
      const { path } = queue[i];
      try {
        const result = await githubFetch(fetchImpl, `https://raw.githubusercontent.com/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/${rawPath(chosen.ref)}/${rawPath(path.split('/'))}`, FILE_BYTES, timeoutMs, '*/*');
        if (!result.response.ok) { await result.response.body?.cancel().catch(() => {}); skipped.push({ name: label(path), reason: result.response.status === 404 ? '文件找不到了' : '下载失败' }); continue; }
        results[i] = encode(await result.read(), label(path));
      } catch (error) { skipped.push({ name: label(path), reason: error instanceof ApiError && error.status === 413 ? error.message : '下载失败' }); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
  for (const file of results) if (file) files.push(file);
  return { files, skipped, ignored, source: `github.com/${target.owner}/${target.repo}` };
}

/** A non-GitHub page: one file named after the host and path, read by the public-page reader. */
export async function expandPage(raw: string, options: ExpandOptions): Promise<ExpandResult> {
  let url: URL; try { url = new URL(raw.trim()); } catch { throw new ApiError(400, '链接格式不对，请粘贴以 https:// 开头的网页地址。'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new ApiError(400, '只支持 https:// 开头的网页地址。');
  if (url.protocol === 'http:') url.protocol = 'https:';
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || /^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[')) throw new ApiError(400, '不能读取本机或内网地址，请粘贴公开网页的地址。');
  const download = options.downloadPage ?? downloadPublicKnowledge;
  let page: { file: KnowledgeImportFile; url: string };
  try { page = await download(url.href); }
  catch (error) { throw new ApiError(400, error instanceof Error ? error.message : '网页读取失败。'); }
  const extension = page.file.name.slice(page.file.name.lastIndexOf('.')) || '.html';
  const path = `${host}${url.pathname === '/' ? '' : url.pathname.replace(/\.(html?|php|aspx?)$/i, '')}`;
  return { files: [{ ...page.file, name: importNameFromPath(path.replace(/\/+$/, '') + extension) }], skipped: [], ignored: 0, source: page.url };
}

export async function expandKnowledgeImport(body: Record<string, unknown>, options: ExpandOptions = {}): Promise<ExpandResult> {
  const limit = budget(body);
  if (body.zip !== undefined && body.url !== undefined) throw new ApiError(400, '一次只展开一个压缩包或一个链接。');
  if (body.zip !== undefined) return expandZip(body.zip, limit);
  if (typeof body.url !== 'string' || !body.url.trim() || body.url.length > 1000) throw new ApiError(400, '请粘贴一个网页或 GitHub 仓库地址。');
  const github = parseGitHubUrl(body.url);
  if (github) return expandGitHub(github, options.fetchImpl ?? fetch, limit, options.timeoutMs);
  return expandPage(body.url, options);
}
