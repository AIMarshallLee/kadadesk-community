import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURES, FEATURE_IDS, featureById, searchFeatures } from './feature-index';

// Routes App.tsx's getRoute() keeps as they are.
const ROUTES = /^(setup|manual|open|plugins|customers|knowledge(\/[a-z-]+)?|settings(\/[a-z-]+)?|tasks|workflows|audit|app)$/;

test('every entry has a unique id, a route App understands, and plain words', () => {
  assert.equal(FEATURE_IDS.size, FEATURES.length, 'ids are unique');
  for (const f of FEATURES) {
    assert.match(f.id, /^[a-z][a-z0-9.-]*$/, f.id);
    assert.match(f.route, ROUTES, `${f.id} route ${f.route}`);
    assert.ok(f.label.trim() && f.where.trim() && f.summary.trim(), f.id);
    assert.ok(f.keywords.length > 0, `${f.id} has synonyms`);
    const forbiddenPlatform = new RegExp(['微', '信'].join('') + '|wechat|weixin|whatsapp', 'i');
    assert.ok(!forbiddenPlatform.test(f.label + f.where + f.summary), `${f.id} copy names no chat platform`);
  }
});

test('the settings sections Workspace.tsx renders by id are indexed', () => {
  for (const id of ['backup-model-settings', 'model-pool-settings', 'reply-model-settings']) {
    assert.ok(FEATURES.some(f => f.target === id), id);
  }
});

const expect: Array<[string, string]> = [
  ['限流', 'settings.backup-model'],
  ['模型挂了', 'settings.backup-model'],
  ['换模型', 'settings.backup-model'],
  ['换颜色', 'settings.theme'],
  ['皮肤', 'settings.theme'],
  ['主题', 'settings.theme'],
  ['小浮窗', 'settings.display-mode'],
  ['求助包', 'help.diagnostics'],
  ['飞书', 'knowledge.connections'],
  ['私有仓库', 'knowledge.repos'],
  ['GitHub 仓库自动更新', 'knowledge.repos'],
  ['知识包', 'knowledge.pack'],
  ['快捷键', 'settings.shortcuts'],
  ['怎么换个颜色', 'settings.theme'],
  ['API Key', 'settings.model'],
  ['备用模型', 'settings.backup-model'],
  ['使用手册', 'help.manual'],
  ['说明书', 'help.manual'],
  ['客户档案', 'customers'],
  ['跟进清单', 'customers.follow'],
  ['业务线', 'customers.lines'],
];

test('plain words find the expected entry near the top', () => {
  assert.ok(expect.length >= 15);
  for (const [query, id] of expect) {
    const hits = searchFeatures(query, 3).map(f => f.id);
    assert.ok(hits.includes(id), `${query} → ${id}, got ${hits.join(', ')}`);
  }
});

test('typos and extra words still match; nonsense and empty queries return nothing', () => {
  assert.equal(searchFeatures('主题 色')[0]?.id, 'settings.theme');
  assert.ok(searchFeatures('备用  模型').some(f => f.id === 'settings.backup-model'));
  assert.deepEqual(searchFeatures(''), []);
  assert.deepEqual(searchFeatures('   '), []);
  assert.deepEqual(searchFeatures('zzqxv'), []);
  assert.equal(featureById('settings.theme')?.label, '主题色');
});
