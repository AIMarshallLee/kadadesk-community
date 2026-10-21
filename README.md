# KADAdesk Community · 咔哒社区版

**一次准备朋友圈内容，分别管理多个个人微信号，逐号审核、人工发表、核实结果。**

本项目是 **Source-Available（源码开放、非 OSI 标准开源）**。个人和团队在自己或获授权的账号上自用（包括正常内容变现）、学习和修改，按 [LICENSE](LICENSE) 免费；对外销售软件、贴牌、收费 SaaS 和收费代运营软件，需要独立商业授权。这里不是 MIT/Apache 开源项目。

从咔哒私有产品 **选择性提取** 的独立社区应用，**不是**原版商业代码的公开镜像。没有商业授权系统、收付款、私有客户数据库、硬件控制或非公开微信接口。

## 能做什么

- 批量登记 6+ 个普通个人微信号，备注分布于 Windows/Mac/手机的设备。
- 内容库保留文字、最多 9 张 PNG/JPEG/WebP 配图（每张上限 4 MB）。
- 为每个号生成独立发布任务、修改专属文案、审核版本和避免重复任务。
- 每个号导出 ZIP（正文 TXT、发布说明、配图），由本人传到对应手机或电脑。
- **在官方微信客户端手动发表**，回到工具报告结果、核对本人朋友圈。
- 不确定有没有发出的任务会阻止自动重试；任务记录本地保存，重启后保留。

**不提供：** 自动登录微信、协议逆向、多开、无人值守朋友圈群发、账号数据抓取、跨设备云同步或官方发布成功回执。

## 最快开始

安装 [Node.js](https://nodejs.org/) **22 或 24** 和 npm：

```bash
git clone https://github.com/AIMarshallLee/kadadesk-community.git
cd kadadesk-community
npm ci
npm run dev
```

终端会输出 `http://127.0.0.1:<端口>`。在**当前这台电脑**浏览器打开。仅监听本机，不要拿这个地址给其他设备或公开反向代理。

数据默认保存在 `~/.kadadesk-community/`，不需注册、微信密码或 AI Key。

```bash
npm test
npm run smoke
npm run build
```

## 使用顺序

进入 **我的账号 → 批量登记 → 内容库 → 发布任务**。选择内容和多个号，逐号调整、人工审核后导出专属 ZIP；到对应的原生微信客户端手动发，再回到这里核实结果。详见 [中文操作手册](docs/USER-GUIDE.zh-CN.md)。

## 参与社区

欢迎提 [Issue](https://github.com/AIMarshallLee/kadadesk-community/issues)、测试和提交 PR。先阅读 [贡献说明](CONTRIBUTING.md)、[安全策略](SECURITY.md)。商业授权见 [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md)，公开边界见 [EXTRACTION-AUDIT](docs/EXTRACTION-AUDIT.md)。大量代码贡献在合并前可能需要单独的贡献者授权，以保持社区版及商业版的权利清晰。

---

**English:** Local-first, source-available personal WeChat Moments planning for multiple user-owned/authorized accounts. Manual native-app publishing and human verification only; no official personal-WeChat publishing API. The community license is **not OSI open source**. See [LICENSE](LICENSE).

Copyright (c) 2026 AIMarshallLee and relevant contributors.