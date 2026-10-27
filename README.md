# KADAdesk Community · 可扩展 AI 工作台

**一个工作台，按需组合插件。让开发者自用、研究、部署和共同开发更多 AI 业务能力。**

> **真实进度：** 社区版有工作台首页、插件管理、两个可信的本机内置模块：**内容运营**与**基础知识库**。两者可在界面中独立启用或停用；服务端停用后会拒绝对应业务接口。真正的第三方插件包下载/安装/卸载/升级、权限沙箱、完整企业知识库和 AI 回复插件尚未实现，正在分阶段迁移。

[发布与迁移政策](docs/PUBLICATION-POLICY.md) · [整体迁移进度](docs/FULL-SOURCE-MIGRATION.md) · [插件架构](docs/PLUGIN-ARCHITECTURE-V1.md) · [个人许可](LICENSE) · [参与共创](CONTRIBUTING.md)

## AI 经营工作台架构

[查看 V1 架构和社区共创路线](docs/AI-BUSINESS-WORKSPACE-ARCHITECTURE-V1.md)。开发分支首先接入可信本地任务：**已审核知识 → 待人工审核的内容草稿**。它不调用大模型、不连接第三方账号，也不自动发布；正式能力与验收状态以合并后的主分支为准。

## 工作台目前有什么？

| 可用模块 | 实际能做的事 | 暂时不支持 |
| --- | --- | --- |
| 工作台 Core | 内置模块发现、启用/停用、停用后的服务端拒绝、持久化 | 任意插件安装、签名/沙箱、多租户企业管理 |
| 内容运营 Content Ops | 多账号任务、图文素材、逐账号审核、ZIP 素材交接、人工核实 | 自动连接外部平台或自动发布 |
| 基础知识库 Knowledge Lite | 本地录入、人工审核、已审核内容检索、启停/删除、重启恢复 | 复杂文件导入、向量检索、云同步、外部模型自动回复 |

正在将原私有产品中合规且拥有版权的模块逐步迁入公共社区。**私有原仓库继续存在且保持 Private**；公开仓库采用独立 Git 历史，通过全新快照提交安全代码，不镜像或 Fork 原始历史。

## 运行（Windows / macOS 本地开发）

安装 Node.js 22 或 24，然后：

```bash
git clone https://github.com/AIMarshallLee/kadadesk-community.git
cd kadadesk-community
npm ci
npm run dev
```

在本机浏览器打开终端显示的 `http://127.0.0.1:<端口>`。数据默认仅保存于该设备的 `~/.kadadesk-community/`，不会自动同步到别的电脑或手机。

校验：

```bash
node scripts/verify-publication.mjs
npm test
npm run smoke
npm run build
```

本地/云端自动化通过并不表示 Windows、macOS 原生客户端或真实第三方平台账号已通过发布验收。

## 源码公开边界

公开工作台、知识库核心、合理授权的 AI 与经营插件、Plugin SDK 和可验证的测试；**不公开**原始 Git 历史、密钥、客户资料、商业授权/商户签名后台、未获重新分发许可的第三方代码或数据。每个迁出模块须做文件依赖审查和自动秘密检测。

## 个人使用许可与社区共创

**[KADAdesk Personal & Community Source License v0.2](LICENSE)** 为个人非商业 Source-Available 许可，**不是 OSI 标准开源许可证**。个人学习、研究和非商业 Fork/共创免费；**公司或其他组织实际内部使用、部署，以及个人商业经营用途，均需事先获得书面授权**。旧版 v0.1 已经授予的许可不因此追溯失效；参见 [许可历史](docs/LICENSE-HISTORY.md) 和 [商业许可说明](COMMERCIAL-LICENSE.md)。

欢迎提交 Issue、复现测试和插件建议。代码 PR 的版权与未来商用再许可需按 [CONTRIBUTING](CONTRIBUTING.md) 另外确认。

### English

KADAdesk Community is an extensible AI workspace in active development. It currently ships **two trusted bundled modules** (content operations and local reviewed-knowledge search), with persistent enable/disable and server-side enforcement. Independent third-party plugin installation, enterprise multi-tenant access control, and official channel publishing are **not yet implemented**. Source is available for **personal noncommercial use** under LICENSE v0.2; company use requires written permission.

Copyright (c) 2026 AIMarshallLee and respective contributors.
