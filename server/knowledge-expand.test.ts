import assert from 'node:assert/strict';
import test from 'node:test';
import { expandKnowledgeImport, GITHUB_PRIVATE, GITHUB_RATE_LIMIT, parseGitHubUrl } from './knowledge-expand';

type Route = (url: URL) => Response | undefined;
function fakeFetch(routes: Route[]) {
  const seen: string[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input)); seen.push(url.href);
    assert.equal(init?.redirect, 'manual', 'redirects are followed by hand so the host can be checked');
    for (const route of routes) { const r = route(url); if (r) return r; }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { impl, seen };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const repo = (default_branch = 'main'): Route => url => url.href === 'https://api.github.com/repos/acme/shop' ? json({ default_branch, private: false, full_name: 'acme/shop' }) : undefined;

test('parses repository, folder and file links; other hosts are not GitHub', () => {
  assert.deepEqual(parseGitHubUrl('https://github.com/acme/shop'), { owner: 'acme', repo: 'shop', rest: [], blob: false });
  assert.deepEqual(parseGitHubUrl('https://github.com/acme/shop.git/'), { owner: 'acme', repo: 'shop', rest: [], blob: false });
  assert.deepEqual(parseGitHubUrl('https://www.github.com/acme/shop/tree/dev/docs/价格'), { owner: 'acme', repo: 'shop', rest: ['dev', 'docs', '价格'], blob: false });
  assert.deepEqual(parseGitHubUrl('https://github.com/acme/shop/blob/main/FAQ.md'), { owner: 'acme', repo: 'shop', rest: ['main', 'FAQ.md'], blob: true });
  assert.equal(parseGitHubUrl('https://example.com/acme/shop'), undefined);
  assert.equal(parseGitHubUrl('not a url'), undefined);
  assert.throws(() => parseGitHubUrl('https://github.com/acme'), /仓库地址/);
  assert.throws(() => parseGitHubUrl('https://github.com/acme/shop/issues/3'), /读不了/);
});

test('a public repository becomes import files: supported types only, tooling folders and lock files skipped, sizes capped', async () => {
  const tree = { truncated: false, tree: [
    { path: 'docs', type: 'tree' },
    { path: 'docs/价格.md', type: 'blob', size: 30 },
    { path: 'docs/FAQ.txt', type: 'blob', size: 20 },
    { path: 'docs/~$报价.docx', type: 'blob', size: 20 },
    { path: '.github/workflows/ci.md', type: 'blob', size: 20 },
    { path: 'node_modules/pkg/README.md', type: 'blob', size: 20 },
    { path: 'src/index.ts', type: 'blob', size: 20 },
    { path: 'big.pdf', type: 'blob', size: 9 * 1024 * 1024 },
    { path: 'archive.zip', type: 'blob', size: 100 },
  ] };
  const { impl, seen } = fakeFetch([repo(), url => url.href === 'https://api.github.com/repos/acme/shop/git/trees/main?recursive=1' ? json(tree) : undefined,
    url => url.hostname === 'raw.githubusercontent.com' ? new Response(`内容：${decodeURIComponent(url.pathname)}`) : undefined]);
  const result = await expandKnowledgeImport({ url: 'https://github.com/acme/shop' }, { fetchImpl: impl });
  assert.deepEqual(result.files.map(f => f.name), ['shop／docs／价格.md', 'shop／docs／FAQ.txt']);
  assert.equal(Buffer.from(result.files[0].base64, 'base64').toString('utf8'), '内容：/acme/shop/main/docs/价格.md');
  assert.deepEqual(result.skipped, [{ name: 'shop／big.pdf', reason: '超过 8MB' }, { name: 'shop／archive.zip', reason: '压缩包里的压缩包，请先解压' }]);
  assert.equal(result.ignored, 4); assert.equal(result.source, 'github.com/acme/shop');
  assert.ok(seen.every(href => /^https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//.test(href)));
});

test('a folder link reads only that folder; a branch name with a slash is found; the file budget is respected', async () => {
  const tree = { tree: [{ path: 'docs/a.md', type: 'blob', size: 5 }, { path: 'docs/b.md', type: 'blob', size: 5 }, { path: 'docs/c.md', type: 'blob', size: 5 }, { path: 'other/d.md', type: 'blob', size: 5 }] };
  const { impl, seen } = fakeFetch([repo(), url => url.pathname === '/repos/acme/shop/git/trees/feature/x' ? json(tree) : undefined,
    url => url.hostname === 'raw.githubusercontent.com' ? new Response('x') : undefined]);
  const result = await expandKnowledgeImport({ url: 'https://github.com/acme/shop/tree/feature/x/docs', maxFiles: 2 }, { fetchImpl: impl });
  assert.deepEqual(result.files.map(f => f.name), ['shop／docs／a.md', 'shop／docs／b.md']);
  assert.deepEqual(result.skipped, [{ name: 'shop／docs／c.md', reason: '一次最多读 2 份' }]);
  assert.ok(seen.includes('https://raw.githubusercontent.com/acme/shop/feature/x/docs/a.md'));
});

test('private or missing repositories and rate limits give the plain Download-ZIP advice', async () => {
  const missing = fakeFetch([]);
  await assert.rejects(expandKnowledgeImport({ url: 'https://github.com/acme/secret' }, { fetchImpl: missing.impl }), error => (error as Error).message === GITHUB_PRIVATE);
  const limited = fakeFetch([() => new Response('{"message":"API rate limit exceeded"}', { status: 403 })]);
  await assert.rejects(expandKnowledgeImport({ url: 'https://github.com/acme/shop' }, { fetchImpl: limited.impl }), error => (error as Error).message === GITHUB_RATE_LIMIT);
  const offline = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
  await assert.rejects(expandKnowledgeImport({ url: 'https://github.com/acme/shop' }, { fetchImpl: offline }), /连不上 GitHub/);
});

test('redirects are followed only to GitHub hosts; a download that fails is listed and the rest continue', async () => {
  const tree = { tree: [{ path: 'a.md', type: 'blob', size: 5 }, { path: 'b.md', type: 'blob', size: 5 }] };
  const evil = fakeFetch([url => url.pathname === '/repos/acme/shop' ? new Response(null, { status: 301, headers: { location: 'http://127.0.0.1/steal' } }) : undefined]);
  await assert.rejects(expandKnowledgeImport({ url: 'https://github.com/acme/shop' }, { fetchImpl: evil.impl }), /连不上 GitHub/);
  assert.ok(!evil.seen.some(href => href.includes('127.0.0.1')), 'never requests the redirect target');
  const renamed = fakeFetch([
    url => url.pathname === '/repos/acme/old' ? new Response(null, { status: 301, headers: { location: 'https://api.github.com/repos/acme/shop' } }) : undefined,
    repo(), url => url.pathname === '/repos/acme/shop/git/trees/main' ? json(tree) : undefined,
    url => url.pathname.endsWith('/a.md') ? new Response('A') : url.pathname.endsWith('/b.md') ? new Response('gone', { status: 500 }) : undefined]);
  const result = await expandKnowledgeImport({ url: 'https://github.com/acme/old' }, { fetchImpl: renamed.impl });
  assert.equal(result.files.length, 1); assert.deepEqual(result.skipped, [{ name: 'shop／b.md', reason: '下载失败' }]);
  assert.equal(result.source, 'github.com/acme/shop');
});

test('a web page becomes one file named after its host and path; local and private addresses are refused', async () => {
  const pages: string[] = [];
  const downloadPage = async (url: string) => { pages.push(url); const bytes = Buffer.from('<h1>价格</h1><p>基础版 99 元</p>'); return { file: { name: 'shop.example.com.html', size: bytes.length, base64: bytes.toString('base64') }, url }; };
  const result = await expandKnowledgeImport({ url: 'https://shop.example.com/help/price.html' }, { downloadPage });
  assert.deepEqual(result.files.map(f => f.name), ['shop.example.com／help／price.html']);
  assert.deepEqual(pages, ['https://shop.example.com/help/price.html']);
  for (const url of ['http://localhost:3000/', 'https://127.0.0.1/a', 'https://[::1]/', 'https://192.168.1.2/x', 'ftp://example.com/a.txt', 'file:///etc/passwd'])
    await assert.rejects(expandKnowledgeImport({ url }, { downloadPage }), /本机|内网|https/, url);
  assert.equal(pages.length, 1, 'refused addresses are never fetched');
  await assert.rejects(expandKnowledgeImport({}, { downloadPage }), /请粘贴/);
});
