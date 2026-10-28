import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPluginRouteDispatcher, BusinessModule} from '../examples/host-adapter/plugin-routes.ts';
import {ApiError} from './autopilot.ts';

const demoModule: BusinessModule = {
  pluginId: 'com.kadadesk.knowledge',
  prefix: '/knowledge',
  handle: async (method, path, body) => ({method, path, echo: body}),
};

const strictModule: BusinessModule = {
  pluginId: 'com.kadadesk.content-ops',
  prefix: '/moments',
  handle: async () => {
    throw new ApiError(422, '业务参数不合法');
  },
};

test('适配器完整走通插件管理 + 启停闸门 + 错误映射', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kada-host-adapter-'));
  try {
    const d = await createPluginRouteDispatcher(dir, [demoModule, strictModule]);

    // 1. 插件管理接口直通 pluginHost.handle
    const list = await d.dispatch('GET', '/plugins');
    assert.equal(list.status, 200);
    assert.equal((list.body as {id: string}[]).length, 2);

    // 2. 启用状态下业务前缀正常放行
    const ok = await d.dispatch('POST', '/knowledge/search', {q: '发票'});
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body, {method: 'POST', path: '/knowledge/search', echo: {q: '发票'}});

    // 3. 停用后同一接口统一 409，业务代码不再执行
    await d.dispatch('POST', '/plugins/com.kadadesk.knowledge/disable');
    const blocked = await d.dispatch('POST', '/knowledge/search', {q: '发票'});
    assert.equal(blocked.status, 409);
    assert.match((blocked.body as {error: string}).error, /已停用/);
    await d.dispatch('POST', '/plugins/com.kadadesk.knowledge/enable');

    // 4. 业务模块自身抛出的 ApiError 保持原状态码
    const biz = await d.dispatch('POST', '/moments/campaigns', {});
    assert.equal(biz.status, 422);

    // 5. 未知前缀 404；不支持的方法 405
    assert.equal((await d.dispatch('GET', '/unknown/x')).status, 404);
    assert.equal((await d.dispatch('DELETE', '/knowledge')).status, 405);

    // 6. requireEnabled 暴露给调用方复用；启用状态下不应抛错
    assert.doesNotThrow(() => d.requireEnabled('com.kadadesk.knowledge'));
    await d.dispatch('POST', '/plugins/com.kadadesk.knowledge/disable');
    assert.throws(() => d.requireEnabled('com.kadadesk.knowledge'), /已停用/);
    await d.dispatch('POST', '/plugins/com.kadadesk.knowledge/enable');
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test('业务模块在插件停用前注册不报错，停用后仍保持拒答', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kada-host-adapter-2-'));
  try {
    const d = await createPluginRouteDispatcher(dir, [demoModule]);
    await d.dispatch('POST', '/plugins/com.kadadesk.knowledge/disable');
    const r = await d.dispatch('GET', '/knowledge');
    assert.equal(r.status, 409);
    // 状态持久化：重建适配器后仍是停用（复用 plugin-host 的持久化语义）
    const d2 = await createPluginRouteDispatcher(dir, [demoModule]);
    assert.equal((await d2.dispatch('GET', '/knowledge')).status, 409);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test('非法前缀在创建期即拒绝', async () => {
  await assert.rejects(
    createPluginRouteDispatcher('/tmp/unused-adapter', [{pluginId: 'x', prefix: 'knowledge', handle: async () => ({})}]),
    /前缀/,
  );
  await assert.rejects(
    createPluginRouteDispatcher('/tmp/unused-adapter', [{pluginId: 'x', prefix: '/knowledge/', handle: async () => ({})}]),
    /前缀/,
  );
});
