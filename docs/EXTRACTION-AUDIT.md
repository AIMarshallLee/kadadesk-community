# KADAdesk Community｜公开代码筛选与发布审计（2026-10-24）

## 双仓库隔离

- 原始产品：`AIMarshallLee/kadadesk`，**Private**。原始 Git 历史、商户签名/授权后台和需验证的桌面/设备操作仍保留在这里。
- 社区产品：`AIMarshallLee/kadadesk-community`，**Public**。从独立创建的 Git 历史继续开发，源码只通过全新的公共提交导入，绝不镜像原仓库历史。

## 已明确公开并可构建的资产

| 文件或模块 | 来源和处理 | 验收 |
| --- | --- | --- |
| `server/moments-campaign.ts`、`src/MomentsCenter.tsx`、`src/moments-export.ts` | 原私有代码中选择的本地内容/任务运营逻辑，剥离商业依赖后发布 | 合成多账号、版本、审批和素材导出测试 |
| `server/plugin-host.ts`、`src/WorkspaceApp.tsx` | 社区独立开发的可信内置模块管理底座 | 服务端接口阻断、启停持久化 |
| `server/knowledge-query.ts` | 从私有分支 `codex/trial67-dual-mode-beta` 筛选的原始查询规范化纯函数；新公共提交，不带历史 | Source review + CI |
| `sdk/abortable-delay.ts` | 从私有分支筛选的可取消延迟工具，不涉及桌面执行 | Source review + 测试 |
| `server/knowledge-community.ts`、`src/KnowledgeCenter.tsx` | 社区新写的独立单机知识模块，使用上述查询纯函数 | 录入、人工审核、检索、启停、删除、重启后恢复 |
| `scripts/verify-publication.mjs` | 公共仓库自动文件类型/密钥/敏感信息扫描 | 每个 PR 和 main 构建时执行 |
| `LICENSE` + 商用说明 | v0.2 个人非商业条款；旧版授予权保留 | 许可版本文档化 |

目前社区里**不是**完整桌面咔哒商业版：知识模块只支持本地文字内容，尚未迁入原有复杂文档导入、企业权限和 AI 模型辅助；内容模块仍是人工发布任务。

## 当前未公开

- 原始 Private 仓库的任何 `.git` / Git commit DAG / 已删除历史资产。
- 密钥、cookie、模型秘钥、客户档案、真实聊天、录音、客户专属知识库和含 PII 的截图。
- 商业支付、授权签名、商户后台和个人交易资料。
- 未获版权和再分发许可的第三方依赖、固件和私有资产。
- 未经过合法授权、真实测试的特定平台后台控制及渠道自动发送。
- 原始 `desktop/` 复杂执行与 `firmware/` 设备部分尚待逐模块评审，而不是默认永不公开。

## 迁移和验证关卡

1. **默认拒绝**：私有仓库里的 `docs/community-export-allowlist.json` 是显式白名单，没有批准的文件不能迁出。
2. 私有仓库 `scripts/community-snapshot-audit.mjs` 是离线检查及导出工具，产生**新文件快照**而不是 Git 克隆历史。其真实本机运行仍需复核。
3. 每批公开文件都检查依赖、真实客户资料、第三方权利、敏感平台接口和许可证兼容性。
4. 社区 `node scripts/verify-publication.mjs` + TypeScript/Vite 构建 + 回归测试 + PR 人工审查。
5. GitHub Actions Node 22/24 均通过： [社区首次双模块合并 PR #1](https://github.com/AIMarshallLee/kadadesk-community/pull/1)。
6. 客户生产环境/Windows 和 macOS 桌面原生体验，以及第三方渠道真实验收，仍未证明。

**提示：** 模式匹配扫描不是完整法律或隐私审计。不能因为 CI 绿灯就认定所有版权、客户许可和供应商协议已经被复核。v0.2 是 Source-Available 个人非商业许可，不等同 OSI 标准开源，历史 v0.1 许可不会追溯消失。
