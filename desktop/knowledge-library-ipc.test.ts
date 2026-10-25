import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupSuggestions, createKnowledgeLibrary } from './knowledge-library-ipc';
import { BACKUP_FOLDER } from '../server/knowledge-backup';

async function setup(t: any) {
  const d = await mkdtemp(join(tmpdir(), 'kada-libipc-')); t.after(() => rm(d, { recursive: true, force: true }));
  let clock = Date.parse('2026-10-22T02:00:00Z'); const usb = join(d, 'usb'); await mkdir(usb);
  const knowledge = [{ id: 'a', title: '价格', content: '68 元', tags: [], enabled: true, reviewStatus: 'approved', createdAt: '', updatedAt: '2026-10-22T00:00:00Z' }];
  const lib = createKnowledgeLibrary({ settingsFile: join(d, 'settings.json'), documentsDir: d, homeDir: d, now: () => clock, addFolder: async () => undefined,
    request: async r => r.path === '/state' ? { knowledge } : { sources: [] } });
  return { d, usb, lib, tick: (ms: number) => { clock += ms; } };
}
test('choosing a backup place backs up at once; then once a day while the place is there', async t => {
  const { d, usb, lib, tick } = await setup(t);
  await lib.create(join(d, '咔哒资料库'));
  assert.equal((await lib.status()).backup.due, true, 'knowledge in use and never backed up: reminded');
  const s = await lib.setBackupDir(usb); assert.equal(s.backup.error, undefined); assert.ok(s.backup.lastAt); assert.equal(s.backup.due, false);
  assert.equal((await readdir(join(usb, BACKUP_FOLDER))).length, 1);
  tick(3600000); await lib.autoBackup(); assert.equal((await lib.status()).backup.lastAt, s.backup.lastAt, 'not again within the day');
  tick(24 * 3600000); await lib.autoBackup(); assert.notEqual((await lib.status()).backup.lastAt, s.backup.lastAt);
  assert.equal((await readdir(join(usb, BACKUP_FOLDER))).length, 2);
});
test('an unplugged stick is skipped quietly by the daily run and explained on 「现在备份」', async t => {
  const { d, lib, tick } = await setup(t);
  await lib.create(join(d, '咔哒资料库')); const gone = join(d, 'stick');
  await mkdir(gone); await lib.setBackupDir(gone); await rm(gone, { recursive: true });
  tick(2 * 86400000); await lib.autoBackup(); assert.equal((await lib.status()).backup.error, undefined, 'the daily run waits for the stick');
  const now = await lib.backup(); assert.equal(now.backup.error, true); assert.match(now.backup.result ?? '', /U 盘没插上/);
});
test('cloud-drive sync folders found at home are offered', async t => {
  const d = await mkdtemp(join(tmpdir(), 'kada-home-')); t.after(() => rm(d, { recursive: true, force: true }));
  await mkdir(join(d, '坚果云')); await mkdir(join(d, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'), { recursive: true });
  const found = await backupSuggestions(d, 'linux');
  assert.deepEqual(found.map(f => f.label).sort(), ['iCloud 云盘', '坚果云'].sort());
});
