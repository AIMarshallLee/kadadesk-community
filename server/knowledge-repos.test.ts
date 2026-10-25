import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, symlink, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { AppState, Knowledge } from '../shared/types';
import type { KnowledgeDraft } from '../shared/knowledge';
import { STYLE_REFERENCE_TAG, type RepoLimits, type RepoView } from '../shared/knowledge-repos';
import { parseKnowledgeImport } from './knowledge-import';
import { autoEnableKnowledge } from './knowledge';
import type { OrganizeSource } from './knowledge-organize';
import { GIT_NO_ACCESS, GitProblem, type GitClient } from './knowledge-repo-git';
import { applyRepoFile, createKnowledgeRepos, disableRepoFile, entryFingerprint, planRepoSync, type ModelMode, type RepoIndex, type RepoNotice } from './knowledge-repos';

const blobHash = (content: string) => createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0${content}`).digest('hex');
const draft = (content: string, extra: Partial<KnowledgeDraft> = {}): KnowledgeDraft => ({ title: content.slice(0, 20), content, tags: [], question: '', aliases: [], scenario: 'all', source: 'GitHub · acme/handbook', sourceLocator: 'a.md · 段落 1', ...extra });

test('plan: new, changed, unchanged, deleted and no longer chosen files', () => {
  const record = (hash: string, extra = {}) => ({ hash, purpose: 'reply' as const, ids: ['k'], fps: {}, organized: true, status: 'done' as const, ...extra });
  const index: RepoIndex = { '销售/same.md': record('h1'), '销售/changed.md': record('old'), '销售/gone.md': record('h3'), '技术/x.md': record('h4'), '销售/raw.md': record('h5', { organized: false }), '文案/p.md': record('h6') };
  const listing = [{ path: '销售/same.md', size: 10, hash: 'h1' }, { path: '销售/changed.md', size: 10, hash: 'new' }, { path: '销售/new.md', size: 10, hash: 'h7' }, { path: '技术/x.md', size: 10, hash: 'h4' }, { path: '销售/raw.md', size: 10, hash: 'h5' }, { path: '文案/p.md', size: 10, hash: 'h6' }, { path: '销售/a.png', size: 10, hash: 'h8' }];
  const rules = { '销售': 'reply', '技术': 'skip', '文案': 'style' } as const;
  const plan = planRepoSync(listing, index, rules, { canOrganize: false });
  assert.deepEqual(plan.work.map(w => [w.path, w.why]), [['销售/changed.md', 'changed'], ['文案/p.md', 'purpose'], ['销售/new.md', 'new']]);
  assert.deepEqual(plan.removed.map(r => [r.path, r.reason]).sort(), [['技术/x.md', 'unselected'], ['销售/gone.md', 'deleted']]);
  assert.equal(plan.selected, 5);
  // With the owner's model, files imported unorganized (trial, no model) come back to be organized, last.
  assert.deepEqual(planRepoSync(listing, index, rules, { canOrganize: true }).work.map(w => w.why), ['changed', 'purpose', 'new', 'upgrade']);
});

test('a changed file replaces its own entries; unchanged facts keep their approval; nothing duplicates', () => {
  const knowledge: Knowledge[] = [];
  let n = 0; const newId = () => `k${++n}`;
  const first = applyRepoFile(knowledge, { importId: 'repo_s', rows: [draft('基础版 99 元'), draft('专业版 199 元')], now: '2026-10-01T00:00:00.000Z', newId });
  assert.equal(first.created.length, 2);
  for (const k of knowledge) { k.enabled = true; k.reviewStatus = 'approved'; k.approvedAt = '2026-10-01T00:00:00.000Z'; }
  const second = applyRepoFile(knowledge, { importId: 'repo_s', previous: first.record, rows: [draft('基础版 99 元'), draft('专业版 299 元')], now: '2026-10-02T00:00:00.000Z', newId });
  assert.deepEqual([second.created.length, second.kept.length, second.removed], [1, 1, ['k2']]);
  assert.deepEqual(knowledge.map(k => [k.content, k.enabled]), [['基础版 99 元', true], ['专业版 299 元', false]]);
  assert.equal(new Set(knowledge.map(k => k.content)).size, knowledge.length);
  // Re-applying the same rows changes nothing.
  const third = applyRepoFile(knowledge, { importId: 'repo_s', previous: second.record, rows: [draft('基础版 99 元'), draft('专业版 299 元')], now: '2026-10-03T00:00:00.000Z', newId });
  assert.deepEqual([third.created.length, third.removed.length, knowledge.length], [0, 0, 2]);
});

test('entries the owner edited are never overwritten; the file\'s new version waits for the owner', () => {
  const knowledge: Knowledge[] = [];
  const first = applyRepoFile(knowledge, { importId: 'repo_s', rows: [draft('退款 7 天内')], now: '2026-10-01T00:00:00.000Z' });
  const mine = knowledge[0]!; mine.content = '退款 15 天内（我改的）'; mine.heldForReview = true;
  const out = applyRepoFile(knowledge, { importId: 'repo_s', previous: first.record, rows: [draft('退款 10 天内')], now: '2026-10-02T00:00:00.000Z' });
  assert.deepEqual(out.edited, [mine.id]); assert.equal(out.removed.length, 0);
  assert.equal(knowledge.find(k => k.id === mine.id)!.content, '退款 15 天内（我改的）');
  assert.equal(out.created[0]!.heldForReview, true, '自主进化 leaves it for the owner');
  // Detected by content too, after the owner approved the edit (heldForReview is gone then).
  const knowledge2: Knowledge[] = [];
  const a = applyRepoFile(knowledge2, { importId: 'repo_s', rows: [draft('发货 48 小时')], now: '2026-10-01T00:00:00.000Z' });
  knowledge2[0]!.content = '发货 24 小时';
  const b = applyRepoFile(knowledge2, { importId: 'repo_s', previous: a.record, rows: [draft('发货 72 小时')], now: '2026-10-02T00:00:00.000Z' });
  assert.equal(b.edited.length, 1); assert.equal(knowledge2.length, 2);
  // A deleted file disables (never deletes) untouched entries; the owner's edits stay as they are.
  const gone = disableRepoFile(knowledge2, { importId: 'repo_s', previous: b.record, now: '2026-10-03T00:00:00.000Z' });
  assert.deepEqual(gone, { disabled: 1, edited: 1 });
  assert.equal(knowledge2.length, 2);
  assert.ok(knowledge2.find(k => k.content === '发货 72 小时')!.tags.includes('资料状态:来源已删除'));
  assert.equal(entryFingerprint(knowledge2[0]!), entryFingerprint({ ...knowledge2[0]! }));
});

// —— the engine, with a fake git, a fake GitHub API and an in-memory knowledge base ——
type Remote = { head: string; files: Record<string, string>; private: boolean; signedIn: boolean };
async function harness(options: { files: Record<string, string>; private?: boolean; signedIn?: boolean; git?: boolean; mode?: ModelMode; limits?: Partial<RepoLimits>; autoEnable?: boolean; onParse?: (n: number) => Promise<void> } ) {
  const dir = await mkdtemp(join(tmpdir(), 'kadadesk-repos-'));
  const remote: Remote = { head: 'c'.repeat(40), files: { ...options.files }, private: options.private ?? true, signedIn: options.signedIn ?? true };
  const state = { knowledge: [] as Knowledge[], tasks: [], preferences: { autoEnableKnowledge: options.autoEnable ?? true } } as unknown as AppState;
  const counts = { lsRemote: 0, update: 0, tree: 0, parse: 0, organize: 0, api: 0, raw: 0 };
  const organized: OrganizeSource[][] = [];
  const notices: RepoNotice[] = [];
  let clock = Date.parse('2026-10-20T08:00:00.000Z');
  let mode: ModelMode = options.mode ?? 'own';
  const access = () => { if (remote.private && !remote.signedIn) throw new GitProblem('auth', GIT_NO_ACCESS); };
  const git: GitClient = {
    locate: async () => options.git === false ? undefined : '/usr/bin/git',
    remoteHead: async () => { counts.lsRemote++; access(); return remote.head; },
    update: async (_url, target) => {
      counts.update++; access();
      await rm(target, { recursive: true, force: true });
      for (const [path, content] of Object.entries(remote.files)) { await mkdir(dirname(join(target, path)), { recursive: true }); await writeFile(join(target, path), content); }
      await mkdir(join(target, '.git'), { recursive: true });
      return remote.head;
    },
    tree: async () => { counts.tree++; return Object.entries(remote.files).map(([path, content]) => ({ path, size: Buffer.byteLength(content), hash: blobHash(content) })); },
  };
  const fetchImpl = (async (input: string | URL) => {
    const url = new URL(String(input));
    if (url.hostname === 'api.github.com') {
      counts.api++;
      if (remote.private) return new Response('{"message":"Not Found"}', { status: 404 });
      if (url.pathname.endsWith('/commits/HEAD')) return new Response(remote.head, { status: 200 });
      if (url.pathname.includes('/git/trees/')) return new Response(JSON.stringify({ tree: Object.entries(remote.files).map(([path, content]) => ({ path, type: 'blob', mode: '100644', size: Buffer.byteLength(content), sha: blobHash(content) })), truncated: false }), { status: 200 });
    }
    if (url.hostname === 'raw.githubusercontent.com') {
      counts.raw++;
      const path = decodeURIComponent(url.pathname.split('/').slice(4).join('/'));
      const content = remote.files[path];
      return content === undefined ? new Response('', { status: 404 }) : new Response(content, { status: 200 });
    }
    return new Response('', { status: 404 });
  }) as typeof fetch;
  const engine = await createKnowledgeRepos({
    dataDir: dir, getState: () => state, mutate: async (_a, _t, _d, change) => { change(); }, git, fetchImpl,
    parse: async input => { counts.parse++; await options.onParse?.(counts.parse); return parseKnowledgeImport(input); },
    organize: async rows => { counts.organize++; organized.push(rows); return { rows: rows.map(r => ({ ...r, title: '整理：' + r.title.slice(0, 30), question: `${r.content.slice(0, 12)}？`, aliases: [], tags: ['价格'], scenario: 'all' as const })), organization: { summary: 's', missing: [], workflow: { name: 'w', scenario: 'service', description: '', instructions: 'i', greeting: '' } } }; },
    modelMode: async () => mode,
    autoEnable: async ids => state.preferences.autoEnableKnowledge === false ? undefined : autoEnableKnowledge(state.knowledge, ids),
    now: () => clock, notify: n => notices.push(n), limits: options.limits,
  });
  const view = () => engine.view();
  const source = () => view().sources[0]!;
  const add = async (url = 'https://github.com/acme/handbook') => { await engine.handle('POST', '/knowledge/repos', { url }); await engine.whenIdle(); return source(); };
  const confirm = async (rules?: Record<string, string>) => { await engine.handle('POST', '/knowledge/repos/folders', { id: source().id, rules: rules ?? source().rules }); await engine.whenIdle(); return source(); };
  const sync = async () => { await engine.handle('POST', '/knowledge/repos/sync', { id: source().id }); await engine.whenIdle(); return source(); };
  const ofPath = (path: string) => state.knowledge.filter(k => k.sourceLocator?.startsWith(path + ' · '));
  return { dir, remote, state, counts, organized, notices, engine, view, source, add, confirm, sync, ofPath, tick: (ms: number) => { clock += ms; }, setMode: (m: ModelMode) => { mode = m; }, cleanup: async () => { await engine.close?.(); await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } };
}
const REPO = {
  'README.md': '# 知识库\n\n内部目录说明。',
  '04_产品与技术架构/架构.md': '# 架构\n\n服务部署在内网。',
  '06_销售与获客/价格.md': '# 价格\n\n基础版 99 元一个月。\n\n专业版 199 元一个月。',
  '06_销售与获客/售后.md': '# 售后\n\n7 天内可以退款。',
  '06_自媒体矩阵与爆款文案/开场.md': '---\ntags: [文案]\n---\n# 开场\n\n老板们，今天说一个省人工的小方法。',
  '00_知识库索引/索引.md': '# 索引\n\n全部文件列表。',
  '品牌资产/logo.png': 'PNG',
  '06_销售与获客/config.json': '{"a":1}',
};

test('private repository: the public API says 404, so the computer\'s own git reads it; defaults leave internal folders out', async () => {
  const h = await harness({ files: REPO });
  try {
    const added = await h.add();
    assert.equal(added.transport, 'git', 'fell back from the API to git');
    assert.equal(added.confirmed, false);
    assert.deepEqual(added.rules, { '.': 'skip', '00_知识库索引': 'skip', '04_产品与技术架构': 'skip', '06_自媒体矩阵与爆款文案': 'style', '06_销售与获客': 'reply' });
    assert.equal(h.state.knowledge.length, 0, 'nothing imported before the owner starts it');
    const done = await h.confirm();
    assert.equal(done.status, 'ready'); assert.deepEqual(done.progress, { done: 3, total: 3 }); assert.equal(done.remaining, 0);
    assert.equal(h.ofPath('04_产品与技术架构/架构.md').length, 0); assert.equal(h.ofPath('README.md').length, 0);
    const prices = h.ofPath('06_销售与获客/价格.md');
    assert.equal(prices.length, 2); assert.ok(prices.every(k => k.importId === `repo_${done.id}` && k.question && k.tags.includes('分类:产品与价格')));
    assert.ok(prices.every(k => k.enabled), '整理完直接启用 is on');
    const style = h.ofPath('06_自媒体矩阵与爆款文案/开场.md');
    assert.equal(style.length, 1); assert.deepEqual(style[0]!.tags, [STYLE_REFERENCE_TAG]); assert.doesNotMatch(style[0]!.content, /tags:/, 'front matter stripped');
    assert.equal(h.counts.organize, 2, 'only 回复客户用 files go to the model');
    assert.ok(h.organized.flat().every(r => !r.tags.includes(STYLE_REFERENCE_TAG)));
    assert.equal(h.notices.length, 0, 'a manual sync shows its result on the page');
  } finally { await h.cleanup(); }
});

test('no access: the plain explanation shows in the card; an automatic failure reminds at most once a day', async () => {
  const h = await harness({ files: REPO, signedIn: false });
  try {
    const added = await h.add();
    assert.equal(added.status, 'error'); assert.equal(added.error, GIT_NO_ACCESS);
    assert.match(GIT_NO_ACCESS, /还没登录 GitHub/); assert.match(GIT_NO_ACCESS, /Download ZIP/); assert.match(GIT_NO_ACCESS, /不会问你要密码或令牌/);
    h.remote.signedIn = true; await h.sync(); await h.confirm();
    h.remote.signedIn = false; h.remote.head = 'd'.repeat(40); h.tick(7 * 3600_000);
    const idle = () => ({ idle: true });
    assert.equal(await h.engine.autoTick(idle), true); await h.engine.whenIdle();
    assert.equal(h.source().status, 'error'); assert.equal(h.notices.filter(n => n.kind === 'error').length, 1);
    h.tick(7 * 3600_000); await h.engine.autoTick(idle); await h.engine.whenIdle();
    assert.equal(h.notices.filter(n => n.kind === 'error').length, 1, 'not again within a day');
    h.tick(18 * 3600_000); await h.engine.autoTick(idle); await h.engine.whenIdle();
    assert.equal(h.notices.filter(n => n.kind === 'error').length, 2);
  } finally { await h.cleanup(); }
});

test('public repository goes through the API without git; the light check skips everything when nothing changed', async () => {
  const h = await harness({ files: REPO, private: false, git: false });
  try {
    assert.equal((await h.add()).transport, 'api');
    await h.confirm();
    assert.equal(h.counts.update, 0, 'no git'); assert.equal(h.counts.raw, 3);
    const parsed = h.counts.parse, api = h.counts.api;
    const again = await h.sync();
    assert.match(again.detail, /没有变化/);
    assert.equal(h.counts.parse, parsed); assert.equal(h.counts.raw, 3); assert.equal(h.counts.api, api + 1, 'one light request');
  } finally { await h.cleanup(); }
});

test('incremental: only new and changed files are read; a deleted file disables its entries and says so', async () => {
  const h = await harness({ files: REPO });
  try {
    await h.add(); await h.confirm();
    const parsed = h.counts.parse;
    const keep = h.ofPath('06_销售与获客/价格.md').find(k => k.content.includes('基础版'))!;
    h.remote.files['06_销售与获客/价格.md'] = '# 价格\n\n基础版 99 元一个月。\n\n专业版 299 元一个月。';
    delete h.remote.files['06_销售与获客/售后.md'];
    h.remote.files['06_销售与获客/常见问题.md'] = '问：能开发票吗\n答：可以开增值税普通发票。';
    h.remote.head = 'e'.repeat(40);
    const s = await h.sync();
    assert.equal(h.counts.parse - parsed, 2, 'the unchanged style file is not read again');
    assert.deepEqual(s.lastChange && [s.lastChange.added, s.lastChange.updated, s.lastChange.disabled], [1, 1, 1]);
    const prices = h.ofPath('06_销售与获客/价格.md');
    assert.equal(prices.length, 2); assert.ok(prices.some(k => k.id === keep.id && k.enabled), 'the unchanged fact keeps its entry');
    assert.ok(prices.some(k => k.content.includes('299')) && !prices.some(k => k.content.includes('199')));
    const refund = h.ofPath('06_销售与获客/售后.md');
    assert.equal(refund.length, 1); assert.equal(refund[0]!.enabled, false); assert.ok(refund[0]!.tags.includes('资料状态:来源已删除'));
    assert.match(s.detail, /新增 1 份、更新 1 份、停用 1 份/);
    // Choosing a folder away later disables its entries the same way.
    await h.confirm({ ...h.source().rules, '06_自媒体矩阵与爆款文案': 'skip' });
    assert.equal(h.ofPath('06_自媒体矩阵与爆款文案/开场.md')[0]!.enabled, false);
  } finally { await h.cleanup(); }
});

test('budget: at most N files organized per sync, the rest carry over with progress', async () => {
  const files: Record<string, string> = {};
  for (let i = 1; i <= 5; i++) files[`销售/价格${i}.md`] = `# 价格 ${i}\n\n第 ${i} 种套餐 ${i * 100} 元。`;
  const h = await harness({ files, limits: { organizeFilesPerSync: 2, modelCallsPerSync: 50 } });
  try {
    await h.add();
    let s = await h.confirm({ '销售': 'reply' });
    assert.deepEqual(s.progress, { done: 2, total: 5 }); assert.equal(s.remaining, 3); assert.equal(h.counts.organize, 2);
    assert.match(s.detail, /剩下的 3 份下次继续/);
    assert.ok(Date.parse(s.nextCheckAt!) - Date.parse(s.lastCheckAt!) <= 30 * 60_000, 'the next round comes soon');
    s = await h.sync(); assert.deepEqual(s.progress, { done: 4, total: 5 });
    s = await h.sync(); assert.deepEqual(s.progress, { done: 5, total: 5 }); assert.equal(s.remaining, 0); assert.equal(h.counts.organize, 5);
    // Model calls are capped too.
    const h2 = await harness({ files, limits: { modelCallsPerSync: 1 } });
    try { await h2.add(); const s2 = await h2.confirm({ '销售': 'reply' }); assert.equal(h2.counts.organize, 1); assert.equal(s2.remaining, 4); } finally { await h2.cleanup(); }
  } finally { await h.cleanup(); }
});

test('automatic updates run only when idle, every 6 hours, and stop between files when kadadesk gets busy', async () => {
  const files: Record<string, string> = {};
  for (let i = 1; i <= 4; i++) files[`销售/f${i}.md`] = `# 第 ${i} 条\n\n内容 ${i}。`;
  const h = await harness({ files });
  try {
    await h.add(); await h.confirm({ '销售': 'reply' });
    const before = h.counts.lsRemote;
    assert.equal(await h.engine.autoTick(() => ({ idle: true })), false, 'not due yet');
    h.tick(6 * 3600_000 + 1000);
    assert.equal(await h.engine.autoTick(() => ({ idle: false, reason: '有客户在等回复' })), false, 'busy: wait');
    assert.equal(h.counts.lsRemote, before, 'nothing ran while busy');
    for (let i = 5; i <= 8; i++) h.remote.files[`销售/f${i}.md`] = `# 第 ${i} 条\n\n内容 ${i}。`;
    h.remote.head = 'f'.repeat(40);
    let checks = 0;
    assert.equal(await h.engine.autoTick(() => ({ idle: ++checks <= 3, reason: '有客户在等回复' })), true);
    await h.engine.whenIdle();
    const s = h.source();
    assert.ok(s.remaining > 0 && s.remaining < 4, `stopped part-way (${s.remaining} left)`);
    assert.match(s.detail, /有客户在等回复，先停下/);
    assert.ok(Date.parse(s.nextCheckAt!) - Date.parse(s.lastCheckAt!) <= 10 * 60_000);
    h.tick(11 * 60_000);
    await h.engine.autoTick(() => ({ idle: true })); await h.engine.whenIdle();
    assert.equal(h.source().remaining, 0); assert.equal(h.ofPath('销售/f8.md').length, 1);
    assert.equal(h.notices.filter(n => n.kind === 'changed').length, 2, 'one reminder per automatic sync with changes');
    assert.match(h.notices[0]!.body, /新增 \d+ 份、更新 0 份、停用 0 份/);
    // Turned off: never automatic.
    await h.engine.handle('POST', '/knowledge/repos/auto', { id: s.id, on: false });
    h.tick(7 * 3600_000); assert.equal(await h.engine.autoTick(() => ({ idle: true })), false);
  } finally { await h.cleanup(); }
});

test('free trial relay: no organizing calls; raw text goes in and is organized once the owner\'s model is there', async () => {
  const h = await harness({ files: REPO, mode: 'trial' });
  try {
    await h.add(); let s = await h.confirm();
    assert.equal(h.counts.organize, 0);
    assert.equal(h.ofPath('06_销售与获客/价格.md').length, 2);
    assert.match(s.detail, /免费试用的模型不用来整理大批资料/);
    h.setMode('own');
    s = await h.sync();
    assert.equal(h.counts.organize, 2, 'the two 回复客户用 files are organized now');
    assert.ok(h.ofPath('06_销售与获客/价格.md').every(k => k.question));
    const none = await harness({ files: REPO, mode: 'none' });
    try { await none.add(); const s2 = await none.confirm(); assert.equal(none.counts.organize, 0); assert.match(s2.detail, /还没接好回复模型/); assert.equal(none.ofPath('06_销售与获客/售后.md').length, 1); } finally { await none.cleanup(); }
  } finally { await h.cleanup(); }
});

test('secrets in the repository never reach the model or the knowledge base', async () => {
  const key = 'sk-proj-' + 'a1B2c3D4e5F6g7H8i9J0k1L2';
  const h = await harness({ files: { '销售/接入.md': `# 接入\n\n测试用的 key=${key} 不要外传。\n\n密码：Abc12345 用于后台。` } });
  try {
    await h.add(); const s = await h.confirm({ '销售': 'reply' });
    const all = JSON.stringify(h.state.knowledge) + JSON.stringify(h.organized);
    assert.ok(!all.includes(key) && !all.includes('Abc12345'));
    assert.match(all, /已隐藏/);
    assert.match(s.detail, /已隐藏/);
  } finally { await h.cleanup(); }
});

test('owner edits survive an upstream change; the new version waits; 内部参考 is stored as 内部资料 and never enabled', async () => {
  const h = await harness({ files: { '销售/售后.md': '# 售后\n\n7 天内可以退款。', '内部/底价.md': '# 底价\n\n进货价 30 元。' } });
  try {
    await h.add(); await h.confirm({ '销售': 'reply', '内部': 'internal' });
    const internal = h.ofPath('内部/底价.md');
    assert.equal(internal.length, 1); assert.ok(internal[0]!.tags.includes('分类:内部资料')); assert.equal(internal[0]!.enabled, false);
    const mine = h.ofPath('销售/售后.md')[0]!;
    mine.content = '15 天内可以退款（老板改的）'; mine.enabled = false; mine.reviewStatus = 'pending'; mine.heldForReview = true;
    h.remote.files['销售/售后.md'] = '# 售后\n\n10 天内可以退款。'; h.remote.head = '9'.repeat(40);
    const s = await h.sync();
    const entries = h.ofPath('销售/售后.md');
    assert.ok(entries.some(k => k.id === mine.id && k.content.includes('老板改的')), 'not overwritten');
    const fresh = entries.find(k => k.content.includes('10 天'))!;
    assert.equal(fresh.heldForReview, true); assert.equal(fresh.enabled, false);
    assert.match(s.detail, /你改过的知识没有覆盖/);
  } finally { await h.cleanup(); }
});

test('stop: the first sync of a big repository can be stopped; what was organized stays, the rest continues later', async () => {
  const files: Record<string, string> = {};
  for (let i = 1; i <= 30; i++) files[`文案/p${String(i).padStart(2, '0')}.md`] = `# 第 ${i} 篇\n\n正文 ${i}。`;
  let reached!: () => void, release!: () => void;
  const atFive = new Promise<void>(r => { reached = r; }), gate = new Promise<void>(r => { release = r; });
  const h = await harness({ files, onParse: async n => { if (n === 5) { reached(); await gate; } } });
  try {
    await h.add();
    await h.engine.handle('POST', '/knowledge/repos/folders', { id: h.source().id, rules: { '文案': 'style' } });
    await atFive;
    const running: RepoView = h.engine.view();
    assert.equal(running.running?.id, h.source().id); assert.match(running.running!.phase, /已整理 4 \/ 共 30 份/);
    const stopped: RepoView = await h.engine.handle('POST', '/knowledge/repos/stop', {});
    assert.equal(stopped.stopRequested, true);
    release(); await h.engine.whenIdle();
    const s = h.source();
    assert.ok(s.remaining > 0 && s.progress.done < 30, `stopped with ${s.remaining} left`);
    const s2 = await h.sync(); assert.equal(s2.remaining, 0); assert.equal(s2.progress.done, 30);
    assert.equal(h.state.knowledge.length, 30);
  } finally { await h.cleanup(); }
});

test('local folder: read in place, symlinks out of the folder are ignored, a touched but unchanged file is not processed again', async () => {
  const outside = await mkdtemp(join(tmpdir(), 'kadadesk-outside-'));
  const h = await harness({ files: {} });
  try {
    const folder = join(h.dir, '资料');
    await mkdir(join(folder, '销售'), { recursive: true });
    await writeFile(join(folder, '销售', '价格.md'), '# 价格\n\n基础版 99 元。');
    await writeFile(join(outside, 'secret.md'), '# 外面\n\n不该被读到。');
    await symlink(join(outside, 'secret.md'), join(folder, '销售', '链接.md'));
    await symlink(outside, join(folder, '销售', '外部目录'));
    await h.engine.addFolder(folder); await h.engine.whenIdle();
    assert.equal(h.source().transport, 'folder');
    await h.confirm({ '销售': 'reply' });
    assert.equal(h.state.knowledge.length, 1);
    assert.ok(!JSON.stringify(h.state.knowledge).includes('不该被读到'));
    const parsed = h.counts.parse;
    const later = new Date(Date.now() + 60_000); await utimes(join(folder, '销售', '价格.md'), later, later);
    const s = await h.sync();
    assert.equal(h.counts.parse, parsed, 'same content, nothing re-read into the knowledge base');
    assert.match(s.detail, /没有新的变化/);
    await assert.rejects(h.engine.addFolder('/'), /不要选整个磁盘/);
  } finally { await h.cleanup(); await rm(outside, { recursive: true, force: true }); }
});

test('the page cannot add a local path or a non-GitHub link', async () => {
  const h = await harness({ files: {} });
  try {
    await assert.rejects(h.engine.handle('POST', '/knowledge/repos', { url: 'https://example.com/acme/handbook' }), /只支持 GitHub/);
    await assert.rejects(h.engine.handle('POST', '/knowledge/repos', { url: ['/', 'Users', '/'].join('') + 'me/资料' }), /格式不对|仓库/);
    await assert.rejects(h.engine.handle('POST', '/knowledge/repos/folders', { id: 'nope', rules: {} }), /不在了/);
  } finally { await h.cleanup(); }
});

test('service: /knowledge/repos goes through the renderer guard and the service; trial relay imports raw; 写法参考 stays out of customer facts', async () => {
  const { createService } = await import('./service');
  const { isAllowedRequest } = await import('../desktop/guards');
  const { customerFactKnowledge } = await import('../shared/knowledge-categories');
  for (const [method, path] of [['GET', '/knowledge/repos'], ['POST', '/knowledge/repos'], ['POST', '/knowledge/repos/folders'], ['POST', '/knowledge/repos/sync'], ['POST', '/knowledge/repos/stop'], ['POST', '/knowledge/repos/auto'], ['DELETE', '/knowledge/repos']] as const) assert.ok(isAllowedRequest({ method, path, body: {} }), `${method} ${path}`);
  const dir = await mkdtemp(join(tmpdir(), 'kadadesk-repos-service-'));
  const files: Record<string, string> = { '06_销售与获客/售后.md': '# 售后\n\n7 天内可以退款。', '06_自媒体矩阵与爆款文案/开场.md': '# 开场\n\n老板们，今天说一个省人工的小方法。', '04_产品与技术架构/a.md': '# 架构\n\n内网部署。' };
  const git: GitClient = {
    locate: async () => '/usr/bin/git', remoteHead: async () => 'b'.repeat(40),
    update: async (_url, target) => { for (const [p, c] of Object.entries(files)) { await mkdir(dirname(join(target, p)), { recursive: true }); await writeFile(join(target, p), c); } await mkdir(join(target, '.git'), { recursive: true }); return 'b'.repeat(40); },
    tree: async () => Object.entries(files).map(([path, c]) => ({ path, size: Buffer.byteLength(c), hash: blobHash(c) })),
  };
  const fetchImpl = (async () => new Response('{"message":"Not Found"}', { status: 404 })) as typeof fetch;
  const service = await createService({ dataDir: dir, git, fetchImpl });
  try {
    const call = (method: string, path: string, body?: unknown) => service.request({ method, path, body }) as Promise<any>;
    await assert.rejects(call('POST', '/knowledge/repos', { url: 'https://example.com/a/b' }), (e: any) => e.status === 400 && /只支持 GitHub/.test(e.message));
    await call('POST', '/knowledge/repos', { url: 'https://github.com/acme/handbook' }); await service.knowledgeRepos.whenIdle();
    const added = (await call('GET', '/knowledge/repos')).sources[0];
    assert.equal(added.transport, 'git');
    await call('POST', '/knowledge/repos/folders', { id: added.id, rules: added.rules }); await service.knowledgeRepos.whenIdle();
    const view = await call('GET', '/knowledge/repos');
    assert.equal(view.sources[0].progress.done, 2);
    const state = await call('GET', '/state');
    const mine = state.knowledge.filter((k: Knowledge) => k.importId === `repo_${added.id}`);
    assert.equal(mine.length, 2);
    const style = mine.find((k: Knowledge) => k.tags.includes(STYLE_REFERENCE_TAG))!;
    assert.equal(style.enabled, true, 'style examples are readable by other features');
    assert.equal(customerFactKnowledge(style), false, 'but never a customer fact');
    assert.ok(state.events.some((e: any) => e.action === 'knowledge_repo_synced'));
    assert.ok(!JSON.stringify(state.knowledge).includes('内网部署'), 'internal folder left out by default');
  } finally { await service.close(); await rm(dir, { recursive: true, force: true }); }
});

test('long files: each organize call stays under the organizer\'s size limit; at most two calls per file, the rest keeps its text', async () => {
  const paragraph = (i: number) => `第 ${i} 段：` + '这是一段很长的产品说明，讲清楚了怎么用。'.repeat(70);
  const h = await harness({ files: { '销售/长文.md': Array.from({ length: 45 }, (_, i) => paragraph(i + 1)).join('\n\n') } });
  try {
    await h.add(); await h.confirm({ '销售': 'reply' });
    assert.equal(h.counts.organize, 2);
    assert.ok(h.organized.every(batch => batch.length <= 20 && JSON.stringify(batch).length <= 28000));
    const entries = h.ofPath('销售/长文.md');
    assert.equal(entries.length, 45, 'every paragraph is kept');
    assert.ok(entries.some(k => !k.question) && entries.some(k => k.question));
  } finally { await h.cleanup(); }
});
