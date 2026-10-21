# 源码公开筛选与边界审计｜2026-10-21

## 来源和安全原则

上游私有仓库：`AIMarshallLee/kadadesk`，候选版本 `87d75a10a6e47cff3e5c064893db8596f3c75f99`，开发分支 `codex/multi-account-moments-v1`。

社区仓库采用**全新 Git 历史**，没有 Fork 原私有仓库，也没有复制原仓库历史或发布包。

## 公开清单

| 来源 | 处理 | 用途 |
| --- | --- | --- |
| `server/moments-campaign.ts` | 选择性复制，替换私有错误类为社区轻量类 | 多账号、内容版本、逐账号任务、防重复、人工审核、发布状态 |
| `server/moments-campaign.test.ts` | 复制合成用例 | 8个模拟账号、状态、持久化与隔离 |
| `src/MomentsCenter.tsx` | 选择性复制，接入独立本地UI壳 | 账号登记、内容库、任务与复盘 |
| `src/moments-export.ts` | 复制 | ZIP 文案与配图打包 |
| 独立 `src/api.ts`, `src/components.tsx`, `server/index.ts` | 新建社区专用实现 | 不依赖私有许可/桌面/云服务 |
| React / Lucide / Vite / TypeScript / tsx | 依照公共 npm 依赖安装，不直接复制私有依赖目录 | 自有第三方许可证仍适用 |

## 明确不公开

- `server/license*`、`server/commerce*`、`server/merchant-*`、`scripts/merchant-*`：收费、签名、授权、支付、商户私有服务。
- `desktop/replies-ipc.ts`、`desktop/moments-probe.ts`、自动化执行/窗口控制器、`shared/autopilot*`：原生客户端控制和平台边界。
- `firmware/`、RP2040/Pika USB 硬件桥：设备功能及多方版权审计尚未做独立发布。
- 模型服务商配置、外部数据连接器、客户私域信息、内部知识库、任何录屏、真实聊天、密钥、企业合同、商业许可证。
- 私有主仓库完整 Git 历史：避免泄露已经删除的旧文件、密钥或商业实现。

## 预发布及后续复核

1. 对**即将推送到公共仓库的实际跟踪文件**运行密钥/隐私/敏感模块名称扫描，并人工检查命中项。
2. 检查版权归属，外部来源代码不能因为处于公司私有仓库就认定可单独重新许可。
3. 审查新许可证：目前为 Community Source License v0.1，自用可经营内容，但再售/SaaS/外部客户服务需要书面授权；这不是 OSI 开源许可证。
4. 验证 Windows 和 macOS 的安装流程；当前 Web 测试不代表微信真机发布验收。
5. 数据保存在 `~/.kadadesk-community/`；手机只靠人工 ZIP 文件交接，不宣称跨设备同步。
6. 社区代码贡献与商业双重许可需要独立版权协议，提交 PR 不等于默许商业重授权。

**筛选结果：首批只公开“独立可用的朋友圈内容运营”模块；不要直接把整个私有仓库改 Public。**
