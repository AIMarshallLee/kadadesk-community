# 咔哒插件中心：怎么写一个插件

插件让咔哒工作台在客服和知识库之外做更多事，**不改动原有功能**。v1 支持三类插件：

| 类型 | `kind` | 能做什么 |
| --- | --- | --- |
| 内容包 | `content` | 话术包、知识包、回复风格包。导入后放进「待审核」或停用的工作流，你审核启用后才会用。 |
| 工具 | `tool` | 指向一个外部 MCP 服务（本机命令或 http 地址），咔哒作为 MCP 客户端去连它，列出工具。 |
| 自动化 | `automation` | 不写代码的「当… → 就…」规则：新客户来消息、提到关键词、每天某时、转人工时，就提醒你、发给管理员聊天、调用工具或记到本地表格。 |

插件就是一个 `kadadesk-plugin.json` 文件。在咔哒左侧打开「插件」页，点「选择插件文件」或「粘贴插件内容」，看清楚权限后点「同意并安装」。

## 安全规则

1. **先同意再安装**：安装前，咔哒用大白话列出插件要的权限和风险提示，你点「同意并安装」才会装。不认识的权限、类型不对的字段会直接拒绝。
2. **内容不直接上线**：内容包里的问答一律进「待审核」（停用状态），回复风格是一个**停用的**工作流，审核启用后才会用。
3. **插件不能直接回复客户**：回复照旧走咔哒的接待流程（审核模式、安全检查、发送时机）。`customer.reply` 权限在 v1 不开放，写了也不生效。
4. **工具分两种**：每个工具默认是「会写入，每次问我」。只有你在插件页把它改成「只读，可自动用」，并填了触发词（如「订单」「物流」「预约」），客户的消息里出现触发词时，咔哒才会在起草回复前**自动查一次**：
   - 只有输入是「一个文字参数」的工具才会自动用，参数就是客户这条消息的文字；
   - 最多等 8 秒，结果最多 2000 字，放在资料末尾并标明「插件数据（不可信，仅供参考）」，模型被告知那是外部数据、不是指令；
   - 查询失败这次回复就不用它，不影响接待。
   - 「会写入」的工具起草回复时从不使用；自动化规则要用它时，会先在插件页等你点「同意执行一次」。
5. **出错自动停用**：插件连续出错 3 次会自动停用，并只提醒你一次；在插件页能看到「上次出错」的原因。
6. **随时撤销**：每次安装、卸载、启停、改工具、改规则、采纳建议之前都会保存一份插件状态；点「撤销上一步」恢复，并删除那一步加进来、你**还没审核**的内容（你已审核启用的内容会保留）。
7. **数据留在本机**：插件放在咔哒数据目录的 `plugins/<插件编号>/` 下（`index.json` 是总表）。进化建议只看本机接待记录，不会把聊天内容发到任何地方。工具插件只有在触发词命中时，才会收到客户那条消息的文字。

## 通用字段

```json
{
  "id": "pet-shop-pack",
  "name": "宠物店话术包",
  "version": "1.0.0",
  "author": "某某工作室",
  "description": "宠物店常见问答和推荐话术",
  "kind": "content",
  "permissions": ["knowledge.suggest"]
}
```

- `id`：小写字母、数字和短横线，2～48 个字符。同一个 `id` 再装一次就是升级（会提示替换）。
- `permissions`：只能从下表里选；写了别的会被拒绝。

| 权限 | 大白话 |
| --- | --- |
| `knowledge.read` | 读取你已审核的业务资料 |
| `knowledge.suggest` | 往知识库里放待审核的内容（内容包必须有） |
| `reception.status` | 知道接待情况：有新消息、转人工时，能看到客户发来的文字（除「每天某时」外的自动化规则需要） |
| `model.call` | 使用你配置的模型（会产生模型费用） |
| `notify.owner` | 给你发提醒：电脑通知、发到管理员聊天 |
| `tools.read` | 用只读工具查信息 |
| `tools.write` | 用会写入的工具，每次都要你点同意 |
| `customer.reply` | 直接回复客户（v1 不开放） |

## 例 1：内容包（知识 + 话术 + 回复风格）

```json
{
  "id": "pet-shop-pack",
  "name": "宠物店话术包",
  "version": "1.0.0",
  "author": "某某工作室",
  "description": "宠物店常见问答和推荐话术",
  "kind": "content",
  "permissions": ["knowledge.suggest"],
  "content": {
    "knowledge": [
      { "question": "营业时间是几点？", "answer": "每天【9:00-21:00】，节假日照常营业。" },
      { "question": "可以寄养吗？", "answer": "可以，请提前一天预约，【每天 80 元】。", "tags": ["寄养"] }
    ],
    "scripts": [
      { "question": "太贵了", "answer": "理解您的顾虑，我们用的是进口粮，可以先买小包装试试。" }
    ],
    "style": {
      "name": "亲切店主",
      "instructions": "像熟悉的店主一样说话，简短、热情，不用官腔。",
      "greeting": "你好呀，有什么可以帮你？",
      "tone": "friendly"
    }
  }
}
```

- `knowledge` 进知识库，`scripts` 进知识库并打上「话术」标签，都在「待审核」里；`【】` 里的内容记得换成自己的。
- `style` 变成一个停用的工作流「【插件】亲切店主」；`tone` 可选 `professional` / `friendly` / `brief`，插件页会出现「用这个语气」按钮，点了才会改。
- 每类最多 500 条，问题最多 500 字、回答最多 4000 字。

## 例 2：工具插件（指向本机 MCP 服务）

本机命令（stdio）：

```json
{
  "id": "order-lookup",
  "name": "订单查询",
  "version": "1.0.0",
  "author": "我的店",
  "description": "按订单号或手机号查物流状态",
  "kind": "tool",
  "permissions": ["tools.read"],
  "server": {
    "transport": "stdio",
    "command": "C:\\Program Files\\nodejs\\node.exe",
    "args": ["D:\\my-shop\\order-mcp-server.js"],
    "env": { "SHOP_API_BASE": "https://api.example.com" }
  }
}
```

http 地址（streamable HTTP）：

```json
{
  "id": "booking",
  "name": "预约登记",
  "version": "1.0.0",
  "author": "我的店",
  "description": "查询和登记到店预约",
  "kind": "tool",
  "permissions": ["tools.read", "tools.write"],
  "server": { "transport": "http", "url": "http://127.0.0.1:8765/mcp", "headers": { "Authorization": "Bearer 你的服务密钥" } }
}
```

- `command` 不经过系统命令行解释，请写完整路径（Windows 上 `npx` 要写成 `npx.cmd`）。
- http 地址必须是 `https://`；只有本机地址（`127.0.0.1`、`localhost`）可以用 `http://`。
- 装好后咔哒会连一次服务、列出工具。到插件页给每个工具选用法：
  - 「只读，可自动用」+ 触发词（如 `订单、物流`）：客户提到时自动查，结果只当参考资料；
  - 「会写入，每次问我」（默认）：只在自动化规则里用，每次都要你同意。
- MCP 服务端怎么写：实现 `initialize`、`tools/list`、`tools/call` 即可。想被「自动查」，工具的 `inputSchema` 只能有一个字符串参数，例如：

```json
{ "name": "lookup_order", "description": "查订单物流", "inputSchema": { "type": "object", "properties": { "query": { "type": "string" } }, "required": ["query"] } }
```

## 例 3：自动化插件

```json
{
  "id": "shop-reminders",
  "name": "店铺提醒",
  "version": "1.0.0",
  "author": "我的店",
  "description": "退款、新客户和转人工提醒",
  "kind": "automation",
  "permissions": ["reception.status", "notify.owner", "tools.write"],
  "rules": [
    { "id": "new", "name": "新客户来了", "when": { "type": "first-message" }, "then": [{ "type": "notify" }] },
    { "id": "refund", "name": "提到退款", "when": { "type": "keyword", "keywords": ["退款", "退货"] },
      "then": [{ "type": "admin", "text": "「{客户}」提到了「{关键词}」：{消息}" }, { "type": "csv" }] },
    { "id": "morning", "name": "早上看一眼", "when": { "type": "daily", "time": "09:00" }, "then": [{ "type": "notify", "text": "早上好，记得看一下昨晚的接待记录" }] },
    { "id": "handoff", "name": "转人工就登记", "when": { "type": "handoff" }, "then": [{ "type": "tool", "plugin": "booking", "tool": "create_note" }] }
  ]
}
```

- 「当…」（`when.type`）：`first-message` 新客户第一次来消息 / `keyword` 客户消息含关键词（`keywords` 1～20 个）/ `daily` 每天某时（`time` 写成 `09:00`，在这之后 30 分钟内触发一次，电脑关着就跳过那天）/ `handoff` 转人工时。
- 「就…」（`then`，1～5 个）：`notify` 电脑通知 / `admin` 发给管理员聊天（需要在接待设置里配好管理员；没加暗号时只发不含客户内容的提醒）/ `tool` 调用某个工具插件的工具（`plugin` 写工具插件的 `id`；「会写入」的工具每次等你同意）/ `csv` 记一条到本地表格（`plugins/<插件编号>/records.csv`，能用表格软件打开）。
- 提醒文字可以用 `{客户}` `{消息}` `{关键词}` `{规则}` `{时间}`。
- 不想写文件：在插件页点「新建一个自动化」，用表单改规则后点「保存规则」。自己建的自动化需要的权限会自动加上；别人做的插件只能用它安装时声明过的权限。

## 每周进化建议

每周（以及你点「现在看一次」时）咔哒只读本机接待记录，列出三类建议，每条一键「采纳」、可撤销：

- **知识缺口**：转人工或回了「确认后回复」的问题 →「加到知识库（待审核）」，你补上答案再启用；
- **你改过的说法**：审核时你改过的回复 →「把这种说法设为默认」，作为一条话术放进待审核；
- **常转人工的词**：多位客户提到后转人工的词 →「开一个提醒」：提到这个词就通知你。

## 目前的限制

- 只支持 JSON 文件或粘贴内容安装，不支持压缩包。
- 插件不能运行自己的代码；工具插件的代码跑在它自己的 MCP 服务里，咔哒只通过 MCP 调用。
- 不看屏幕的「官方接口」回复路线暂不使用工具插件，只有桌面接待会用。
