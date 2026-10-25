# KADAdesk Community (咔哒社区版)

> **Your Knowledge. Your Workflows. An Open AI Copilot for Your Desktop.**
> **把业务知识变成生产力：开源、自托管的桌面智能工作台。**

[![License](https://img.shields.io/badge/License-KADAdesk--Community--1.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue.svg)](https://www.typescriptlang.org/)

[English](#english-overview) | [简体中文](#功能概览) | [Commercial Licensing](COMMERCIAL-LICENSE.md) | [Development](CONTRIBUTING.md)

---

## 简体中文

### 项目定位
KADAdesk Community 是一个面向个人创作者、中小团队及企业自用场景的**开源桌面智能工作台核心**。它将本地企业知识库、AI 辅助回复、客户跟进清单和开放协议（MCP）整合到统一的本地应用中。

社区版坚持**隐私优先、完全本地化、自带模型端点（BYOK）**的设计哲学：
- 🚫 **无内置云端密钥与后门**：用户完全掌控自己的 API Key，直连各大主流大语言模型服务商。
- 🚫 **无灰色自动化外挂**：不包含任何破解第三方聊天软件协议的私有外挂代码，回复草稿仅供人工确认与一键复制。
- 🛡️ **安全沙箱与敏感词护栏**：内置本地敏感信息识别护栏，防止凭证与隐私数据无意泄露给大模型。

### 核心功能

1. **企业级轻量知识库 (Knowledge Base)**
   - 支持本地文件、文件夹、ZIP 压缩包及外部链接导入。
   - 解析常见文本与文档格式（Markdown, TXT, PDF, DOCX, XLSX, CSV, JSON 等）。
   - 知识候选审核流与自动同步知识源。
   - 知识库本地备份与恢复。

2. **桌面工作台与多模型预设 (Desktop Workspace & BYOK)**
   - 现代化桌面侧边栏与独立工作台交互，内置小紫怪与专业主题。
   - 自带模型端点预设（OpenAI, SiliconFlow, 深度求索, 智谱 AI, 月之暗面, 零一万物, 阿里云百炼等）。
   - 智能路由与试答草稿辅助。

3. **客户档案与跟进清单 (Customer Profiles)**
   - 本地轻量化客户标签、跟进记录与分组管理。
   - 基于知识库智能生成人工跟进草稿，支持一键复制到剪贴板。

4. **开放协议集成 (Model Context Protocol / MCP)**
   - 开放式 MCP 标准接口，支持作为外部 Agent 的本地知识与任务执行上下文提供方。

---

## English Overview

KADAdesk Community is an open-source, self-hosted desktop AI copilot core. It combines local knowledge retrieval, context-aware reply drafting, customer records, and Model Context Protocol (MCP) tooling in an extensible desktop application.

### Key Highlights
- **Bring Your Own Keys (BYOK):** No bundled proprietary keys or proxy servers. Connect directly to standard model providers with full transparency.
- **Privacy & Safety First:** Runs locally with secret guards to prevent sensitive credentials and personal data from being transmitted to model providers.
- **Curated Knowledge Retrieval:** Ingest PDFs, Office documents, spreadsheets, and Markdown with candidate review and source-linking workflows.
- **Safe Interaction Model:** Designed for human-in-the-loop workflows; generates reviewable drafts without unauthorized platform automation.

---

## 快速上手 (Getting Started)

### 环境依赖 (Prerequisites)
- **Node.js**: >= 20.0.0 (推荐 Node.js 22 LTS)
- **npm**: >= 10.0.0

### 安装与运行 (Setup & Run)

```bash
# 1. 克隆代码仓库
git clone https://github.com/AIMarshallLee/kadadesk-community.git
cd kadadesk-community

# 2. 安装依赖项
npm ci

# 3. 运行本地自动化测试套件
npm test

# 4. 启动本地前端与轻量服务开发模式
npm run dev

# 5. 构建生产产物
npm run build
```

---

## 许可证与商业支持 (License & Support)

- **社区开源许可：** 本项目遵循 [KADAdesk Community License v1.0](LICENSE)（基于 Apache 2.0，附加防 SaaS 倒卖、保留版权与标识、无商标授权及贡献回流条款）。
- **企业自用：** 企业与团队内部自用完全免费，无需签署额外协议。
- **商业授权与合作：** 针对多租户托管、商业贴牌、专属通信渠道插件定制等场景，请参阅 [商业授权指南](COMMERCIAL-LICENSE.md) 或访问 [https://kunlungrowth.com](https://kunlungrowth.com)。
