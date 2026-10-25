import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MANUAL, MANUAL_CHANGELOG, MANUAL_FAQ, MANUAL_VERSION, manualChapter, manualFaq, manualForQuestion, manualRoute, manualSection, manualVersions, parseManual, parseManualRoute, searchManual } from './manual';
import { assertManualReady, changelogEntry, changelogVersions, checkManual, readManualSources, renderManualModule } from '../scripts/manual.mjs';
import { parseMarkdown } from './markdown';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkgVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version as string;

test('the manual loads in beginner order: 常见问题 first, 更新记录 last', () => {
  assert.deepEqual(MANUAL.map(c => c.id), ['faq', 'first-steps', 'import', 'start', 'mouse-keyboard', 'pause-stop', 'review', 'contacts', 'knowledge', 'data', 'marketing', 'group-sync', 'phone', 'models', 'purchase', 'updates', 'offline-alarm', 'reminders', 'privacy', 'help', 'customers', 'changelog']);
  assert.equal(MANUAL[0].id, MANUAL_FAQ);
  assert.equal(MANUAL.at(-1)!.id, MANUAL_CHANGELOG);
  for (const c of MANUAL) { assert.ok(c.title.trim(), c.id); assert.ok(c.sections.length >= 2, `${c.id} has sections`); }
  // Whatever the file names say, 常见问题 is pinned first and 更新记录 last.
  const reordered = parseManual([{ file: '05-changelog.md', markdown: '# 更新记录\n\n## 1.0.0\n\n- 改了' }, { file: '07-faq.md', markdown: '# 常见问题\n\n## 问 {#q}\n\n答' }, { file: '01-other.md', markdown: '# 其他\n\n## 一\n\n内容' }]);
  assert.deepEqual(reordered.map(c => c.id), ['faq', 'other', 'changelog']);
});

test('常见问题 holds at least 30 real beginner questions, each answered, with stable ids', () => {
  const faq = manualFaq();
  assert.ok(faq.length >= 30, `only ${faq.length}`);
  for (const f of faq) { assert.ok(f.a.length >= 10, `${f.q} has an answer`); assert.match(f.id, /^[a-z][a-z0-9-]*$/, `${f.q} has a stable id`); }
  const ids = new Set(faq.map(f => f.id)); assert.equal(ids.size, faq.length, 'ids are unique');
  for (const id of ['mouse-moving', 'slow-computer', 'no-reply', 'wrong-reply', 'pause', 'stop-now', 'lock-screen', 'window-closed', 'screen-consent', 'permission-missing', 'model-error', 'trial-used-up', 'new-computer']) assert.ok(ids.has(id), id);
});

test('every link in the manual opens a real chapter or section', () => {
  for (const c of MANUAL) for (const href of c.markdown.matchAll(/\]\(([^)]+)\)/g)) {
    const target = href[1];
    assert.match(target, /^#manual\//, `${c.id}: ${target} is an in-app manual link`);
    const [, chapter, section] = target.slice(1).split('/');
    assert.ok(manualChapter(chapter), `${c.id}: chapter ${chapter}`);
    if (section) assert.ok(manualSection(chapter, section), `${c.id}: section ${chapter}/${section}`);
  }
});

test('customer copy: no chat-platform name, no phone number, plain short headings, the real contact', () => {
  const all = MANUAL.map(c => c.markdown).join('\n');
  const forbiddenPlatform = new RegExp(['微', '信'].join('') + '|wechat|weixin|whatsapp', 'i');
  assert.ok(!forbiddenPlatform.test(all), 'never names the chat platform');
  assert.ok(!/(?<!\d)1[3-9]\d{9}(?!\d)|\d{3,4}-\d{7,8}/.test(all), 'no phone numbers');
  assert.ok(all.includes('kadadesk_support') && all.includes('Marshall@kunlungrowth.com'), 'contact is kadadesk_support / Marshall@kunlungrowth.com');
  for (const c of MANUAL) for (const b of parseMarkdown(c.markdown)) if (b.type === 'heading') assert.ok(!/。$/.test(b.text), `${c.id}: heading 「${b.text}」 has no trailing 。`);
  assert.ok(!/dangerouslySetInnerHTML|<script/i.test(all));
});

test('search finds the beginner answer first and ignores nonsense', () => {
  const expect: Array<[string, string]> = [
    ['鼠标自己在动', 'faq/mouse-moving'],
    ['电脑变卡', 'faq/slow-computer'],
    ['没回复客户', 'faq/no-reply'],
    ['回复不对', 'faq/wrong-reply'],
    ['锁屏后还接待吗', 'faq/lock-screen'],
    ['窗口关了', 'faq/window-closed'],
    ['试用用完了', 'faq/trial-used-up'],
    ['换电脑', 'faq/new-computer'],
    ['资料要导多少条', 'faq/how-much-knowledge'],
  ];
  for (const [query, ref] of expect) {
    const top = searchManual(query, 3).map(h => `${h.chapterId}/${h.sectionId}`);
    assert.equal(top[0], ref, `${query} → ${ref}, got ${top.join(', ')}`);
  }
  assert.ok(searchManual('怎么暂停', 3).some(h => h.chapterId === 'faq' && h.sectionId === 'pause'));
  assert.ok(searchManual('急停', 3).some(h => h.chapterId === 'pause-stop'));
  assert.ok(searchManual('不再提醒', 3).some(h => h.chapterId === 'reminders'));
  assert.equal(searchManual('手机', 1)[0].chapterId, 'phone', 'a chapter title match opens the chapter');
  assert.deepEqual(searchManual(''), []);
  assert.deepEqual(searchManual('zzqxv'), []);
  assert.ok(searchManual('鼠标', 20).every(h => h.chapterId !== MANUAL_CHANGELOG), '更新记录 is not searched');
});

test('the help assistant gets a few bounded sections with refs it can link to', () => {
  const sections = manualForQuestion('鼠标自己在动，是不是中毒了');
  assert.ok(sections.length >= 1 && sections.length <= 3);
  assert.equal(sections[0].ref, 'faq/mouse-moving');
  assert.match(sections[0].title, /^常见问题：/);
  for (const s of manualForQuestion('怎么暂停', 3, 120)) assert.ok(s.text.length <= 121);
  assert.deepEqual(manualForQuestion('zzqxv'), []);
});

test('routes: #manual/<chapter>/<section> is understood; unknown parts are dropped', () => {
  assert.equal(manualRoute('faq', 'stop-now'), 'manual/faq/stop-now');
  assert.deepEqual(parseManualRoute('#manual/faq/stop-now'), { chapter: 'faq', section: 'stop-now' });
  assert.deepEqual(parseManualRoute('manual/first-steps'), { chapter: 'first-steps', section: undefined });
  assert.deepEqual(parseManualRoute('manual/nope/stop-now'), { chapter: undefined, section: undefined });
  assert.deepEqual(parseManualRoute('manual/faq/nope'), { chapter: 'faq', section: undefined });
  assert.deepEqual(parseManualRoute('settings'), {});
});

test('version sync: the 更新记录 has an entry for package.json\'s version, newest first, and the bundle is fresh', () => {
  assert.equal(MANUAL_VERSION, pkgVersion, `docs/manual/99-changelog.md needs 「## ${pkgVersion}」 at the top (每次发版同步更新使用手册)`);
  assert.equal(manualVersions()[0], pkgVersion);
  const { problems } = checkManual(root);
  assert.deepEqual(problems, [], problems.join('\n'));
  assert.equal(readFileSync(join(root, 'shared/manual-content.ts'), 'utf8').replace(/\r\n/g, '\n'), renderManualModule(readManualSources(root)).replace(/\r\n/g, '\n'), 'run npm run manual');
  const changelog = readFileSync(join(root, 'docs/manual/99-changelog.md'), 'utf8');
  assert.match(changelogEntry(changelog, pkgVersion), /^- \S/m);
});

test('the release guard refuses a version without an entry, out of order, empty or with a stale bundle', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kadadesk-manual-'));
  try {
    cpSync(join(root, 'docs/manual'), join(dir, 'docs/manual'), { recursive: true });
    cpSync(join(root, 'shared/manual-content.ts'), join(dir, 'shared/manual-content.ts'));
    const pkg = (version: string) => writeFileSync(join(dir, 'package.json'), JSON.stringify({ version }));
    pkg(pkgVersion);
    assert.deepEqual(checkManual(dir).problems, []);
    assert.equal(assertManualReady(dir), pkgVersion);

    pkg('9.9.9');
    assert.throws(() => assertManualReady(dir), (e: Error) => /使用手册没有跟上 9\.9\.9/.test(e.message) && /更新记录里没有 9\.9\.9/.test(e.message) && /每次发版同步更新使用手册/.test(e.message) && /npm run manual/.test(e.message));

    const logFile = join(dir, 'docs/manual/99-changelog.md');
    const log = readFileSync(logFile, 'utf8');
    writeFileSync(logFile, log.replace(/\n## /, '\n## 9.9.9\n\n\n## '));
    assert.ok(checkManual(dir).problems.some(p => /9\.9\.9 下面还没有写改动/.test(p)), 'an empty entry is refused');
    writeFileSync(logFile, `${log}\n## 9.9.9\n\n- 新东西\n`);
    assert.ok(checkManual(dir).problems.some(p => /最新的在最上面/.test(p)), 'the newest entry must be first');
    assert.ok(checkManual(dir).problems.some(p => /npm run manual/.test(p)), 'an edited manual needs a regenerated bundle');
    writeFileSync(logFile, log.replace(/\n## /, '\n## 9.9.9\n\n- 新东西\n\n## '));
    writeFileSync(join(dir, 'shared/manual-content.ts'), renderManualModule(readManualSources(dir)));
    assert.deepEqual(checkManual(dir).problems, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('changelog helpers read versions in order and the bullets under one version', () => {
  const md = '# 更新记录\n\n## 1.2.0\n\n- 甲\n- 乙\n\n## v1.1.0\n\n- 丙\n';
  assert.deepEqual(changelogVersions(md), ['1.2.0', '1.1.0']);
  assert.equal(changelogEntry(md, '1.2.0'), '- 甲\n- 乙');
  assert.equal(changelogEntry(md, '1.0.0'), '');
});

test('packaging scripts run the manual guard before packaging', () => {
  for (const file of ['scripts/package-desktop.mjs']) {
    const source = readFileSync(join(root, file), 'utf8');
    assert.match(source, /import\s*\{\s*assertManualReady\s*\}\s*from\s*'\.\/manual\.mjs'/, file);
    assert.ok(source.indexOf('assertManualReady();') > 0 && source.indexOf('assertManualReady();') < source.indexOf('packager('), `${file} checks before packaging`);
  }
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
  assert.match(pkg.scripts.build, /^node scripts\/manual\.mjs && /, 'npm run build regenerates the manual bundle');
});
