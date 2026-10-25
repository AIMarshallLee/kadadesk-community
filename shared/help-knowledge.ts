/**
 * 咔哒使用手册 for the 「问咔哒怎么用」 assistant (server/help-assistant.ts). Written from the current UI only;
 * each line names where the thing lives, and [id] marks the matching shared/feature-index.ts entry the
 * assistant may suggest as a button. The step-by-step 小教程 (shared/tutorials.ts) are appended, so every topic a
 * tutorial covers is answerable here too. It is sent with every question: keep the hand-written part short.
 */
import { suggestTutorial, tutorialsHandbook } from './tutorials';
import { FEATURE_IDS } from './feature-index';

const BASE_HANDBOOK = `# 咔哒是什么
咔哒是装在电脑上的 AI 客服：它看着你已登录的聊天软件窗口，照着你审核过的业务资料回复客户。资料只存在这台电脑。左侧导航：开始、知识、接待、数据、营销、插件、设置、开放。
完整的说明书在顶栏和左侧的「使用手册」，常见问题放在最前面；回答完可以建议用户去手册看完整说明 [help.manual]。

# 第一次使用（开始页）[setup]
按「开始」页的步骤走，做完自动打钩：① 打开聊天软件并登录；② 在「知识」导入资料并审核启用；③ 试答一个问题；④ 在「接待」点「开始接待」；⑤ 之后看小浮窗，暂停、急停都在那里。
新装好的咔哒已接好免费试用模型，不填密钥也能先用。

# 知识库：导入与审核 [knowledge] [knowledge.manage]
在「知识」页把产品说明、价格表、常见问题拖进来（支持文本 PDF、Word、Excel、TXT、Markdown、CSV 等；扫描版 PDF 要先转成文字）。先预览核对，再审核启用。只有审核启用的知识才会用来回答；改过的知识要重新审核。
没有资料可以用「行业样板」[knowledge.templates] 或「预置话术包」[knowledge.playbooks]，把【】里换成自己的信息。
试答：在「知识」写一句客户会问的话试答，对照资料标记答对或要修改；试答不会给客户发消息 [knowledge.practice]。
客户问过、没答上来的问题会出现在「待补充知识」，填一句答案就存成知识 [knowledge.gaps]。
资料在电脑文件夹：用「我的资料源」[knowledge.sources]；在网盘：「连接网盘」[knowledge.drives]；在飞书或 Notion：「连接在线知识库」[knowledge.connections]。
多台电脑共用一套知识：在「管理资料」里「导出知识包」，另一台「导入知识包」[knowledge.pack]。

# 接待页 [reception]
接待页有四个标签：运行、接待设置、模型与回复、窗口与校准。
运行：开始接待 / 暂停 / 停止，看今日收到、已回复、转人工 [reception.run]。「紧急停止全部任务」立刻停下所有动作 [reception.emergency-stop]。
接待设置：聊天应用、接待范围（自动接待所有新消息或只接待指定会话，群聊要单独打开）[reception.scope]、人设与语气 [reception.persona]、发送前审核 [reception.review-mode]、接待时段 [reception.hours]、管理员联系人 [reception.admin]。最下面「更多设置（一般不用改）」里有执行模式、追问、关键词规则、无人值守、多账号轮巡等 [reception.more]。
模型与回复：回复方式——「自动回复」直接发出，「人工复制回复」只写好给你复制 [reception.reply-mode]；还有参考哪些知识、工作流程。
窗口与校准：一般不用动 [reception.window] [reception.calibrate]。

# 发送前审核（审核模式）[reception.review-mode]
在「接待 → 接待设置 → 发送前审核」选：不审核直接回 / 只审核退款、投诉、议价 / 审核新客户和退款、投诉、议价 / 每条都先给我看（刚开始用推荐）。
要审核的回复先出现在小浮窗和接待页「待审核的回复」[reception.pending-review]：点「发送」照发，点「改一下」改好再发（勾选后改过的回答存进知识库），点「跳过」留给你自己回。两小时没处理就转给你。

# 小浮窗 [settings.display-mode]
「设置 → 显示方式」可选小浮窗或后台运行，接待在两种方式下都照常运行。关掉主窗口后小浮窗出现在屏幕边上，拖到屏幕左右边会缩成一条细边，鼠标移过去滑出。
小浮窗上的按钮：开始接待 / 暂停接待（正在发的这条发完再停）/ 继续接待、急停、打开咔哒、展开或收起详情、缩成图标；有回复等你确认时可直接点「发送」「改一下」「跳过」。
快捷键在「设置 → 快捷键」，暂停/继续和急停在任何软件里都能用 [settings.shortcuts]。

# 其他设置
主题色 [settings.theme]、图标款式 [settings.icon]、版本与更新 [settings.update]、备份与迁移（备份不含密钥和截图）[settings.backup] 都在「设置」。
无人值守：「接待 → 接待设置 → 更多设置 → 无人值守」打开后，重启或更新后自动恢复接待并补回 12 小时内没回的消息 [reception.unattended]。
接待数据在「数据」页，只用本机记录统计 [data]。「开放」页把知识检索和接待控制开放给其他 AI 工具 [open]。
配套硬件皮卡只在硬件模式需要；软件模式不用买硬件 [hardware] [reception.executor]。

# 回答规则补充
下面的「小教程」是一步一步的做法：问题和某个小教程有关时，按它的步骤回答，并在 actions 里给它后面方括号里的功能编号。
拿不准、或用户说「按教程做了还是不行」时：先说最相关的小教程叫什么、建议从哪一步再核对一遍，actions 先给那个小教程的功能编号，最后再给 help.diagnostics（生成求助包发给客服）。不要一上来就让用户联系客服或负责人。`;

export const HELP_HANDBOOK = `${BASE_HANDBOOK}

# 小教程（各页面上的「小教程」，内容相同）
${tutorialsHandbook()}`;

/**
 * Buttons for an unsure answer: the most relevant tutorial's first feature first, the help bundle last, so 「问咔哒」
 * never sends a beginner to support before a tutorial. Unknown ids are dropped.
 */
export function unsureHelpActions(question: string, suggested: string[] = [], max = 3): string[] {
  const first = suggestTutorial(question)?.links?.[0];
  const ids = [...new Set([...(first ? [first] : []), ...suggested].filter(id => FEATURE_IDS.has(id) && id !== 'help.diagnostics'))];
  return [...ids.slice(0, Math.max(0, max - 1)), 'help.diagnostics'];
}
