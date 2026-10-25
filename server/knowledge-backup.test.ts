import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKUP_FOLDER, backupDue, backupLibrary, KEEP, knowledgeCsv, MARK_FILE } from './knowledge-backup';
import { ensureLibraryLayout, LIBRARY_DIRS } from './knowledge-library';
import { parseKnowledgeImport } from './knowledge-import';
import type { Knowledge } from '../shared/types';

const k = (over: Partial<Knowledge>): Knowledge => ({ id: Math.random().toString(36).slice(2), title: '多少钱', question: '这个多少钱？', content: '招牌豆 68 元，满 99 包邮。', tags: ['价格'], enabled: true, createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-21T08:00:00Z', reviewStatus: 'approved', ...over });
async function dir(t: any) { const d = await mkdtemp(join(tmpdir(), 'kada-bak-')); t.after(() => rm(d, { recursive: true, force: true })); return d; }

test('the backup CSV holds only knowledge in use and imports back as it is', async () => {
  const csv = knowledgeCsv([k({}), k({ title: '旧价', content: '58 元', tags: ['资料版本:已替换'] }), k({ title: '待确认', reviewStatus: 'pending' }), k({ title: '带逗号', question: '能开票吗', content: '可以，电子票，"专票"也行' })]);
  const parsed = await parseKnowledgeImport({ files: [{ name: '知识库备份.csv', size: Buffer.byteLength(csv), base64: Buffer.from(csv, 'utf8').toString('base64') }] });
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].content, '招牌豆 68 元，满 99 包邮。'); assert.equal(parsed.rows[0].question, '这个多少钱？');
  assert.equal(parsed.rows[1].content, '可以，电子票，"专票"也行');
});

test('a backup copies the owner files and the knowledge, replaces today’s earlier one and keeps only the newest ones it made', async t => {
  const d = await dir(t); const root = join(d, 'lib'), usb = join(d, 'usb'); await ensureLibraryLayout(root); await mkdir(usb);
  await writeFile(join(root, LIBRARY_DIRS.source, '价目表.csv'), '名称,价格\n豆子,68');
  await mkdir(join(usb, BACKUP_FOLDER, '2020-01-01'), { recursive: true }); await writeFile(join(usb, BACKUP_FOLDER, '2020-01-01', '我自己的.txt'), 'x');
  for (let i = 0; i < KEEP + 2; i++) { const day = `2026-09-${String(i + 1).padStart(2, '0')}`; await mkdir(join(usb, BACKUP_FOLDER, day), { recursive: true }); await writeFile(join(usb, BACKUP_FOLDER, day, MARK_FILE), 'old'); }
  const r = await backupLibrary({ root, target: usb, knowledge: [k({})], now: new Date(2026, 9, 22, 10) });
  assert.equal(r.knowledge, 1); assert.ok(r.files >= 4);
  assert.equal(await readFile(join(r.path, '原始资料', '价目表.csv'), 'utf8'), '名称,价格\n豆子,68');
  assert.match(await readFile(join(r.path, '知识库备份.csv'), 'utf8'), /招牌豆 68 元/);
  await backupLibrary({ root, target: usb, knowledge: [k({ content: '招牌豆 72 元' })], now: new Date(2026, 9, 22, 18) });
  assert.match(await readFile(join(r.path, '知识库备份.csv'), 'utf8'), /72 元/, 'one folder per day, the later one wins');
  const left = await readdir(join(usb, BACKUP_FOLDER));
  assert.ok(left.includes('2020-01-01'), 'a folder 咔哒 did not make is never removed');
  assert.equal(left.filter(n => n !== '2020-01-01').length, KEEP);
  assert.ok(!left.some(n => n.includes('正在备份')));
});

test('an unplugged USB stick gives a plain message; the reminder comes after a week with something worth keeping', async t => {
  const d = await dir(t);
  await assert.rejects(backupLibrary({ root: d, target: join(d, 'gone'), knowledge: [] }), /U 盘没插上/);
  const now = Date.parse('2026-10-22T00:00:00Z');
  assert.equal(backupDue({ liveCount: 0, sourceFiles: 0, now }), false);
  assert.equal(backupDue({ liveCount: 3, sourceFiles: 0, now }), true, 'never backed up');
  assert.equal(backupDue({ liveCount: 3, sourceFiles: 0, now, lastBackupAt: '2026-10-20T00:00:00Z' }), false);
  assert.equal(backupDue({ liveCount: 3, sourceFiles: 0, now, lastBackupAt: '2026-10-10T00:00:00Z' }), true);
});
