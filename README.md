# 咔哒 KADAdesk 社区版 · 企业私域的开放 AI 工作台

> 业务知识在本地，AI 草稿随时用。开源、自托管的本地智能工作台核心。

[![License](https://img.shields.io/badge/License-KADAdesk--Community--1.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue.svg)](https://www.typescriptlang.org/)

[功能概览](#功能概览) | [社区版 vs 专业版](#社区版-vs-专业版) | [让你的-ai-给咔哒加功能](#让你的-ai-给咔哒加功能) | [快速上手](#快速上手) | [路线图](#路线图) | [许可证与商业合作](#许可证与商业合作)

---

## 项目定位

咔哒 KADAdesk 社区版是一个面向个人创作者、中小团队及企业自用场景的开源桌面智能工作台。它将本地企业知识库、大模型辅助草稿、客户档案与跟进清单，以及开放协议（MCP）整合到统一的本地应用中。

社区版坚持本地优先、用户掌控、自带模型端点（BYOK）的设计理念：
- 自带模型端点（BYOK）：无任何内置商业密钥或私有中转地址，用户完全掌控自己的 API Key，直连各大主流大语言模型或本地模型。
- 本地优先存储：所有知识资料、客户档案均保存在当前电脑本地，零云端数据收集。
- 安全敏感词护栏：内置本地敏感信息识别护栏（Secret Guard），防止凭证与高危隐私数据泄露。

---

## 核心功能

1. 企业级轻量知识库
   - 支持本地文件、文件夹、ZIP 压缩包及外部链接导入。
   - 解析常见文本与文档格式（Markdown, TXT, PDF, Word, Excel, CSV 等）。
   - 知识候选审核流与自动同步知识源（支持定期自动同步 GitHub 仓库与本地目录）。
   - 知识库本地备份与恢复。

2. 桌面工作台与多模型预设
   - 现代化桌面侧边栏与独立工作台交互，内置小紫怪与专业主题。
   - 自带主流大语言模型服务商配置预设，支持快速验证与一键切换。
   - 智能试答演练与回复草稿辅助。

3. 客户档案与跟进清单
   - 本地轻量化客户标签、阶段流转与分组管理。
   - 基于知识库智能生成人工跟进建议草稿，支持一键复制到剪贴板手动发送。

4. 开放协议集成 (MCP)
   - 开放式 Model Context Protocol 标准接口，只监听本机 loopback 端口。
   - 赋予 Claude、Codex、Cursor、Antigravity 等外部 Agent 检索本地知识与读取工作台上下文的能力。

---

## 社区版 vs 专业版

| 功能模块 | 社区版 (开源) | 专业版 (商业) |
| :--- | :--- | :--- |
| 代码开源属性 | 开源 (KADAdesk Community License) | 专有商业源码授权 / 预编译签名分发 |
| 授权与使用成本 | 免费（自带模型 API Key） | 见官网 |
| 知识库录入与导入 | 支持（文件、文件夹、ZIP、链接） | 支持 |
| 自动更新知识来源 | 支持（GitHub 仓库、本地文件夹） | 支持（含企业网盘与飞书连接器） |
| 试答演练与草稿生成 | 支持（一键复制草稿、手动发送） | 支持 |
| 客户档案与跟进清单 | 支持（本地存储、草稿复制） | 支持（全生命周期跟进看板） |
| 开放 MCP 服务 | 支持（只监听本地） | 支持 |
| 桌面聊天渠道自动化 | 不包含（需手动复制发送） | 内置自动化渠道扩展，支持自动读写回复 |
| 集中多坐席与管理后台 | 不包含 | 支持多端协作与集中管理 |
| 商业部署与技术支持 | 社区 GitHub Issues | 专属技术支持与 SLA 保障 |

更多专业版功能与定制化合作方案，请访问官网：[https://kunlungrowth.com/kadadesk](https://kunlungrowth.com/kadadesk)。

---

## 让你的 AI 给咔哒加功能

咔哒的架构对 AI 编程助手高度友好。代码库根目录维护了详尽的架构指南 `AGENTS.md`。你可以使用 Claude Code、Codex、Cursor 或 Antigravity 直接阅读该文件，快速为咔哒扩展新页面、自定义插件或增加全新数据源。

### 示例 Prompt

将以下提示词提供给你的 AI 编程助手：

```text
请阅读仓库根目录的 AGENTS.md 了解架构设计规范与测试约定。
我想为咔哒工作台添加一个「自定义数据报表」页面：
1. 在 src/ 目录下实现组件并挂载到主路由；
2. 在 shared/feature-index.ts 中注册对应的功能索引；
3. 遵循严格的类型定义与单测覆盖标准，运行 npm test 确保全部通过。
```

---

## 快速上手

### 环境依赖
- Node.js: >= 20.0.0 (推荐 Node.js 22 LTS)
- npm: >= 10.0.0

### 安装与运行

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

# 6. 运行 Electron 桌面端
npm run desktop
```

---

## 路线图

- [ ] 第三方插件安装器：即将推出一键解压并验证本地插件包的能力。
- [ ] 更多本地向量检索索引器优化（向量缓存与混合检索）。
- [ ] 增强的自定义工作流步骤设计器。
- [ ] 扩展的 MCP 工具集与事件订阅支持。

---

## 许可证与商业合作

- 社区开源许可：本项目遵循 [KADAdesk Community License v1.0](LICENSE)（基于 Apache License 2.0，附加防 SaaS 倒卖、保留版权与标识、无商标授权及贡献回流条款，并在文末附 Apache 2.0 标准全文）。
- 企业内部自用：企业与团队内部自用完全免费，无需签署额外协议。
- 商业授权与渠道定制：针对商业分发、专有通信渠道扩展插件或专属私有化定制，请参阅 [商业授权说明](COMMERCIAL-LICENSE.md) 或联系商务团队：`Marshall@kunlungrowth.com`，官网：[https://kunlungrowth.com/kadadesk](https://kunlungrowth.com/kadadesk)。
