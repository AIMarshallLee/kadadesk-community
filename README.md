# KADAdesk Community · 可扩展 AI 工作台

**一个工作台，按需组合插件。帮助不同类型的客户解决不同业务问题。**

KADAdesk / 咔哒的长期定位是 **Extensible AI Workspace（可扩展 AI 工作台）**，不是固定的 AI 客服工具，也不是图文内容发布工具。核心负责统一工作区、能力接口、权限、安全、数据及插件生命周期；知识库、AI 回复辅助、内容运营、客户跟进等都是可以组合的业务模块。

> **当前真实进度：** 这是早期社区版，目前只有一个**内置的内容运营示例模块**。已经支持该模块的启用、停用和本地持久化，后端停用后也拒绝业务 API。**独立下载安装/卸载第三方插件、权限沙箱、插件市场、完整知识库与 AI 回复插件尚未实现。** 请勿把架构规划理解为已交付功能。

[插件架构与路线](docs/PLUGIN-ARCHITECTURE-V1.md) · [内容运营示例使用方法](docs/USER-GUIDE.zh-CN.md) · [源码许可](LICENSE) · [参与共创](CONTRIBUTING.md)

## 目标架构

```text
KADAdesk Workspace Core
├── Shell：统一入口、工作区、通知与设置
├── Plugin Manager：发现 / 安装 / 启用 / 停用 / 更新 / 卸载
├── Plugin SDK & Capability Broker：权限、依赖、生命周期和日志
├── 数据与模型能力：租户隔离、模型适配、知识服务
└── 业务能力插件（逐步交付）
    ├── 内容运营 · 当前内置示例，启停可用
    ├── 知识库 · 待从既有产品拆分
    ├── AI 回复辅助 · 待从既有产品拆分
    ├── 客户跟进 · 规划
    ├── 社群运营 · 规划
    └── 官方渠道连接器 / 行业插件 · 按授权与客户需求
```

模块之间必须有明确的数据与权限边界。AI 回复负责生成建议和人工审核；特定平台的自动收发必须另经官方接口授权，不会因为软件改叫“工作台”就自动合规。

## 当前能运行的版本

- 一套本机 Web 工作台，包含**工作台首页、插件管理页、内容运营示例**。
- 内容运营样例支持图文素材保存、多个账号独立任务、专属文案、人工审核和 ZIP 素材包交接。
- 操作员在目标平台官方客户端手动发布，再回来登记结果；未确认结果不允许随意重发。
- 可从插件管理中**启用/停用内置内容运营模块**；停用后业务 API 拒绝调用，原有资料保留。

这不是第三方任意插件安装器，不执行外部下载的程序代码，也没有自动调用某个平台的发布接口。

## 运行

要求 Node.js 22/24、npm：

```bash
git clone https://github.com/AIMarshallLee/kadadesk-community.git
cd kadadesk-community
npm ci
npm run dev
```

打开终端显示的本机地址（如 `http://127.0.0.1:<端口>`）；数据保存于 `~/.kadadesk-community/`，其他设备不自动同步。

```bash
npm test
npm run smoke
npm run build
```

**开发路线**：先做安全可信的 Core 与插件 SDK，再拆分已有知识库和 AI 回复辅助，最后在签名、沙箱、版本依赖和回滚验收通过后提供独立插件包的下载安装与升级。具体设计与验证清单见 [插件架构 V1](docs/PLUGIN-ARCHITECTURE-V1.md)。

## 社区与商业许可

欢迎参与架构方案、插件开发、测试与客户场景共创。阅读 [CONTRIBUTING.md](CONTRIBUTING.md)、[SECURITY.md](SECURITY.md)、[源码审计](docs/EXTRACTION-AUDIT.md)。

项目按 [KADAdesk Community Source License v0.1](LICENSE) **Source-Available** 许可公开，并非 OSI 标准开源。符合约定的自用和研究免费；软件再售、贴牌、收费 SaaS 或向第三方收费提供本软件的运营服务，须取得单独商业授权。[商业许可范围](COMMERCIAL-LICENSE.md)。

### English

**KADAdesk Community — an extensible AI workspace in development.** This project currently ships a local workspace shell and **one trusted, bundled content-operations example with persistent enable/disable controls**, not an installable third-party plugin ecosystem. Planned modules include knowledge management, AI-assisted replies, customer operations and authorized channel integrations. Third-party installation, plugin sandboxing and dynamic loading are **not yet implemented**. Source-available, not OSI open source; see [LICENSE](LICENSE).

Copyright (c) 2026 AIMarshallLee and relevant contributors.
