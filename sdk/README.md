# KADAdesk Plugin SDK

面向插件开发者的工具集。**当前宿主只运行源码内置的可信插件**（见 `server/plugin-host.ts` 信任清单）；插件包的动态安装、签名校验、沙箱与权限代理按 [插件架构 V1](../docs/PLUGIN-ARCHITECTURE-V1.md) 分阶段实现，本 SDK 先行提供开发期可用的清单契约与校验。

## 现有内容

| 模块 | 作用 |
| --- | --- |
| [`plugin-manifest.ts`](./plugin-manifest.ts) | 插件清单 V1 类型与校验器（对应架构文档第五节提案）；聚合返回全部错误，适合打包工具一次性展示 |
| [`abortable-delay.ts`](./abortable-delay.ts) | 可中断的延时等待，配合运行令牌使用 |

## 清单契约要点

- `schemaVersion` 固定为 `1`；`id` 为倒序域名风格（`com.组织.插件名`），与宿主信任清单一致。
- `version` / `minHostVersion` 为语义化版本。
- `permissions` 形如 `workspace:knowledge.read`、`local-data:content-ops`：**只声明业务能力域，不代表已获得宿主授权**；宿主闸门（Capability Broker）落地前，内置插件的权限仍以 `server/plugin-host.ts` 源码清单为准。
- `uiEntry` / `runtimeEntry` 必须是插件包内相对 `.js` 路径，禁止绝对路径与 `..`。
- `publisher` / `sha256` 由打包与签名工具在发布时填写；开发期可留空，填写后会被校验格式。

## 用法

```ts
import {validatePluginManifest} from '../sdk/plugin-manifest.ts';

const result = validatePluginManifest(JSON.parse(rawManifest));
if (!result.ok) {
  console.error(result.errors.join('\n')); // 聚合错误，一次看全
} else {
  console.log('清单合法：', result.manifest.id);
}
```

可运行示例见 [`examples/plugins/hello-world`](../examples/plugins/hello-world/manifest.json)；完整校验路径在 `server/sdk-manifest.test.ts` 中由 `npm test` 覆盖。

## 边界（不要这样用）

- 通过校验 ≠ 宿主会安装或执行该插件。**不要把"清单合法"当成安装许可**；动态安装与沙箱未实现前，任何新能力仍须先进入源码信任清单并走发布审查（见 [发布与迁移政策](../docs/PUBLICATION-POLICY.md)）。
- 本 SDK 不含网络、模型或文件访问能力；这些在架构文档中属于宿主 Capability Broker 的授权范围。
