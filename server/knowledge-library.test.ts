import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureLibraryLayout, folderSummary, freeSpace, LIBRARY_DIRS, libraryMirror, writeLibraryMirror } from './knowledge-library';
import type { Knowledge } from '../shared/types';

const k = (over: Partial<Knowledge>): Knowledge => ({ id: Math.random().toString(36).slice(2), title: '这个多少钱？', content: '招牌豆 68 元。', tags: [], enabled: true, createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-21T08:00:00Z', reviewStatus: 'approved', source: '价目表.xlsx', ...over });
async function dir(t: any) { const d = await mkdtemp(join(tmpdir(), 'kada-lib-')); t.after(() => rm(d, { recursive: true, force: true })); return d; }

test('the library has four folders and a plain-language guide', async t => {
  const root = await dir(t); await ensureLibraryLayout(root);
  const names = await readdir(root);
  for (const d of Object.values(LIBRARY_DIRS)) assert.ok(names.includes(d), d);
  assert.match(await readFile(join(root, '说明.txt'), 'utf8'), /只读，不会修改、移动或删除你的文件/);
  assert.ok((await freeSpace(join(root, 'not-yet', 'deeper')))! > 0, 'free space from the nearest existing folder');
});

test('02/03/04 sort knowledge into waiting, in use by category, and old versions by day', () => {
  const files = libraryMirror([
    k({ title: '这个多少钱？' }), k({ title: '可以退款吗？', content: '7 天内可退款。' }),
    k({ title: '新价格？', reviewStatus: 'pending', enabled: false, source: '新价目表.xlsx' }),
    k({ title: '旧价格', tags: ['资料版本:已替换'], enabled: false, updatedAt: '2026-10-19T03:00:00Z' }),
    k({ title: '内部底价', tags: ['分类:内部资料'] }),
  ], new Date('2026-10-22T10:00:00Z'));
  const names = [...files.keys()];
  assert.ok(names.includes(join(LIBRARY_DIRS.live, '产品与价格.md')));
  assert.ok(names.includes(join(LIBRARY_DIRS.live, '购买与售后.md')));
  assert.ok(names.includes(join(LIBRARY_DIRS.live, '内部资料（不发给客户）.md')));
  assert.ok(names.includes(join(LIBRARY_DIRS.pending, '来自 新价目表.md')));
  assert.ok(names.includes(join(LIBRARY_DIRS.old, '2026-10-19.md')));
  assert.match(files.get(join(LIBRARY_DIRS.live, '产品与价格.md'))!, /## 这个多少钱？[\s\S]*招牌豆 68 元[\s\S]*来源：价目表\.xlsx/);
  assert.ok(!files.get(join(LIBRARY_DIRS.live, '产品与价格.md'))!.includes('旧价格'), 'a replaced version is not shown as in use');
});

test('rewriting removes generated files that are no longer current but keeps files the owner put there', async t => {
  const root = await dir(t); await ensureLibraryLayout(root);
  await writeLibraryMirror(root, [k({ title: '新价格？', reviewStatus: 'pending', enabled: false, source: '新价目表.xlsx' })]);
  await writeFile(join(root, LIBRARY_DIRS.pending, '我的笔记.md'), '自己写的');
  const counts = await writeLibraryMirror(root, [k({ title: '新价格？', source: '新价目表.xlsx' })]);
  assert.deepEqual(counts, { pending: 0, live: 1, old: 0 });
  assert.deepEqual(await readdir(join(root, LIBRARY_DIRS.pending)), ['我的笔记.md']);
  assert.deepEqual(await readdir(join(root, LIBRARY_DIRS.live)), ['产品与价格.md']);
});

test('the folder signature changes when a file is added or edited, not otherwise', async t => {
  const root = await dir(t); await ensureLibraryLayout(root); const src = join(root, LIBRARY_DIRS.source);
  const empty = await folderSummary(src); assert.equal(empty.files, 0);
  await writeFile(join(src, '价目表.csv'), '名称,价格\n豆子,68');
  const one = await folderSummary(src); assert.equal(one.files, 1); assert.notEqual(one.signature, empty.signature);
  assert.equal((await folderSummary(src)).signature, one.signature);
  await utimes(join(src, '价目表.csv'), new Date(), new Date(Date.now() + 5000));
  assert.notEqual((await folderSummary(src)).signature, one.signature);
});

test('opening a document in Word (a ~$ lock file appears) does not count as a change', async t => {
  const root = await dir(t); await ensureLibraryLayout(root); const src = join(root, LIBRARY_DIRS.source);
  await writeFile(join(src, '价格表.docx'), 'x'); const before = await folderSummary(src);
  await writeFile(join(src, '~$价格表.docx'), 'lock'); await writeFile(join(src, 'Thumbs.db'), 'x');
  assert.equal((await folderSummary(src)).signature, before.signature);
});
