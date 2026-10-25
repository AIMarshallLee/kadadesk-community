import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTipStore } from './ui-tips';
import { createService } from './service';

const dir = async (t: test.TestContext) => { const d = await mkdtemp(join(tmpdir(), 'kada-tips-')); t.after(() => rm(d, { recursive: true, force: true })); return d; };

test('「不再提醒」 is kept on disk and survives a restart; restore and reset bring tips back', async t => {
  const file = join(await dir(t), 'nested', 'ui-tips.json');
  const store = createTipStore(file);
  assert.deepEqual(await store.list(), []);
  await Promise.all([store.dismiss('reception-mouse'), store.dismiss('emergency-stop'), store.dismiss('reception-mouse')]);
  assert.deepEqual(await createTipStore(file).list(), ['reception-mouse', 'emergency-stop'], 'two quick clicks are both kept, no duplicates');
  await store.restore('reception-mouse');
  assert.deepEqual(await createTipStore(file).list(), ['emergency-stop']);
  await store.reset();
  assert.deepEqual(await createTipStore(file).list(), []);
  await assert.rejects(store.dismiss('Not A Key'), /提示名称无效/);
  await assert.rejects(store.dismiss(undefined), /提示名称无效/);
});

test('a damaged tips file reads as empty instead of breaking the app', async t => {
  const file = join(await dir(t), 'ui-tips.json');
  await writeFile(file, '{not json', 'utf8');
  assert.deepEqual(await createTipStore(file).list(), []);
  await writeFile(file, JSON.stringify({ dismissed: ['ok-key', '../x', 7] }), 'utf8');
  assert.deepEqual(await createTipStore(file).list(), ['ok-key']);
});

test('GET/PUT /tips go through the service, stay out of backups and survive a restored backup', async t => {
  const dataDir = await dir(t);
  let service = await createService({ dataDir });
  const call = (method: string, path: string, body?: unknown) => service.request({ method: method as 'GET', path, body }) as Promise<any>;
  assert.deepEqual((await call('GET', '/tips')).dismissed, []);
  assert.deepEqual((await call('PUT', '/tips', { dismiss: 'confirm-auto-mode' })).dismissed, ['confirm-auto-mode']);
  await assert.rejects(call('PUT', '/tips', { dismiss: 'bad key' }), /提示名称无效/);
  const backup = await call('GET', '/export');
  assert.doesNotMatch(JSON.stringify(backup), /confirm-auto-mode/, 'tips are not part of the workspace backup');
  const events = (await call('GET', '/state')).events.length;
  await call('PUT', '/tips', { dismiss: 'reception-mouse' });
  assert.equal((await call('GET', '/state')).events.length, events, 'a click on 「不再提醒」 writes no audit event');
  await call('POST', '/import', { data: backup });
  assert.deepEqual((await call('GET', '/tips')).dismissed, ['confirm-auto-mode', 'reception-mouse']);
  await service.close();
  service = await createService({ dataDir });
  t.after(() => service.close());
  assert.deepEqual((await call('GET', '/tips')).dismissed, ['confirm-auto-mode', 'reception-mouse'], 'kept after the app restarts');
  assert.deepEqual((await call('PUT', '/tips', { restore: 'reception-mouse' })).dismissed, ['confirm-auto-mode']);
  assert.deepEqual((await call('PUT', '/tips', { reset: true })).dismissed, []);
  assert.deepEqual(JSON.parse(await readFile(join(dataDir, 'ui-tips.json'), 'utf8')), { dismissed: [] });
});
