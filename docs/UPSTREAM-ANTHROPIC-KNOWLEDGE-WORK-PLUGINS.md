# Anthropic Knowledge Work Plugins — 上游组件引入记录

本目录记录咔哒社区版对 Anthropic [knowledge-work-plugins](https://github.com/anthropics/knowledge-work-plugins) 的**源码级引用**，并不代表已安装、启用、测试或交付其技能。

## 引入方式

- 上游仓库：https://github.com/anthropics/knowledge-work-plugins
- 固定提交：`d9d8e1331e45e87e36792040e840da4fc6260b4b`（引入时的 main HEAD；未来升级必须创建单独 PR）
- 目录：`vendor/anthropic-knowledge-work-plugins`
- Git 子模块：`git submodule update --init vendor/anthropic-knowledge-work-plugins`
- 根许可证：Apache-2.0。保留 LICENSE/NOTICE（如有）、原始版权和修改说明；子目录、第三方依赖、MCP 服务与云端账户单独审核。Apache-2.0 **不意味着外部 SaaS/API 免费或具有无限访问权**。
- 仓库无法直接 Fork 时，以子模块替代源码复制，避免混合历史并方便比较升级。它**不是用户账号下的 GitHub Fork**。

## 什么已经实现

1. 整仓通过固定 SHA Gitlink 被引用；Git checkout 默认不会执行子模块源码。
2. 在 `integrations/anthropic-knowledge-work-plugins/catalog.json` 记录优先技能的原始路径与拟接入领域。
3. 公开仓库安全检查验证：只有固定路径、URL 和提交 SHA 的此子模块可存在；**不会扫描子模块内部文件**。代码/许可/敏感数据审计仍要在每次真正使用具体技能前单独进行。

## 尚未实现

- 未将 Claude Skills 转换为咔哒可执行插件；没有一键安装、任务路由或模型运行时绑定。
- 未接 MCP 认证、CRM、企业微信、SEO 写站或内容平台发布，未进行任何第三方外发。
- 未承诺整个上游仓库的内容、媒体、模板和 partner-built 子目录都能直接商用。
- 现有咔哒 `server/task-runner.ts` 仍是本机受控任务样板，非通用技能执行沙箱。

## 逐步适配的技术约定

- **发现层**：以技能来源、版本、用途、输入、输出和审批要求登记清单，不加载任意上游脚本。
- **适配层**：为每个选中技能编写独立、可测试的 `SkillAdapter`，把文件/模型/网络/数据操作映射到咔哒 Core 受控接口。
- **执行层**：执行前检查实际授权（用户、企业、渠道、数据范围），未经授权只产生草稿/建议。网页、文档和工单文字都是不可信输入。
- **结果层**：生成业务对象（内容草稿、线索、跟进任务、审计结果、工单），记录来源、状态、人工确认与错误处理，拒绝未经核准的外发。
- **产品层**：商家只看得懂的业务任务，不向客户暴露 Claude 命令、第三方 API Key 和底层编程复杂度。

## 首批开发次序

1. P0：smb-router → 咔哒任务路由与业务意图模板（只产出结构化计划，不自动执行）。
2. P0：seo-ai-visibility → 公开网站只读 SEO/GEO 检查结果，禁止未经授权直接改站。
3. P1：social-content-engine → 内容运营的待审核草稿，接现有 content-ops。
4. P1：speed-to-lead / lead-triage → 模拟线索 + CRM 跟进任务。
5. P1：ticket-triage → 工单分类与人工客服建议草稿。

**准入门槛**：选中具体技能 → 明确上游版本/文件与许可 → 审查工具调用和外部访问 → 用虚构数据完成成功/失败测试 → 对接 Core 权限/日志 → 真实客户授权测试 → 才标记可用。

企业微信官方连接器由商业版按授权独立实现，不从此仓库推断任何渠道权限。
