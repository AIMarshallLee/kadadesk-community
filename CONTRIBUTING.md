# 贡献指南 (Contributing Guide)

感谢你关注并参与 **KADAdesk Community** 的建设！我们欢迎各种形式的贡献，包括提交 Bug 反馈、完善文档、改进前端体验或扩展开放 MCP 能力。

[English Instructions](#english-guidelines) | [简体中文指引](#简体中文指引)

---

## 简体中文指引

### 1. 安全与脱敏红线 (绝对禁止违反)
在向社区提交任何代码、测试用例或文档之前，请务必进行本地脱敏检查：
- 🚫 **严禁包含真实密钥与凭据**：如 API 密钥、数据库连接串、私钥凭据等。测试用例请使用合成占位符。
- 🚫 **严禁包含个人私密数据**：包括真实手机号、个人姓名或私密聊天记录。
- 🚫 **严禁提交破坏第三方平台服务条款的代码**：社区版核心专注本地知识与桌面工作流，严禁包含任何绕过第三方平台风控、破解私有协议的代码。

### 2. 本地开发与验证流水线
在提交 Pull Request 前，请确保本地通过全部质量验证闸门：
```bash
# 1. 运行完整单元测试套件 (必须全部通过)
npm test

# 2. 运行类型检查与前端/桌面打包构建
npm run build

# 3. 运行开源发布脱敏扫描脚本
node scripts/verify-publication.mjs
```

### 3. Git 分支与 Commit 规范
- 分支命名推荐：`feat/<feature-name>`、`fix/<issue-name>` 或 `docs/<topic>`。
- 提交信息请遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范：
  - `feat(knowledge)`: 新增知识库导入格式支持
  - `fix(desktop)`: 修复桌面侧边栏折叠状态异常
  - `docs`: 更新使用文档或开发指南

### 4. 贡献者许可回流
向本项目提交任何 Pull Request 即表明你同意将你的贡献内容在 [KADAdesk Community License v1.0](LICENSE) 条款下提供，并授权维护方在商业双重许可中合并与分发。

---

## English Guidelines

### 1. Safety and Red Lines (Strictly Enforced)
Before submitting code, tests, or documentation, perform local sanitization:
- 🚫 **No Real Secrets or Credentials:** Never commit API keys, database URLs, tokens, or private certificates. Use synthetic test stubs.
- 🚫 **No Personally Identifiable Information (PII):** Do not commit real telephone numbers, personal identities, or customer logs.
- 🚫 **No Protocol Exploits:** Never submit unofficial hooks or protocol-cracking logic that violates platform terms of service.

### 2. Verification Steps
Ensure all automated checks pass locally before opening a pull request:
```bash
npm test
npm run build
node scripts/verify-publication.mjs
```

### 3. Contribution Flowback
By opening a pull request, you agree that your contributions are licensed under the [KADAdesk Community License v1.0](LICENSE) and grant maintainers rights to distribute under dual-licensing models.
