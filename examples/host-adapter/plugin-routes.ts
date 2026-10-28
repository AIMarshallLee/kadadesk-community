/**
 * 宿主适配器示例：把 server/index.ts 里的插件路由接线模式提炼成可复用、可测试的小件。
 *
 * 职责边界（与 PLUGIN-ARCHITECTURE-V1.md 一致）：
 * - 只服务于**源码内置的可信插件**（server/plugin-host.ts 信任清单）；
 * - 业务模块停用后，其全部接口统一 409 拒绝，包括排队中的调用；
 * - 本示例不引入任何动态安装、下载或沙箱逻辑，不要把它当成插件加载器。
 *
 * 与 server/index.ts 的对应关系：
 * - /plugins 列表与 enable/disable → pluginHost.handle()
 * - 业务前缀 → requireEnabled(插件 id) 后再交给该模块自己的 handle()
 * - ApiError → 映射为 {status, body:{error}}，未知前缀 404，不支持的方法 405
 */

import {ApiError} from '../../server/autopilot.ts';
import {createPluginHost, PluginDescriptor} from '../../server/plugin-host.ts';

export type BusinessModule = {
  /** 对应信任清单中的插件 id，如 com.kadadesk.knowledge */
  pluginId: string;
  /** 该模块对外暴露的 API 前缀（不带末尾斜杠），如 /knowledge */
  prefix: string;
  handle(method: string, path: string, body: unknown): Promise<unknown>;
};

export type DispatchResult = {status: number; body: unknown};

export type PluginRouteDispatcher = {
  dispatch(method: string, path: string, body?: unknown): Promise<DispatchResult>;
  listPlugins(): PluginDescriptor[];
  requireEnabled(pluginId: string): void;
};

export async function createPluginRouteDispatcher(
  dataDir: string,
  modules: BusinessModule[],
): Promise<PluginRouteDispatcher> {
  const pluginHost = await createPluginHost(dataDir);
  for (const m of modules) {
    if (!m.prefix.startsWith('/') || m.prefix.endsWith('/')) {
      throw new Error(`业务模块前缀必须以 / 开头且不以 / 结尾：${m.prefix}`);
    }
  }

  async function dispatch(method: string, path: string, body: unknown = {}): Promise<DispatchResult> {
    const m = (method || 'GET').toUpperCase();
    if (!['GET', 'POST', 'PUT'].includes(m)) return {status: 405, body: {error: '不支持该方法'}};

    const isPluginRoute = path === '/plugins' || path.startsWith('/plugins/');
    const matched = modules.find(
      x => path === x.prefix || path.startsWith(x.prefix + '/'),
    );
    if (!isPluginRoute && !matched) return {status: 404, body: {error: '接口不存在'}};

    try {
      if (isPluginRoute) return {status: 200, body: await pluginHost.handle(m, path)};
      // 到这里 matched 一定存在；先做启停闸门，再进业务模块
      pluginHost.requireEnabled(matched!.pluginId);
      return {status: 200, body: await matched!.handle(m, path, body)};
    } catch (e) {
      if (e instanceof ApiError) return {status: e.status, body: {error: e.message}};
      throw e;
    }
  }

  return {
    dispatch,
    listPlugins: () => pluginHost.list(),
    requireEnabled: id => pluginHost.requireEnabled(id),
  };
}
