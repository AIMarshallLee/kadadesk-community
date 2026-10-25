import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppIcon } from './app-icon';
import { MASCOT_ICONS, mascotIconFile } from '../shared/mascot-icons';

test('every mascot option ships its image', () => {
  for (const m of MASCOT_ICONS) { const f = mascotIconFile(m.id); if (f) assert.ok(existsSync(join('public', f)), f); }
  assert.equal(new Set(MASCOT_ICONS.map(m => m.id)).size, MASCOT_ICONS.length);
  assert.equal(MASCOT_ICONS.length, 11);
});

test('picked icon is applied, remembered and re-applied at the next start', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kada-icon-')), pref = join(dir, 'app-icon.json'), applied: Array<string | undefined> = [];
  const icon = createAppIcon({ preferencePath: pref, publicRoot: '/app/dist', apply: f => applied.push(f) });
  assert.equal(await icon.load(), 'default'); assert.deepEqual(applied, [], 'the shipped icon needs no change');
  await icon.set('tech'); assert.equal(applied.at(-1), join('/app/dist', 'mascots', 'kada-03.png'));
  assert.equal(JSON.parse(await readFile(pref, 'utf8')).icon, 'tech');
  const next: Array<string | undefined> = [];
  assert.equal(await createAppIcon({ preferencePath: pref, publicRoot: '/app/dist', apply: f => next.push(f) }).load(), 'tech');
  assert.deepEqual(next, [join('/app/dist', 'mascots', 'kada-03.png')]);
  await icon.set('default'); assert.equal(applied.at(-1), undefined, 'default restores the bundle icon');
  await assert.rejects(icon.set('../../etc/passwd'), /没有这个图标款式/);
  await writeFile(pref, '{broken');
  assert.equal(await createAppIcon({ preferencePath: pref, publicRoot: '/x', apply: () => {} }).load(), 'default');
});

test('an apply failure does not break the setting', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kada-icon-'));
  const icon = createAppIcon({ preferencePath: join(dir, 'p.json'), publicRoot: '/x', apply: () => { throw Error('dock unavailable'); } });
  assert.equal(await icon.set('happy'), 'happy');
});
