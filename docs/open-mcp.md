# 咔哒「开放」MCP 接口

咔哒在本机开一个 MCP 服务（`http://127.0.0.1:端口/mcp`，只监听本机，需要密钥，网页来源的请求一律拒绝），让 Claude、Codex、Cursor 等 AI 工具读取和配置咔哒，从头到尾把咔哒设置好并跑起来。只支持 stdio 的工具用自带的本机桥 `kadadesk-mcp.cjs --open`。

代码：`desktop/open-mcp.ts`（服务与原有工具）、`desktop/open-mcp-settings.ts`（设置、模型、知识管理、审计）、`desktop/open-mcp-keys.ts`（客户端密钥与权限）。

## 调用方与权限

| 调用方 | 读取 | 修改设置（`configWrite`） | 不经确认（`skipConfirm`） | 应用任务 |
| --- | --- | --- | --- | --- |
| 默认密钥 | 可以 | 永远不能 | 永远不能 | 永远不能 |
| 命名客户端（「开放」页添加） | 可以 | 主人勾选「可以修改设置」后 | 主人另外勾选「允许不经确认修改设置」后 | 主人勾选后 |

- 两个设置权限默认关闭，按客户端单独保存在 `open-mcp-clients.json`（仅本人可读写）。勾选任一项都要主人在电脑上确认（Touch ID，不能用时弹出系统对话框）。
- 没有「可以修改设置」时，写入工具不出现在 `tools/list` 里；硬调用也会被拒绝，并记入审计。
- 每个工具都可以在「开放」页单独关闭。

## 工具

### 原有工具（所有调用方）

| 工具 | 作用 |
| --- | --- |
| `knowledge_search` | 检索已审核、已启用的知识（只读） |
| `knowledge_answer` | 生成回复草稿，不发送（扣额度，每小时最多 30 次） |
| `reception_status` | 接待状态与今日统计，默认不含客户原文 |
| `reception_control` | `pause` 暂停 / `resume` 解除暂停 / `status` 查看；`start`、`stop` 见下 |
| `knowledge_add` | 新增一条待审核知识 |

### 读取设置（所有调用方，只读）

| 工具 | 返回 |
| --- | --- |
| `settings_get` | 接待状态、平台、审核方式（设置值与实际生效值）、管理员联系人（不含暗号）、全部接待配置（人设语气、接待时段、每日小结、关键词规则、追问等）、工作台名称、知识数量、话术/工作流、全部模型设置、显示方式、授权状态（是否已授权、套餐、到期、试用次数）、本调用方的权限 |
| `models_get` | 画面识别主模型、备用模型、已配置的服务商、回复文字模型、`modelProtocol` / `replyModelMode` / `lightModel` / `routingModel`、自动挑选模型状态、可选服务商列表 |
| `knowledge_list` | 分页列出知识（`status`：all / pending / enabled / disabled，`query`，`offset`，`limit` ≤ 50），带审核与启用状态 |

所有密钥、卡密、令牌只以 `hasKey` 布尔值出现；管理员暗号、机器码不返回。输出先按白名单组装，再统一去掉任何层级的密钥类字段。

### 修改设置（需要「可以修改设置」）

| 工具 | 作用 |
| --- | --- |
| `settings_update` | `reception`：部分修改接待配置，与「接待」页同一个校验，未知字段直接报错；`preferences`：工作台名称、操作员名称；`workflow`：新建 / 修改 / 删除一条话术工作流（`action` = create / update / delete）。接待运行中不能改，先 `reception_control` `stop` |
| `models_set` | `vision` 主模型、`backup` 备用模型、`clearBackup`、`text` 回复文字模型、`autoPool` 自动挑选开关、`lightModel`、`routingModel`。`apiKey` 只写入，永不返回 |
| `models_test` | `target`：`main` / `backup`（用生成的数字卡片测试，不截聊天窗口）、`text`（连通测试）、`pool`（重新检测自动挑选模型） |
| `knowledge_review` | `approve` 审核通过并启用；`reject` 删除还没审核的条目 |
| `knowledge_update` | 修改一条知识；内容变化后回到待审核；`enabled` 启用或停用 |
| `knowledge_delete` | 永久删除一条知识 |
| `knowledge_import` | 把一段资料或聊天记录整理成知识，全部进入待审核，自动带 `来源:MCP` 标签 |
| `reception_control` `start` | 按咔哒保存的配置开始接待（接管键鼠）；急停后不能经开放接口重新开始 |
| `reception_control` `stop` | 停止接待，之后看门狗不会自动重启 |

`settings_update.reception` 不能改的字段及原因：`receptionSuspended`（用 pause / resume）、`adminTag`（咔哒生成）、`modelProtocol` / `replyModelMode` / `lightModel` / `routingModel`（用 `models_set`）、`layout` / `chat_appUnreadRegion` / `rotation` / `inputBackend`（要在咔哒里校准或选真实窗口）、`chatExperience`、`cruiseMode`。

## 需要主人在电脑上确认的修改

除非主人给这个客户端勾选了「允许不经确认修改设置」，下面这些修改会先弹出确认（Touch ID 或系统对话框，提示里写明是哪个客户端、改什么，不含密钥）。主人拒绝、2 分钟内没确认、或确认期间收回了权限，修改都不会执行；同一时间只等一个确认。

- 换画面识别主模型、备用模型或回复文字模型，换密钥，清除备用模型
- 删除知识；审核通过（启用）知识；重新启用已停用的知识
- 放宽发送前审核（含把「其他聊天软件 · 通用模式」改成别的平台，这会取消强制的全部审核）、关闭副驾草稿模式、改为自动发送、开始接待群聊
- 修改管理员联系人（新名字不带暗号，提醒不带客户消息，聊天里也不能批准）
- 修改直接发给客户的固定话术：关键词固定回复、追问、好友招呼语、图片文件固定回复
- `reception_control` `start`

不需要确认：收紧审核、人设语气、接待时段、每日小结、话术工作流、工作台名称、驳回待审核知识、修改知识内容（会回到待审核）、导入资料（进待审核）、自动挑选模型开关、便宜模型、停止接待、暂停 / 解除暂停。

## 永远不允许

- 读取任何密钥、卡密、令牌或管理员暗号
- 指定发送对象或内容、直接给客户发消息、替主人回复审核
- 绕过审核：审核与安全规则照常执行，放宽要主人确认
- 改动授权或激活，开启内置模型版（要用卡密）
- 把已保存的回复模型密钥发往新地址：更换回复文字模型的服务地址必须同时提供新密钥；画面识别密钥也只在同一地址下沿用
- 推翻急停

## 修改记录（审计）

每次写入尝试（已执行、被拒绝、失败）都记一条：时间、调用方名称、工具、摘要（不含密钥），也包括 `pause` / `resume` 和 `knowledge_add`。「开放」页的「修改设置」区显示最近 50 条，保存在 `open-mcp-audit.json`，重启后保留。

## 校验与报错

参数错误、未知字段、校验失败都以 `isError: true` 返回一句中文原因，例如 `未知设置项：foo`、`adminTag 不能经开放接口修改：管理员暗号由咔哒生成…`、`审核模式无效`。一次调用里有多项修改时按顺序执行，中途失败会说明已完成哪些。

## 示例

```json
{ "name": "settings_update", "arguments": { "reception": { "reviewMode": "all", "persona": { "tone": "friendly", "name": "合成小店" }, "dailySummaryAt": "21:00" } } }
{ "name": "models_set", "arguments": { "vision": { "provider": "qwen-cn", "model": "qwen3-vl-plus", "apiKey": "<只写入>" } } }
{ "name": "knowledge_review", "arguments": { "ids": ["knowledge_x"], "action": "approve" } }
{ "name": "reception_control", "arguments": { "action": "start" } }
```

## 验证边界

`desktop/open-mcp-settings.test.ts` 用替身依赖验证：输出里没有密钥、无权限时拒绝并记审计、校验错误原样返回、需要确认的修改会确认、审计条数与持久化、原有工具向后兼容。真实的 Touch ID / 对话框、真实开始接待（接管键鼠）、真实模型测试需要在本机验收。
