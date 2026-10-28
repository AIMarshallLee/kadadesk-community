import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {validatePluginManifest} from '../sdk/plugin-manifest.ts';

const exampleDir = join(import.meta.dirname, '..', 'examples', 'plugins', 'hello-world');

test('示例插件清单通过完整校验', async () => {
  const raw = JSON.parse(await readFile(join(exampleDir, 'manifest.json'), 'utf8'));
  const result = validatePluginManifest(raw);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.manifest.id, 'com.example.hello-world');
    assert.deepEqual(result.manifest.platforms, ['windows', 'macos', 'server']);
  }
});

test('非法清单被逐条拒绝且聚合报错', () => {
  const result = validatePluginManifest({
    schemaVersion: 2,
    id: 'kadadesk-bad',
    name: '',
    version: '1.0',
    minHostVersion: '0.2.0',
    platforms: ['android'],
    permissions: ['ALL'],
    dependencies: ['com.duplicate.id', 'com.duplicate.id'],
    uiEntry: '/abs/path.js',
    runtimeEntry: '../escape.js',
    sha256: 'not-a-hash',
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    const text = result.errors.join('\n');
    for (const expect of [
      'schemaVersion',
      'id 必须',
      'name 必须',
      'version 必须',
      'platforms 必须',
      'permissions 必须',
      'uiEntry',
      'runtimeEntry',
      'sha256',
    ]) assert.ok(text.includes(expect), `错误信息应包含「${expect}」：${text}`);
    assert.ok(result.errors.length >= 8, `应聚合多条错误，实际 ${result.errors.length}`);
  }
});

test('dependencies 不允许包含自身', () => {
  const result = validatePluginManifest({
    schemaVersion: 1,
    id: 'com.example.self-dep',
    name: '自依赖',
    version: '0.1.0',
    minHostVersion: '0.2.0',
    platforms: ['server'],
    permissions: ['workspace:self.read'],
    dependencies: ['com.example.self-dep'],
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some(e => e.includes('自身')));
});

test('非对象输入直接拒绝', () => {
  assert.equal(validatePluginManifest(null).ok, false);
  assert.equal(validatePluginManifest([1, 2]).ok, false);
  assert.equal(validatePluginManifest('manifest').ok, false);
});

test('publisher 与 sha256 留空时校验通过（发布前由签名工具填写）', () => {
  const result = validatePluginManifest({
    schemaVersion: 1,
    id: 'com.example.minimal',
    name: '最小清单',
    version: '0.1.0',
    minHostVersion: '0.2.0',
    platforms: ['server'],
    permissions: ['workspace:minimal.read'],
    dependencies: [],
  });
  assert.equal(result.ok, true);
});
