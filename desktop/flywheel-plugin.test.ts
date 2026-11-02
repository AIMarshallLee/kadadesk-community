import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUILTIN_PLUGINS, validateManifest, type PluginsView } from '../shared/plugins';
import { createPluginManager } from './plugins';
import { createEncryptedSecretStore, type StringCipher } from './encrypted-secret-store';
import { FlywheelManager } from './flywheel-connect';
import { harness } from './flywheel-test-kit';

/** A stand-in for safeStorage: reversible, and the plain text never appears in what it returns. */
const fakeCipher = (available = true): StringCipher => ({
  isEncryptionAvailable: () => available,
  encryptString: plain => Buffer.from(`enc:${Buffer.from(plain, 'utf8').toString('hex').split('').reverse().join('')}`, 'utf8'),
  decryptString: buf => { const s = buf.toString('utf8'); if (!s.startsWith('enc:')) throw new Error('bad'); return Buffer.from(s.slice(4).split('').reverse().join(''), 'hex').toString('utf8'); },
});
const KEY = ['fw', 'test', 'key', '7f3a9c'].join('-');
const filesUnder = async (dir: string): Promise<string[]> => {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await filesUnder(p)); else out.push(await readFile(p, 'utf8'));
  }
  return out;
};

test('built-in manifest: parses, rule-less automation only for built-ins, plain permission labels; pasted copies are refused', async t => {
  const m = BUILTIN_PLUGINS.find(x => x.id === 'flywheel-connect')!;
  assert.deepEqual(validateManifest(structuredClone(m)).rules, []);
  assert.throws(() => validateManifest({ id: 'x-plugin', name: 'x', version: '1', author: 'a', description: 'd', kind: 'automation', permissions: ['network.inbound'] }), /不认识的权限/);
  const dir = await mkdtemp(join(tmpdir(), 'kada-fw-plugins-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const manager = await createPluginManager({ directory: dir, request: async () => ({}), notify: () => {} });
  const text = JSON.stringify(m);
  assert.throws(() => manager.preview(text), /只有咔哒内置插件能要/);
  await assert.rejects(manager.install(text, true), /只有咔哒内置插件能要/);
  const ruleless = JSON.stringify({ id: 'my-auto', name: 'x', version: '1', author: 'a', description: 'd', kind: 'automation', permissions: ['notify.owner'] });
  await assert.rejects(manager.install(ruleless, true), /1～50 条规则/);
  await assert.rejects(manager.installBuiltin('flywheel-connect', false), /同意并安装/);
  await assert.rejects(manager.installBuiltin('no-such-plugin', true), /没有这个内置插件/);
});

test('install: built-in only, installed switched OFF, switching and uninstalling reach the flywheel manager through onChange', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'kada-fw-plugins-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const changes: PluginsView[] = [];
  const manager = await createPluginManager({ directory: dir, request: async () => ({}), notify: () => {}, onChange: v => changes.push(v) });
  const fw = new FlywheelManager({ dir: join(dir, 'flywheel'), secrets: createEncryptedSecretStore(join(dir, 'flywheel-secret.json'), fakeCipher()), version: '0.3.0', idle: () => true, noTimer: true });
  await fw.init();
  const follow = (v: PluginsView) => { const p = v.plugins.find(x => x.manifest.id === 'flywheel-connect' && x.builtin); return fw.setPluginState({ installed: !!p, enabled: !!p?.enabled }); };
  const flushChanges = async () => { await new Promise(r => setImmediate(r)); if (changes.length) await follow(changes.at(-1)!); };

  const view = await manager.installBuiltin('flywheel-connect', true);
  const p = view.plugins.find(x => x.manifest.id === 'flywheel-connect')!;
  assert.equal(p.enabled, false); assert.equal(p.builtin, true);
  await flushChanges();
  assert.deepEqual([fw.view().installed, fw.view().pluginEnabled, fw.active], [true, false, false]);
  // A rule editor cannot be used on it, and a pasted plugin cannot replace it.
  await assert.rejects(manager.saveRules('flywheel-connect', [{ id: 'r', when: { type: 'handoff' }, then: [{ type: 'notify' }] }]), /内置插件没有规则/);
  await assert.rejects(manager.install(JSON.stringify({ id: 'flywheel-connect', name: 'x', version: '9', author: 'a', description: 'd', kind: 'content', permissions: ['knowledge.suggest'], content: { knowledge: [{ question: 'q', answer: 'a' }] } }), true), /内置插件/);

  // Switched on without the confirmation card: still inactive.
  await manager.setEnabled('flywheel-connect', true); await flushChanges();
  assert.equal(fw.view().pluginEnabled, true); assert.equal(fw.active, false);
  await fw.confirm(); assert.equal(fw.active, true);
  // The installed built-in survives a restart of the plugin manager (index.json reloaded and re-validated).
  const reloaded = await createPluginManager({ directory: dir, request: async () => ({}), notify: () => {} });
  const back = reloaded.view().plugins.find(x => x.manifest.id === 'flywheel-connect')!;
  assert.deepEqual([back.builtin, back.enabled], [true, true]);
  await fw.saveSettings({ hubUrl: 'https://hub.example.test', apiKey: KEY });
  assert.equal(fw.view().apiKeyConfigured, true);

  // Uninstall: the key, the consent and the outbox are forgotten.
  await manager.uninstall('flywheel-connect'); await flushChanges();
  assert.deepEqual([fw.view().installed, fw.active, fw.view().consented, fw.view().apiKeyConfigured], [false, false, false, false]);
  for (const text of await filesUnder(dir)) assert.ok(!text.includes(KEY), 'no file keeps the key after uninstall');
  fw.dispose();
});

test('the key is never stored or shown in plain text: encrypted store only, the page sees apiKeyConfigured, the first version\'s config.json key is moved out', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'kada-fw-key-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  // The first community version wrote {"enabled":true,"apiKey":"…"} into config.json and read it back to the page.
  await mkdir(join(dir, 'flywheel'), { recursive: true });
  await writeFile(join(dir, 'flywheel', 'config.json'), JSON.stringify({ enabled: true, hubUrl: 'https://hub.example.test', apiKey: KEY, workspaceId: 'default' }));
  const store = createEncryptedSecretStore(join(dir, 'flywheel-secret.json'), fakeCipher());
  const fw = new FlywheelManager({ dir: join(dir, 'flywheel'), secrets: store, version: '0.3.0', idle: () => true, noTimer: true });
  await fw.init();
  const config = await readFile(join(dir, 'flywheel', 'config.json'), 'utf8');
  assert.ok(!config.includes(KEY)); assert.doesNotMatch(config, /apiKey|"enabled"/);
  assert.equal(await store.get(), KEY);
  const view = fw.view();
  assert.equal(view.apiKeyConfigured, true); assert.equal(view.keyStoreAvailable, true);
  assert.ok(!JSON.stringify(view).includes(KEY), 'the view never carries the key');
  assert.equal(view.active, false, 'the old "enabled" flag does not switch anything on');
  for (const text of await filesUnder(dir)) assert.ok(!text.includes(KEY), 'no file on disk holds the key in plain text');
  // A new key goes to the store as well.
  const next = ['fw', 'rotated', 'key', '00aa11'].join('-');
  await fw.saveSettings({ apiKey: next });
  assert.equal(await store.get(), next);
  for (const text of await filesUnder(dir)) assert.ok(!text.includes(next));
  fw.dispose();

  // No encryption on this computer: the key cannot be saved at all (never a plain-text fallback).
  const dir2 = await mkdtemp(join(tmpdir(), 'kada-fw-key-'));
  t.after(() => rm(dir2, { recursive: true, force: true }));
  const fw2 = new FlywheelManager({ dir: join(dir2, 'flywheel'), secrets: createEncryptedSecretStore(join(dir2, 'flywheel-secret.json'), fakeCipher(false)), version: '0.3.0', idle: () => true, noTimer: true });
  await fw2.init();
  assert.equal(fw2.view().keyStoreAvailable, false);
  await assert.rejects(fw2.saveSettings({ apiKey: KEY }), /加密存储/);
  for (const text of await filesUnder(dir2)) assert.ok(!text.includes(KEY));
  fw2.dispose();
});

test('listener dispatch: while the plugin is off no listener runs; profile edits reach the outbox only after it is on and confirmed', async t => {
  const h = await harness(); t.after(() => h.close());
  await h.customers.addProfile('客户甲', 'desk');
  const { findProfile } = await import('../shared/customers');
  const p = findProfile(h.customers._state().store, '客户甲')!;
  await h.manager.setPluginState({ installed: true, enabled: false });
  h.unwire();
  await h.customers.setFact(p.id, 'city', '杭州'); await h.settle();
  assert.equal(h.manager.view().pending, 0);
  await h.manager.setPluginState({ installed: true, enabled: true }); h.wire();
  await h.customers.setFact(p.id, 'city', '宁波'); await h.settle();
  assert.equal(h.manager.view().pending, 1);
  assert.equal(await h.manager.flush(), 1);
  assert.deepEqual(h.hub.received[0]!.payload, { fields: { city: '宁波' }, by: 'human' });
});
