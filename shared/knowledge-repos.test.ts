import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanRepoText, defaultRules, parseRepoUrl, purposeFor, readRules, repoFileWanted, repoSyncIdle, suggestPurpose, summarizeFolders, STYLE_REFERENCE_TAG } from './knowledge-repos';
import { customerFactKnowledge, knowledgeHealth } from './knowledge-categories';

test('repository links: github.com only, normalized, never with credentials', () => {
  assert.deepEqual(parseRepoUrl('https://github.com/acme/handbook'), { owner: 'acme', repo: 'handbook', url: 'https://github.com/acme/handbook' });
  assert.equal(parseRepoUrl('github.com/acme/handbook.git').url, 'https://github.com/acme/handbook');
  assert.equal(parseRepoUrl('http://www.github.com/acme/handbook/').url, 'https://github.com/acme/handbook');
  assert.equal(parseRepoUrl('https://github.com/acme/handbook/tree/main/docs').url, 'https://github.com/acme/handbook');
  assert.equal(parseRepoUrl('git@github.com:acme/handbook.git').url, 'https://github.com/acme/handbook');
  assert.throws(() => parseRepoUrl('https://user:ghp_secret@github.com/acme/handbook'), /不要带账号、密码或令牌/);
  assert.throws(() => parseRepoUrl('https://gitlab.com/acme/handbook'), /只支持 GitHub/);
  assert.throws(() => parseRepoUrl('https://github.com.evil.example/acme/handbook'), /只支持 GitHub/);
  assert.throws(() => parseRepoUrl('https://github.com:8443/acme/handbook'), /只支持 GitHub/);
  assert.throws(() => parseRepoUrl('file:///etc/passwd'), /只支持/);
  assert.throws(() => parseRepoUrl('https://github.com/acme'), /仓库首页/);
  assert.throws(() => parseRepoUrl('https://github.com/acme/..'), /仓库首页/);
  assert.throws(() => parseRepoUrl('https://github.com/-rf/x'), /仓库首页/);
  assert.throws(() => parseRepoUrl('https://github.com/acme/handbook/settings'), /不是仓库首页/);
  assert.throws(() => parseRepoUrl(42), /请粘贴/);
});

test('folder defaults: customer-facing folders selected, style folders as 写法参考, internal ones left out', () => {
  const cases: Array<[string, string | undefined]> = [
    ['04_产品与技术架构', undefined], ['07_AI工具与工作流', undefined], ['02_方法论与交付', undefined], ['01_商业模式与战略', undefined],
    ['06_自媒体矩阵与爆款文案', 'style'], ['00_知识库索引', undefined], ['06_内容获客', 'style'], ['08_项目决策与复盘', undefined],
    ['品牌资产', 'reply'], ['06_销售与获客', 'reply'], ['05_客户案例与验收', 'reply'], ['常见问题', 'reply'], ['FAQ', 'reply'], ['价格表', 'reply'],
    ['产品介绍', 'reply'], ['销售话术', 'reply'], ['朋友圈素材', 'style'], ['编码规范', undefined], ['blog', undefined], ['docs', undefined],
    ['sales', 'reply'], ['scripts', undefined], ['客户名单', undefined], ['杂项', undefined],
  ];
  for (const [name, purpose] of cases) assert.equal(suggestPurpose(name), purpose, name);
});

test('which files are read: documents only; no tooling, build output, hidden, secret-looking or huge files', () => {
  assert.equal(repoFileWanted('06_销售/价格.md', 100), true);
  assert.equal(repoFileWanted('a/b.docx', 100), true);
  for (const path of ['a/b.png', 'a/b.svg', 'a/b.py', 'a/b.json', '.git/config', 'node_modules/x/readme.md', 'dist/a.md', 'a/.hidden.md', 'a/__pycache__/x.md', 'a/~$tmp.docx']) assert.equal(repoFileWanted(path, 100), false, path);
  assert.match(String(repoFileWanted('a/密码.md', 10)), /密码或密钥/);
  assert.match(String(repoFileWanted('a/api_key.txt', 10)), /密码或密钥/);
  assert.match(String(repoFileWanted('a/big.md', 3 * 1024 * 1024)), /超过 2MB/);
  assert.equal(repoFileWanted('a/../b.md', 10), false);
  assert.equal(repoFileWanted('a//b.md', 10), false);
});

test('rules: the deepest chosen folder wins, root files use ".", unknown folders are not imported', () => {
  const rules = { '销售': 'reply', '销售/内部': 'skip', '文案': 'style', '.': 'skip' } as const;
  assert.equal(purposeFor('销售/价格.md', rules), 'reply');
  assert.equal(purposeFor('销售/内部/底价.md', rules), undefined);
  assert.equal(purposeFor('销售/a/b/c.md', rules), 'reply');
  assert.equal(purposeFor('文案/1.md', rules), 'style');
  assert.equal(purposeFor('README.md', rules), undefined);
  assert.equal(purposeFor('新文件夹/x.md', rules), undefined);
  assert.equal(purposeFor('README.md', { '.': 'internal' }), 'internal');
});

test('folder summary counts files per folder and one level down; defaults follow the names', () => {
  const folders = summarizeFolders(['README.md', '06_销售与获客/价格.md', '06_销售与获客/话术/开场.md', '06_销售与获客/话术/异议.md', '04_产品与技术架构/a.md', '06_自媒体矩阵与爆款文案/1.md']);
  assert.deepEqual(folders.map(f => [f.path, f.files, f.suggested]), [['.', 1, undefined], ['04_产品与技术架构', 1, undefined], ['06_销售与获客', 3, 'reply'], ['06_自媒体矩阵与爆款文案', 1, 'style']]);
  assert.deepEqual(folders[2]!.children?.map(c => [c.path, c.files]), [['06_销售与获客/话术', 2]]);
  assert.deepEqual(defaultRules(folders), { '.': 'skip', '04_产品与技术架构': 'skip', '06_销售与获客': 'reply', '06_自媒体矩阵与爆款文案': 'style' });
  // The page may only choose folders that exist, with known purposes.
  assert.deepEqual(readRules({ '06_销售与获客/话术': 'style', '../etc': 'reply', '04_产品与技术架构': 'internal' }, folders), { '06_销售与获客/话术': 'style', '04_产品与技术架构': 'internal' });
  assert.throws(() => readRules({ '06_销售与获客': 'publish' }, folders), /用途无效/);
});

test('cleaning: front matter, comments, badges and images go; the text stays', () => {
  const raw = '---\ntitle: 价格\ntags: [a]\n---\n\n<!-- 内部备注 -->\n[![build](https://x/badge.svg)](https://x)\n![图](a.png)\n# 价格\n\n基础版 99 元/月，见 [[套餐说明|套餐]]。\n%% obsidian 备注 %%\n\n\n\n专业版 199 元/月。\n';
  assert.equal(cleanRepoText(raw), '# 价格\n\n基础版 99 元/月，见 套餐。\n\n专业版 199 元/月。');
});

test('idle: no customer waiting, nothing in flight, no other desktop work, no pressure, no 急停', () => {
  const calm = { emergency: false, resource: 'normal' as const, desktopBusy: false, reception: { busy: false, awaiting: 0, inFlight: 0 } };
  assert.deepEqual(repoSyncIdle(calm), { idle: true });
  assert.deepEqual(repoSyncIdle({ ...calm, reception: undefined }), { idle: true });
  assert.equal(repoSyncIdle({ ...calm, emergency: true }).idle, false);
  assert.equal(repoSyncIdle({ ...calm, resource: 'tight' }).idle, false);
  assert.equal(repoSyncIdle({ ...calm, desktopBusy: true }).idle, false);
  assert.equal(repoSyncIdle({ ...calm, reception: { busy: false, awaiting: 1, inFlight: 0 } }).reason, '有客户在等回复');
  assert.equal(repoSyncIdle({ ...calm, reception: { busy: false, awaiting: 0, inFlight: 1 } }).reason, '正在写或发回复');
  assert.equal(repoSyncIdle({ ...calm, reception: { busy: true, awaiting: 0, inFlight: 0 } }).idle, false);
});

test('写法参考 entries are never customer facts; their tag carries 文案 for style-example finders', () => {
  assert.match(STYLE_REFERENCE_TAG, /文案/);
  const style = { title: '开场白示例', tags: [STYLE_REFERENCE_TAG], enabled: true, reviewStatus: 'approved' };
  assert.equal(customerFactKnowledge(style), false);
  assert.equal(customerFactKnowledge({ title: '底价', tags: ['分类:内部资料'] }), false);
  assert.equal(customerFactKnowledge({ title: '基础版多少钱', tags: [] }), true);
  // Style examples do not count as enabled customer knowledge in the health check.
  assert.equal(knowledgeHealth([style]).total, 0);
});
