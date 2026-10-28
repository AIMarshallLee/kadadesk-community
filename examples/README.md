# 插件示例目录

这里是插件清单与目录结构的**规范示例**，供插件开发者和打包工具参考。

## hello-world

[`hello-world/manifest.json`](./hello-world/manifest.json) 是一份通过 `sdk/plugin-manifest.ts` 完整校验的最小清单，展示了全部字段（含发布期才填写的 `publisher` / `sha256`）。

**注意：宿主当前不支持安装任何插件包。** 本目录中的文件仅用于说明清单格式，不会也不应被工作台加载执行；新增内置能力仍须按 [发布与迁移政策](../../docs/PUBLICATION-POLICY.md) 走源码审查进入信任清单。

校验方式：

```bash
npm test        # server/sdk-manifest.test.ts 会对示例清单跑完整校验
```
