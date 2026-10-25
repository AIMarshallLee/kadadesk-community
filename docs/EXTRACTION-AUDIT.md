# KADAdesk Community｜公开代码筛选与发布审计（v0.3 社区核心）

## 双仓库隔离

- **原始商业与开发仓**：`AIMarshallLee/kadadesk`，**Private**。专有发卡收款、商户授权管理、硬件固件及商业定制渠道插件保留在此。
- **社区公开核心仓**：`AIMarshallLee/kadadesk-community`，**Public**。承载 **KADAdesk Community (咔哒社区版)**，拥有独立 Git 历史，遵循 KADAdesk Community License v1.0。

---

## v0.3 社区核心已发布资产清单

| 模块类别 | 包含源码与核心组件 | 验证与质量保证 |
| :--- | :--- | :--- |
| **桌面工作台宿主** | `desktop/main.ts`、`desktop/preload.ts`、`desktop/app-icon.ts`、小紫怪主题引擎与托盘生命周期 | Electron 打包与多窗口自动化测试通过 |
| **完整知识库引擎** | `server/knowledge-*.ts`、多格式文件解析（PDF、DOCX、XLSX、CSV、JSON、ZIP）、知识候选审核流与本地备份恢复 | 解析回放与知识库单元测试 100% 通过 |
| **BYOK 模型客户端** | `desktop/reply-model.ts`、`server/conversation-routing.ts`、主流大模型预设（OpenAI、SiliconFlow、DeepSeek、智谱等） | 零内置 Key、零隐藏中转、故障转移测试通过 |
| **安全与保密护栏** | `shared/secret-guard.ts`：请求前敏感凭证拦截与脱敏机制 | 敏感词、手机号、各类 API Key 拦截测试全通 |
| **客户档案与跟进草稿** | `shared/customers.ts`、`src/CustomersPage.tsx`：本地客户标签、跟进队列与草稿一键复制 | 纯本地人工协同，无静默后台发送 |
| **开放 MCP 协议** | `desktop/open-mcp.ts`、`desktop/kadadesk-mcp-cli.ts`：符合 Model Context Protocol 标准的本地桥接 | stdio 桥接与命令行工具端到端验证通过 |
| **内置使用手册** | `docs/manual/*.md` 涵盖 22 章完整用户指南与更新日志 | `npm run manual` 自动编译至应用运行时 |
| **合规许可与治理** | `LICENSE` (Community v1.0)、`COMMERCIAL-LICENSE.md`、`THIRD_PARTY_NOTICES` | 经开源门禁扫描器验证，企业内部自用免费 |

---

## 坚决排除的私有资产（严格未公开）

- 原始 Private 仓库的历史 Git DAG、提交记录及开发者私人信息。
- 任何真实 API 密钥、数据库连接凭证、手机号、客户档案及线上会话捕获。
- 私有发卡收款系统、商户后台、授权卡密计算及心跳上报服务。
- 针对外部聊天软件或电商后台的私有自动化外挂、协议破解与内存劫持插件。
- 专有硬件（Pika USB）微控制器固件源码及烧录镜像。

---

## 验证与门禁标准

1. **测试全通**：`npm test` 覆盖全量 372 个测试用例，保持 100% 通过（0 Fail）。
2. **打包成功**：`npm run build`（TypeScript + Vite）与 `npm run build:desktop`（esbuild 打包桌面与 MCP 入口）均无报错构建成功。
3. **安全扫描**：`node scripts/verify-publication.mjs` 门禁扫描全量文件，确保零敏感词、零私有路径、零未审核二进制。
4. **许可证明确**：遵循 **KADAdesk Community License v1.0**，明确企业及团队内部自用完全免费，保留防 SaaS 倒卖转售等 4 条边界。
