# 宿主适配器示例（Plugin Route Dispatcher）

把 `server/index.ts` 中真实的插件路由接线模式提炼成一个可复用、可测试的小件：**插件管理接口 + 业务模块启停闸门 + 统一错误映射**。

## 它解决什么

工作台每新增一个内置模块（如未来的 CRM、AI 回复辅助），服务端都要重复同一套接线：`/plugins` 交给 plugin-host、业务前缀先 `requireEnabled` 再转发、`ApiError` 映射状态码、未知前缀 404、不支持方法 405。本示例把这套约定固化成 [`plugin-routes.ts`](./plugin-routes.ts)，新增模块时只需要声明：

```ts
import {createPluginRouteDispatcher} from '../examples/host-adapter/plugin-routes.ts';

const dispatcher = await createPluginRouteDispatcher(dataDir, [
  {
    pluginId: 'com.kadadesk.knowledge',   // 必须是信任清单中的插件 id
    prefix: '/knowledge',                 // 该模块的 API 前缀
    handle: (method, path, body) => knowledge.handle(method, path, body),
  },
]);

const {status, body} = await dispatcher.dispatch('POST', '/knowledge/search', {q: '发票'});
```

## 明确不做什么

- **不是插件加载器**：`pluginId` 必须命中 `server/plugin-host.ts` 源码信任清单，任何"传入一个新插件就运行它"的能力都不存在；
- 不含鉴权令牌、本机来源校验、CSP 等 HTTP 层安全——那些属于 `server/index.ts` 的本地服务器职责，示例只覆盖插件路由这一层；
- 不实现动态安装、签名、沙箱（见 [插件架构 V1](../../docs/PLUGIN-ARCHITECTURE-V1.md) 第六节后的路线）。

## 测试

`server/host-adapter.test.ts` 覆盖：插件列表直通、启停闸门（停用后 409 且业务代码不执行）、业务 `ApiError` 状态码保持、404/405、停用状态跨实例持久化、非法前缀创建期拒绝。运行 `npm test` 即可。
