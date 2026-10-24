> **截至 2026-10-24 的实际代码状态：** 社区版已有两个可信内置模块——内容运营与基础知识库（仅本地文本录入/人工审核/检索）；真正的独立插件包分发、私有完整版知识库和 AI 回复仍待开发。许可已更新为个人非商业 Source-Available v0.2。

# KADAdesk｜插件化 AI 工作台 V1 架构决策与实施路线

> **2026-10-21** · 这是一份产品与技术设计。本文用“已实现／设计中／未来阶段”区分真实进度。
>
> **核心定位**：KADAdesk 是可扩展的 AI 工作台，服务各种企业的具体业务交付。不是专门的内容发布、客服机器人或社媒平台软件。可组合的模块都由插件承载。

## 一、核心商业与产品原则

1. **工作台只有一套**：统一登录/设备、权限、企业空间、数据、模型和工具配置、通知/审核、日志、升级与插件管理；不同客户通过不同插件配置交付。
2. **能力即插件**：知识库、AI 回复建议、内容运营、客户跟进、社群任务、数据分析，以及特定行业/官方授权渠道适配。单独安装、启停、升级、卸载，互不绑死。
3. **核心平台与渠道脱钩**：不能因为某家外部平台收紧接口规则，就让整个咔哒产品不可用。原则上业务知识和辅助决策仍可离线/人工使用。
4. **合规不是命名魔法**：声明“工作台”并不能合法化某插件实际执行的受限操作。必须逐渠道验证官方接口/协议、商家数据权限、业务发送窗口、人工审核和取消授权机制。
5. **收入与交付**：客户购买解决问题的交付成果。收费来源包括专业插件许可、企业配置/部署、定制接入与持续服务；社区版展示可验证的免费能力，商业版与真实交付留在私有仓库。

## 二、首批拆分顺序

| 插件 | 私有现有资产 | 初始交付边界 | 依赖与风险 | 次序 |
| --- | --- | --- | --- | --- |
| **知识库 Knowledge** | `server/knowledge.ts`、`server/knowledge-connectors.ts`、知识审核与导入、相关数据模型 | 文档导入/分段/版本/审核/检索和数据隔离；独立可用 | 数据授权、租户隔离、第三方文档 API 与存储策略 | **P0** |
| **AI 回复辅助 AI Reply** | `server/conversation-routing.ts`、`server/learning.ts`、人工审核草稿机制、现有模型适配 | 给定合法输入 → 知识检索 → 草稿 → 高风险转人工 → 人工审核/导出；**不默认外发** | 可以依赖知识库；不包含特定平台的受限发送代码 | **P0** |
| **内容运营 Content Ops** | 社区版 `server/moments-campaign.ts`、`src/MomentsCenter.tsx` | 素材、分发任务、手动交接、结果记录，作为第一个示例插件 | 手动模式，与任何特定平台官方 API 无关 | **P0（当前内置）** |
| **客户跟进 CRM** | 已有线索/分类/运营相关功能，需逐项审计 | 线索、标签、跟进提醒、人工记录 | 获授权的客户数据，不自动抓取 | P1 |
| **社群运营 SOP** | 既有群任务/文案草稿 | 群公告、活动计划、审核与手动执行 | 平台适配器需要单独授权 | P1 |
| **Channel Connector** | 目前产品的桌面执行/渠道模块 | 平台官方允许的接收/发送接口，独立权限与健康状态 | 未授权渠道默认禁止自动操作；不从社区版夹带私有发送器 | 按客户场景与审批情况 |
| **AI 经营报表** | 现有统计模块及客户业务指标 | 按租户、模块汇总业务效果 | 数据权限与口径 | P2 |

**重点：** AI 客服不是消息平台。它是通用的“知识 + 回复建议 + 审核”业务插件；能够真正发送消息的功能属于另一个可授权、可停用的 Connector 插件。

## 三、比较现成底座

| 方案 | 值得借用 | 不直接采用的理由 | 决策 |
| --- | --- | --- | --- |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | Cordis 插件依赖/生命周期、profiles/bundles、事件轨迹、工具注册、Agent 能力组合 | 通用 Agent Harness，不是现成的企业交付/权限隔离/SaaS 授权平台；仍有快速演进风险 | **借架构、做隔离 PoC** |
| [Cordis](https://cordisjs.org/) / [DeepSeek Harness 官方 Cordis 教程](https://deepseek-harness.github.io/deepseek-harness/en/reference/cordis-primer) | Service Context、依赖注入、动态装卸与可撤销注册、生命周期 | 不负责未受信第三方代码沙箱、商户权限、签名分发或企业数据隔离 | **优先评估作为宿主插件内核** |
| [Dify](https://docs.dify.ai/) | 现成知识/AI 工作流和模型连接，降低特定客户 AI 交付成本 | 偏向 AI 应用/工作流平台；不宜整体替换咔哒桌面产品与独立插件宿主 | **用作可选 AI/知识服务后端** |
| [n8n](https://docs.n8n.io/) | 业务自动化、定时任务与第三方服务组合 | 不等于通用安全插件宿主；工作流/节点授权需单独管控 | **可选自动化执行连接器** |
| [Open WebUI](https://docs.openwebui.com/) | 可借模型前端、插件管理交互 | 官方明确自定义 Functions/Tools 能执行服务器代码，不能把它当安全沙箱 | **参考交互，不直接作权限隔离层** |

**建议组合：** 以现有 KADAdesk TypeScript/React 应用为产品底座；吸收 Cordis 的服务依赖与插件生命周期思想（需验证 SDK 边界）；需要企业 RAG/工作流时可选 Dify/n8n 服务，但不把所有客户绑定到这些第三方平台。第一版不直接 Fork 全套 DeepSeek Harness。

DeepSeek 官方参考：
- https://www.deepseek.com/harness/en/
- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md
- https://deepseek-harness.github.io/deepseek-harness/en/develop/framework/

## 四、分层与数据边界

```text
KADAdesk Shell（稳定身份与导航）
    │
    ├── Plugin Manager / Entitlements（版本、依赖、安装、启停与计费）
    │
    ├── Capability Broker（逐插件授权使用模型、文件、数据、任务、网络）
    │
    ├── Data Store（tenant / workspace / plugin 分层隔离）
    │
    ├── Agent Harness（可选模型/工具/技能/长任务）
    │
    ├── Built-in content-ops 〔社区版已内置，启停可用〕
    ├── knowledge-lite 〔社区版已内置：人工审核、本地文字检索〕
    ├── knowledge-advanced 〔原私有完整知识能力，尚待拆分〕
    ├── ai-reply 〔现有私有产品需模块解耦〕
    └── channels / crm / community / analytics 〔后续按合规与付费需求逐项安装〕
```

租户隔离不能仅靠前端页面切换或插件名；每个服务端请求需要校验操作者、tenant、workspace 和 plugin capability。插件升级、卸载不得销毁其他租户资料。插件停用后业务接口必须拒绝执行，包括后台任务和排队消息。

## 五、插件包协议（**提案、尚未实现动态安装**）

```json
{
  "schemaVersion": 1,
  "id": "com.kadadesk.knowledge",
  "name": "Knowledge",
  "version": "0.1.0",
  "minHostVersion": "0.2.0",
  "platforms": ["windows", "macos", "server"],
  "permissions": ["workspace:knowledge.read", "workspace:knowledge.write"],
  "dependencies": [],
  "uiEntry": "dist/ui.js",
  "runtimeEntry": "dist/server.js",
  "publisher": "publisher-signature",
  "sha256": "validated-artifact-hash"
}
```

需实现的宿主闸门：可信来源/签名与内容摘要、版本与依赖解析、最低权限、沙箱进程、磁盘配额与插件目录、安装回滚、升级迁移与数据备份、启停/卸载审计、统一权限撤回。**不要执行下载来的任意 JavaScript 作为“插件安装”。**

## 六、已实现的第一块 Core（本仓库当前可测）

- 内置可信模块注册表（目前有 `com.kadadesk.content-ops` 和 `com.kadadesk.knowledge` 两个内置模块）。
- `GET /api/plugins`：列出内置模块、版本、权限声明、是否可下载、启停状态。
- `POST /api/plugins/com.kadadesk.content-ops/enable|disable`：持久化启停。
- **停用时后端业务 API 拒绝请求**；只是关闭前端菜单不算有效启停。
- Web 前台已有主工作台与插件管理；内容运营、基础知识库分别可进入和停用。
- 原业务数据保留在本地，停用不会销毁任务；用户重新启用可继续使用。

**尚未实现：** 第三方包下载/安装/卸载、插件沙箱、Cordis 挂载、插件市场、完整知识库与 AI 回复的独立插件包、正式企业权限系统。不要对外宣称完成。

## 七、下一步开发里程碑与验收

**M1｜Core Plugin SDK**：把 content-ops 从主程序编译静态依赖拆成有独立 manifest 和受控生命周期的内置插件；实现清晰的插件贡献接口、API 网关和配置隔离。测试启停、重启持久化、权限拒绝、插件故障不影响主程序。

**M2｜Knowledge 插件**：从私有产品抽出知识管理、导入、人工审核、检索（可选独立向量后端）。不得公开现有客户数据或私有连接器；模拟 2 租户、不同业务知识不互串。

**M3｜AI Reply 插件**：由知识插件提供已审核事实，从指定的合规模型适配器生成草稿、分类高风险、人工确认。**与自动发送平台代码拆开**；审核不合格不得执行外联。

**M4｜正式插件发行**：完成权限隔离、包签名、依赖/版本、安装/卸载/升级回滚，再向社区开放第三方插件分发。商业插件单独授权、收费和服务边界。

**M5｜企业交付配置**：为每个客户定义“启用插件＋权限＋模型与数据连接＋验收标准＋费用与支持”，支持导出可复用部署模板但不导出密钥。客户交付不再依赖复制完整代码仓库。

## 八、必须保留的合规承诺

“以工作台对外宣传”是准确反映产品整体能力的定位，但不能以此掩盖任何插件违规使用第三方平台的事实。所有自动对外通信由独立 Connector 负责，只有验证官方开放能力、客户授权、限频与验收通过后启用；未获准的渠道只能使用人工辅助模式。公开代码与市场文案不得许诺未经验证的自动收发。

社区版仍按 `LICENSE` 的 Source-Available 规则使用，不宣称 OSI 意义的开源软件；DeepSeek Harness 的 MIT 开源许可不应误写成咔哒现有代码的许可。
