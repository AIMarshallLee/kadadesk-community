# KADAdesk Community · 内容发布工作台

**一次创作，多账号分发。统一管理图文素材、内容分发计划、人工发布提醒与发布记录。**

[English summary](#english) · [使用手册](docs/USER-GUIDE.zh-CN.md) · [社区协议](LICENSE) · [参与开发](CONTRIBUTING.md)

这是一个 **Local-first / Source-Available** 的内容运营工具。参考社交平台内容管理工具中常见的 **Draft → Review → Handoff → Published → Verified** 流程，为运营多个社媒账号的人减少重复准备内容的时间。

> **能力边界：** 这是发布准备与人工协作工具，不是官方平台的发布接口。**不会自动登录、定时发帖或群发**。平台标签仅用于整理账号，不意味着已接入对应平台。

## 社区版能做什么

- **多账号与多设备**：登记账号、平台分类和 Windows / macOS / 手机设备；支持一次导入 6 个以上账号。
- **图文素材库**：保存正文，支持最多 9 张图片（PNG/JPEG/WebP，每张不超过 4 MB）。
- **内容分发计划**：一次编写，给不同账号生成独立发布任务和专属文案；避免重复分配。
- **审核与发布提醒**：待审核 → 待手动发布 → 已标记发布 → 人工核实；结果不明时锁定任务，避免误重发。
- **素材包交接**：给每个账号打包正文 TXT、发布说明与图片 ZIP，自行传输到对应设备。
- **隐私优先**：本机保存，默认只允许本机浏览器访问；不索取平台密码或密钥。

**“发布提醒”目前是工作台内的待办和流程提示，不是后台定时推送，更不是到点自动发帖。**

## 安装并运行

需要 Node.js 22/24 和 npm：

```bash
git clone https://github.com/AIMarshallLee/kadadesk-community.git
cd kadadesk-community
npm ci
npm run dev
```

打开终端显示的本机地址，例如 `http://127.0.0.1:<端口>`。手机或另一台电脑不能直接访问这个本机地址；需要将每个任务的 ZIP 素材包手动传输过去。

本地运营数据默认位于 `~/.kadadesk-community/`。不需要账号注册、云服务器或 AI Key。

```bash
npm test
npm run smoke
npm run build
```

## 五步操作

1. **社媒账号管理**：登记账号备注、目标平台和所用设备（平台仅作分类）。
2. **图文素材库**：准备正文与图片。
3. **内容分发计划**：选择要使用该内容的账号，各自生成独立任务。
4. **审核 / 获取发布素材包**：检查专属文案、平台和目标账号，下载 ZIP，在目标平台自己的客户端手动发布。
5. **确认发布结果**：在对应账号已发布内容列表中核对后，回工作台标记人工核实；不确定则保持锁定，避免重复操作。

详细流程见 [中文操作手册](docs/USER-GUIDE.zh-CN.md)。

## 社区协作与许可

当前许可证为 [KADAdesk Community Source License v0.1](LICENSE)：**源码可见，并非 OSI 标准开源许可证**。个人、团队用在自己或获授权的账号上，包括这些账号的正常内容经营，按照许可条款免费使用；出售或贴牌软件、商业 SaaS 和向外部客户提供收费的软件运营服务须另行取得书面商业授权。

欢迎反馈和贡献：参见 [CONTRIBUTING.md](CONTRIBUTING.md)、[SECURITY.md](SECURITY.md)、[COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md) 及 [源码提取审计](docs/EXTRACTION-AUDIT.md)。商业再授权及第三方贡献的版权边界需在合并代码前确认。

### English

KADAdesk Community is a **local-first content publishing planner**, not a platform publishing API. Prepare image-and-text content once, create independent account tasks, review variants, hand off ZIP bundles and manually verify publication. Platform labels such as Instagram, X or Facebook are organizational metadata only. There is **no direct publishing, scheduling push notification, account login or cloud sync**. This project is source-available, not OSI open source. Read [LICENSE](LICENSE).

Copyright (c) 2026 AIMarshallLee and relevant contributors.
