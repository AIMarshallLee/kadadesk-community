import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLoginItem } from './login-item';

async function setup(t: any, packaged = true, platform = 'darwin') {
  const dir = await mkdtemp(join(tmpdir(), 'kada-login-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const sys = { on: false, sets: 0 };
  const make = () => createLoginItem({ file: join(dir, 'login-item.json'), packaged, platform, get: () => sys.on, set: on => { sys.on = on; sys.sets++; } });
  return { sys, make };
}
test('an installed copy turns 开机自动打开 on once, and the owner turning it off sticks', async t => {
  const { sys, make } = await setup(t);
  await make().ensureDefault(); assert.equal(sys.on, true); assert.deepEqual(make().state(), { supported: true, on: true });
  await make().setOn(false); assert.equal(sys.on, false);
  await make().ensureDefault(); assert.equal(sys.on, false, 'never turned back on after the owner said no'); assert.equal(sys.sets, 2);
});
test('development builds and other systems are left alone', async t => {
  for (const [packaged, platform] of [[false, 'darwin'], [true, 'linux']] as const) {
    const { sys, make } = await setup(t, packaged, platform);
    await make().ensureDefault(); assert.equal(sys.sets, 0); assert.deepEqual(make().state(), { supported: false, on: false });
    assert.deepEqual(await make().setOn(true), { supported: false, on: false }); assert.equal(sys.sets, 0);
  }
});
