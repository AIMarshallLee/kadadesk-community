/**
 * 搜索所有功能: every page, tab, section and setting an owner may look for, in plain words.
 *
 * How an entry is reached (src/HelpAssistant.tsx `goToFeature`):
 *  1. `route` is written to location.hash (only routes App.tsx already understands);
 *  2. each `steps` text is clicked in order if it is not already open — a tab button (aria-selected / .active /
 *     .selected), a collapsed <details> summary, or a plain button such as 「更多方式 ▾」. A step starting with `?` is
 *     optional: clicked only when it is on screen (e.g. 「更多方式」 is gone once the extra tabs are shown);
 *  3. the element `target` (an element id) — or else the first heading / summary / field label / button whose text
 *     equals or starts with one of the `|`-separated `find` texts — is scrolled into view and briefly highlighted;
 *  4. `open` asks App for a window that has no route (授权窗口, 帮助与日志, 反馈问题, 问咔哒怎么用).
 * A `kadadesk:focus` CustomEvent with `{ id, target, find }` is dispatched on window after navigating, so a page
 * may later open its own collapsed parts for an entry without this file changing.
 */
export type FeatureOpen = 'license' | 'diagnostics' | 'feedback' | 'assistant';
export interface FeatureEntry {
  id: string;
  label: string;
  /** Breadcrumb shown under the label, e.g. 「接待 · 接待设置」. */
  where: string;
  /** One plain sentence: what it is for. Also used by the help assistant. */
  summary: string;
  /** Plain words people type instead of the label. */
  keywords: string[];
  route: string;
  steps?: string[];
  target?: string;
  find?: string;
  open?: FeatureOpen;
}

export const FEATURES: FeatureEntry[] = [
  // —— 开始 ——
  { id: 'setup', label: '开始（使用引导）', where: '开始', route: 'setup', summary: '第一次用时按步骤准备：选应用、配模型、导资料、试答、开始接待，做完自动打钩。', keywords: ['开始', '引导', '新手', '第一次', '上手', '教程', '准备', '五步', '怎么开始', '检查一遍', '准备项'] },
  { id: 'setup.mac-permissions', label: 'Mac 权限：屏幕录制与辅助功能', where: '开始', route: 'setup', find: 'Mac 第一次使用', summary: 'Mac 上要允许「屏幕录制」（看你选的窗口）和「辅助功能」（点按和打字）。', keywords: ['屏幕录制', '录屏', '辅助功能', '权限', '系统弹窗', '允许', '看不到屏幕', 'mac', '隐私与安全性', '录屏权限'] },

  // —— 知识 ——
  { id: 'knowledge', label: '知识', where: '知识', route: 'knowledge', summary: '把产品说明、价格表、常见问题导进来，审核启用后咔哒照着回答客户。', keywords: ['知识库', '资料', '业务资料', '导入资料', 'faq', '常见问题', '产品说明', '价格表'] },
  { id: 'knowledge.quick-import', label: '导入与试答', where: '知识', route: 'knowledge', steps: ['导入与试答'], summary: '拖入资料、自动整理，然后用客户真会问的问题试答。', keywords: ['拖进来', '上传资料', '一键导入', '快速导入', '整理资料'] },
  { id: 'knowledge.practice', label: '试答一个问题', where: '知识 · 导入与试答', route: 'knowledge/practice', target: 'coach-practice', summary: '写一句客户会问的话让咔哒试答，对照资料标记答对或要修改；试答不会给客户发消息。', keywords: ['试答', '测试回答', '答得对不对', '演练', '问一下试试', '回答不对', '答错了', '纠正回答'] },
  { id: 'knowledge.templates', label: '行业样板', where: '知识', route: 'knowledge/templates', target: 'industry-templates', summary: '选一个接近你生意的行业样板问答，把【】里换成自己的信息再审核启用。', keywords: ['样板', '模板', '行业', '示例问答', '没有资料', '从零开始'] },
  { id: 'knowledge.manage', label: '管理资料（审核、启用、编辑）', where: '知识 · 管理资料', route: 'knowledge/import', target: 'knowledge-import', summary: '导入文件、预览核对、批量审核启用；改过的知识要再审核才会用。', keywords: ['审核知识', '启用知识', '待审核', '编辑知识', '删除知识', '停用知识', '上传文件', 'pdf', 'word', 'excel', '文档'] },
  { id: 'knowledge.pack', label: '导出 / 导入知识包', where: '知识 · 管理资料', route: 'knowledge/import', find: '导出知识包|导入知识包', summary: '把整套知识导出成一个文件，在另一台电脑导入，多台电脑共用一套知识。', keywords: ['知识包', '换电脑', '多台电脑', '共享知识', '导出知识', '复制知识'] },
  { id: 'knowledge.learning', label: '从已审核的回复中学习', where: '知识 · 管理资料', route: 'knowledge/import', steps: ['进阶：从已审核的回复中持续学习'], find: '进阶：从已审核的回复中持续学习', summary: '把你确认过的问答提炼成新知识或流程候选，审核后才启用。', keywords: ['学习', '自动学习', '越用越聪明', '沉淀', '提炼'] },
  { id: 'knowledge.gaps', label: '待补充知识（没答上来的问题）', where: '知识', route: 'knowledge', steps: ['导入与试答'], find: '待补充知识', summary: '客户问过、咔哒没答上来的问题，填一句答案就存成知识。', keywords: ['没答上来', '不会回答', '缺资料', '补充知识', '答不上', '问题清单'] },
  { id: 'knowledge.add', label: '添加知识', where: '知识', route: 'knowledge', find: '添加知识', summary: '手动写一条问题和答案。新知识默认待审核。', keywords: ['手动添加', '新增知识', '写一条', '加一条'] },
  { id: 'knowledge.playbooks', label: '预置话术包', where: '知识', route: 'knowledge', find: '预置话术包', summary: '一键载入常见行业的沟通话术，载入后同样要审核。', keywords: ['话术', '话术包', 'sop', '销售话术', '售后话术'] },
  { id: 'knowledge.repos', label: '自动更新的知识来源（GitHub 仓库 / 文件夹）', where: '知识 · 导入与试答', route: 'knowledge', steps: ['导入与试答'], target: 'knowledge-repos', summary: '添加 GitHub 仓库（私有的也行）或电脑上的文件夹，选好要导入的文件夹和用途；咔哒不忙时每 6 小时自动更新，也可以点「立即更新」。', keywords: ['github', 'GitHub 仓库', '私有仓库', '仓库', '自动更新', '定期更新', '同步知识', '立即更新', 'git', '知识库自动同步', '写法参考'] },
  { id: 'knowledge.sources', label: '我的资料源（电脑文件夹）', where: '知识 · 我的资料源', route: 'knowledge/sources', summary: '资料在电脑文件夹里时直接选那个文件夹，读取整理后审核；原文件改了要再整理。', keywords: ['文件夹', '本地文件夹', '资料源', '同步文件夹', '自动读取'] },
  { id: 'knowledge.drives', label: '连接网盘', where: '知识 · 连接网盘', route: 'knowledge/drives', summary: '连接网盘账号选文件；也可以先读电脑上已同步的文件夹。', keywords: ['网盘', '云盘', '百度网盘', '阿里云盘', 'onedrive', '坚果云'] },
  { id: 'knowledge.connections', label: '连接在线知识库（飞书 / Notion）', where: '知识 · 连接在线知识库', route: 'knowledge/connections', target: 'knowledge-connections', summary: '按页面步骤连接飞书或 Notion；没有管理员权限就先导出文件再导入。', keywords: ['飞书', 'notion', '在线文档', '语雀', '云文档', '知识库同步'] },
  { id: 'knowledge.lab', label: '查找测试（批量演练）', where: '知识 · 查找测试', route: 'knowledge', steps: ['?更多方式', '查找测试'], summary: '一次测很多问题，看咔哒能不能找到对的资料。', keywords: ['批量测试', '评估', '检索测试', '找不到资料', '多个问题'] },

  // —— 接待 · 运行 ——
  { id: 'reception', label: '接待', where: '接待', route: 'desktop-replies', summary: '自动接待客户的地方：开始/暂停接待、待审核的回复、转人工的客户都在这里。', keywords: ['自动接待', '自动回复', '客服', '接客', '接待页'] },
  { id: 'reception.run', label: '开始 / 暂停接待', where: '接待 · 运行', route: 'desktop-replies', steps: ['运行'], find: '持续运行状态', summary: '看接待是否在运行、今日收到和已回复多少，点「开始接待」「暂停」「停止」。', keywords: ['开始接待', '暂停接待', '继续接待', '停止接待', '启动', '运行状态', '今日收到', '已回复', '开不起来', '不回复了'] },
  { id: 'reception.emergency-stop', label: '紧急停止全部任务', where: '接待', route: 'desktop-replies', find: '紧急停止', summary: '咔哒操作不对时立刻停下所有动作，把键盘鼠标还给你；快捷键在「设置 → 快捷键」。', keywords: ['急停', '紧急停止', '马上停', '立刻停', '乱发', '失控', '停下来', '别动了'] },
  { id: 'reception.pending-review', label: '待审核的回复', where: '接待 · 运行', route: 'desktop-replies', steps: ['运行'], find: '待审核的回复|持续运行状态', summary: '开了「发送前审核」时，拟好的回复先在这里和小浮窗等你点「发送」「改一下」或「跳过」。', keywords: ['审核回复', '确认发送', '等我确认', '改一下再发', '跳过', '待确认'] },
  { id: 'reception.takeover-inbox', label: '待处理客户（转人工）', where: '接待 · 运行', route: 'desktop-replies', steps: ['运行'], find: '待处理客户', summary: '咔哒拿不准、客户发图片或要你拍板时转给你；你回复完点「我处理好了」。', keywords: ['转人工', '需要我处理', '拿不准', '处理好了', '人工处理', '客户在等'] },
  { id: 'reception.takeover', label: '人工接管（这个人我自己回）', where: '接待 · 运行', route: 'desktop-replies', steps: ['运行', '会话人工接管'], find: '会话人工接管', summary: '勾选某个会话「人工接管」，咔哒就不再回这个人，直到你取消勾选。', keywords: ['我自己回', '暂停这个人', '别回他', '不要回这个人', '接管', '手动回复', '单独暂停', '某个客户不回'] },
  { id: 'reception.run-details', label: '运行细节与用量', where: '接待 · 运行', route: 'desktop-replies', steps: ['运行', '运行细节'], find: '运行细节', summary: '本次接待检查了几轮、每天调用模型多少次、平均多少秒；排查问题时看。', keywords: ['用量', '调用次数', '排查', '平均秒数', '花了多少', '模型用量'] },
  { id: 'reception.jobs', label: '回复任务记录', where: '接待 · 运行', route: 'desktop-replies', steps: ['运行'], find: '回复任务', summary: '每条来信和回复的记录，可筛选待处理和已完成。', keywords: ['回复记录', '发了什么', '历史回复', '记录', '已完成', '回了啥'] },

  // —— 接待 · 接待设置 ——
  { id: 'reception.settings', label: '接待设置', where: '接待 · 接待设置', route: 'desktop-replies', steps: ['接待设置'], find: '接待设置', summary: '选聊天应用、接待范围、语气、发送前审核、接待时段和管理员联系人。', keywords: ['接待配置', '设置接待'] },
  { id: 'reception.app', label: '聊天应用', where: '接待 · 接待设置', route: 'desktop-replies', steps: ['接待设置'], find: '聊天应用', summary: '选咔哒接待哪个聊天软件。', keywords: ['选应用', '换软件', '哪个软件', '聊天软件', '换应用'] },
  { id: 'reception.scope', label: '接待范围（回哪些会话）', where: '接待 · 接待设置', route: 'desktop-replies', steps: ['接待设置'], target: 'reply-conversations', summary: '自动接待所有新消息，或只接待指定的会话；群聊要单独打开。', keywords: ['群聊', '只回个人', '指定会话', '接待谁', '回群消息', '全部新消息'] },
  { id: 'reception.group-mingle', label: '混群（在群里帮你露脸）', where: '接待 · 接待设置', route: 'desktop-replies', steps: ['接待设置'], target: 'group-mingle', summary: '咔哒在没设免打扰的群里偶尔接一句正在聊的话，一天只说几句，不发链接广告、不谈价格；不想碰的群设成「不管」。', keywords: ['混群', '群里露脸', '群聊曝光', '活跃群', '在群里说话', '接话', '群里帮我说', '冒泡', '刷存在感', '群类型'] },
  { id: 'reception.exclude', label: '不接待的会话', where: '接待 · 接待设置', route: 'desktop-replies', steps: ['接待设置'], find: '不接待的会话', summary: '每行写一个完整会话名，这些人咔哒一律不回。', keywords: ['黑名单', '排除名单', '不回谁', '屏蔽', '家人不回', '排除'] },
  { id: 'reception.persona', label: '人设与语气', where: '接待 · 接待设置', route: 'desktop-replies', steps: ['接待设置'], find: '人设与语气', summary: '选专业、亲切或简短，填店名和一句自我介绍，所有回复按这个人设。', keywords: ['语气', '店名', '自我介绍', '口吻', '亲切', '专业', '简短', '说话方式', '人设'] },
  { id: 'reception.review-mode', label: '发送前审核（审核模式）', where: '接待 · 接待设置', route: 'desktop-replies', steps: ['接待设置'], find: '发送前审核', summary: '选不审核、只审核退款/投诉/议价、审核新客户，或每条都先给你看。', keywords: ['审核模式', '先给我看', '不要直接发', '确认后再发', '退款', '投诉', '议价', '人工确认'] },
  { id: 'reception.hours', label: '接待时段', where: '接待 · 接待设置', route: 'desktop-replies', steps: ['接待设置'], find: '接待时段', summary: '只在设定的时间里自动接待，按客服时区计算。', keywords: ['上班时间', '营业时间', '晚上不回', '几点到几点', '工作时间', '夜间'] },
  { id: 'reception.admin', label: '管理员联系人（异常通知）', where: '接待 · 接待设置', route: 'desktop-replies', steps: ['接待设置'], find: '管理员联系人', summary: '填你的另一个聊天账号：需要人工、额度不足、每日小结都发给它，也能远程发指令。', keywords: ['管理员', '通知我', '异常通知', '远程控制', '老板号', '提醒发给谁', '远程指令', '暗号'] },
  { id: 'reception.more', label: '更多接待设置', where: '接待 · 接待设置', route: 'desktop-replies', steps: ['接待设置', '更多设置（一般不用改）'], find: '更多设置', summary: '执行模式、输入方式、语言、验证器、小结周报、时区、追问、关键词规则等。', keywords: ['高级接待设置', '其他设置'] },
  { id: 'reception.executor', label: '执行模式（软件 / 硬件）', where: '接待 · 接待设置 · 更多设置', route: 'desktop-replies', steps: ['接待设置', '更多设置（一般不用改）'], target: 'reply-executor', summary: '软件模式用本机键鼠，不用买硬件；硬件模式通过配套的皮卡操作。', keywords: ['软件模式', '硬件模式', '键鼠', '皮卡模式', '执行方式'] },
  { id: 'reception.input-method', label: '文字输入方式', where: '接待 · 接待设置 · 更多设置', route: 'desktop-replies', steps: ['接待设置', '更多设置（一般不用改）'], find: '文字输入方式', summary: '回复是整段粘贴还是逐字输入。', keywords: ['粘贴', '逐字输入', '打字方式', '输入法', '打字太慢'] },
  { id: 'reception.market', label: '当前客户市场（国内 / 海外）', where: '接待 · 接待设置 · 更多设置', route: 'desktop-replies', steps: ['接待设置', '更多设置（一般不用改）'], find: '当前客户市场', summary: '国内和海外价格分开时，告诉咔哒当前客户是哪边的。', keywords: ['国内', '海外', '外贸', '市场', '价格分开', '国际'] },
  { id: 'reception.language', label: '回复语言', where: '接待 · 接待设置 · 更多设置', route: 'desktop-replies', steps: ['接待设置', '更多设置（一般不用改）'], find: '回复语言', summary: '设定回复用什么语言。', keywords: ['英文回复', '语言', '外语', '中文回复', '多语言'] },
  { id: 'reception.authenticator', label: '手机验证器（远程指令）', where: '接待 · 接待设置 · 更多设置', route: 'desktop-replies', steps: ['接待设置', '更多设置（一般不用改）'], find: '手机验证器', summary: '远程让咔哒替你发话的指令要带验证器上的 6 位数，防止别人冒充管理员。', keywords: ['验证码', '两步验证', '动态码', '6位数', '六位数', '防冒充', 'touch id'] },
  { id: 'reception.summary', label: '每日小结与周报', where: '接待 · 接待设置 · 更多设置', route: 'desktop-replies', steps: ['接待设置', '更多设置（一般不用改）'], find: '每日小结时间|周报', summary: '每天、每周固定时间把接待小结发到管理员联系人。', keywords: ['日报', '周报', '小结', '统计发给我', '每天汇报'] },
  { id: 'reception.timezone', label: '客服所在时区', where: '接待 · 接待设置 · 更多设置', route: 'desktop-replies', steps: ['接待设置', '更多设置（一般不用改）'], find: '客服所在时区', summary: '接待时段和小结时间按这个时区算。', keywords: ['时区', '海外时间', '时差'] },
  { id: 'reception.intent-model', label: '意图路由模型', where: '接待 · 接待设置 · 更多设置', route: 'desktop-replies', steps: ['接待设置', '更多设置（一般不用改）'], find: '意图路由模型', summary: '判断客户在问什么、该查哪些资料用的模型，一般不用改。', keywords: ['意图识别', '路由', '分类模型'] },
  { id: 'reception.unattended', label: '无人值守（自动恢复接待）', where: '接待 · 接待设置 · 更多设置', route: 'desktop-replies', steps: ['接待设置', '更多设置（一般不用改）'], find: '无人值守', summary: '电脑重启、软件更新或出小问题后自动恢复接待；补回 12 小时内没回的消息。', keywords: ['重启后恢复', '自动恢复', '没人看着', '晚上也接待', '补回消息', '睡觉', '自动重启'] },
  { id: 'reception.light-model', label: '省钱：简单识别用便宜模型', where: '接待 · 接待设置 · 更多设置', route: 'desktop-replies', steps: ['接待设置', '更多设置（一般不用改）'], find: '省钱', summary: '找会话、读列表这些简单活用便宜模型，读聊天和写回复仍用主模型。', keywords: ['便宜模型', '省钱', '降低费用', '省token', '太贵', '费用高'] },
  { id: 'reception.followup', label: '追问（客户没回时）', where: '接待 · 接待设置 · 更多设置', route: 'desktop-replies', steps: ['接待设置', '更多设置（一般不用改）'], find: '追问', summary: '我们回复后客户一段时间没回，自动追问一次。', keywords: ['客户没回', '跟进', '催一下', '再问一次', '自动跟进'] },
  { id: 'reception.media', label: '图片 / 语音 / 文件的固定回复', where: '接待 · 接待设置 · 更多设置', route: 'desktop-replies', steps: ['接待设置', '更多设置（一般不用改）'], find: '图片 / 语音 / 文件', summary: '客户发图片、语音、文件或视频时先回这一句，再转给你。', keywords: ['图片', '语音', '文件', '视频', '看不懂图片', '发图片'] },
  { id: 'reception.friends', label: '新好友（自动通过申请）', where: '接待 · 接待设置 · 更多设置', route: 'desktop-replies', steps: ['接待设置', '更多设置（一般不用改）'], find: '新好友', summary: '自动通过好友申请并发招呼语，每天有上限。', keywords: ['好友申请', '加好友', '通过好友', '招呼语', '新客户加我'] },
  { id: 'reception.keywords', label: '关键词规则（不走模型）', where: '接待 · 接待设置 · 更多设置', route: 'desktop-replies', steps: ['接待设置', '更多设置（一般不用改）'], find: '关键词规则', summary: '客户消息命中关键词时固定回复、直接转人工或打标签。', keywords: ['固定回复', '关键词', '自动转人工', '打标签', '敏感词', '触发词'] },
  { id: 'reception.rotation', label: '多账号轮巡', where: '接待 · 接待设置 · 更多设置', route: 'desktop-replies', steps: ['接待设置', '更多设置（一般不用改）'], find: '多账号轮巡', summary: '勾选两个以上聊天窗口，按分钟轮流接待。', keywords: ['多个账号', '两个号', '轮流', '多开', '多账号'] },
  { id: 'reception.human-pause', label: '人工接管后静默', where: '接待 · 接待设置 · 更多设置', route: 'desktop-replies', steps: ['接待设置', '更多设置（一般不用改）'], find: '人工接管后静默', summary: '你亲自回了某个会话后，咔哒对这个会话静默多少分钟再接手。', keywords: ['我回了之后', '静默', '多久接手', '我自己回过', '抢着回'] },
  { id: 'reception.target', label: '指定聊天窗口（选填）', where: '接待 · 接待设置 · 更多设置', route: 'desktop-replies', steps: ['接待设置', '更多设置（一般不用改）'], target: 'reply-target-setup', summary: '不选也行，开始时咔哒会自己找聊天窗口。', keywords: ['指定窗口', '固定窗口'] },

  // —— 接待 · 模型与回复 ——
  { id: 'reception.reply-mode', label: '回复方式（自动发送 / 人工复制）', where: '接待 · 模型与回复', route: 'desktop-replies', steps: ['模型与回复'], find: '回复方式', summary: '选直接自动发出，还是只写好回复给你复制。', keywords: ['自动发送', '只写草稿', '人工复制', '只写不发', '直接发出', '草稿模式'] },
  { id: 'reception.knowledge-scope', label: '回复参考哪些知识', where: '接待 · 模型与回复', route: 'desktop-replies', steps: ['模型与回复'], find: '限定检索范围|选择知识|回复方式与上下文', summary: '限定回复时只查哪些知识。', keywords: ['选知识', '检索范围', '只用部分资料', '参考资料'] },
  { id: 'reception.workflow', label: '工作流程（客服风格）', where: '接待 · 模型与回复', route: 'desktop-replies', steps: ['模型与回复'], find: '工作流程', summary: '选一套写好的工作方式，让回复保持统一标准。', keywords: ['客服风格', '话术风格', '工作方式', '回复风格'] },
  { id: 'reception.chat-experience', label: '回复场景', where: '接待 · 模型与回复', route: 'desktop-replies', steps: ['模型与回复'], find: '聊天体验场景|回复场景', summary: '选回复所处的聊天场景。', keywords: ['场景', '聊天场景'] },
  { id: 'reception.rate', label: '扫描间隔与每小时回复上限', where: '接待 · 模型与回复 · 更多设置', route: 'desktop-replies', steps: ['模型与回复', '更多设置（一般不用改）'], find: '扫描间隔', summary: '多久看一次新消息，以及每小时最多回多少条。', keywords: ['多久看一次', '频率', '回复上限', '每小时', '太慢', '回得慢', '间隔'] },
  { id: 'reception.model-protocol', label: '模型协议与分工', where: '接待 · 模型与回复 · 更多设置', route: 'desktop-replies', steps: ['模型与回复', '更多设置（一般不用改）', '高级：模型协议与分工'], find: '高级：模型协议与分工', summary: '通常由「设置」里的模型自动决定，无需改。', keywords: ['协议', '分工', 'gemini 原生'] },

  // —— 接待 · 窗口与校准 ——
  { id: 'reception.window', label: '选聊天窗口', where: '接待 · 窗口与校准', route: 'desktop-replies', steps: ['窗口与校准'], find: '选聊天窗口', summary: '一般不用选；开了好几个窗口、想指定其中一个时在这里选。', keywords: ['选窗口', '没看到聊天窗口', '找不到窗口', '换窗口', '窗口不对', '识别不到'] },
  { id: 'reception.calibrate', label: '窗口区域校准', where: '接待 · 窗口与校准', route: 'desktop-replies', steps: ['窗口与校准'], find: '窗口区域校准', summary: '咔哒总是看错或点错位置时，拖一下列表、标题、消息、输入框的位置。', keywords: ['校准', '点错位置', '看错', '区域', '调整位置', '点不准'] },
  { id: 'reception.calibrate-manual', label: '手动微调校准', where: '接待 · 窗口与校准', route: 'desktop-replies', steps: ['窗口与校准', '手动微调'], find: '手动微调', summary: '用数字精确调整每块区域，一般不用。', keywords: ['微调', '精确调整', '坐标'] },

  // —— 数据 ——
  { id: 'data', label: '接待数据', where: '数据', route: 'data', summary: '用这台电脑上的接待记录统计，不上传任何数据。', keywords: ['统计', '报表', '数据', '多少客户', '接待量', '效果'] },
  { id: 'data.speed', label: '回复速度', where: '数据', route: 'data', find: '回复速度', summary: '平均多久回复客户。', keywords: ['回复多快', '响应时间', '速度'] },
  { id: 'data.hours', label: '客户什么时候来', where: '数据', route: 'data', find: '客户什么时候来', summary: '客户来信的时段分布。', keywords: ['高峰', '时段分布', '几点最多'] },
  { id: 'data.daily', label: '每天接待', where: '数据', route: 'data', find: '每天接待', summary: '每天收到和回复的数量。', keywords: ['每日接待', '每天多少'] },
  { id: 'data.gaps', label: '知识库还缺什么', where: '数据', route: 'data', find: '知识库还缺什么', summary: '经常答不上的问题，提示该补哪些资料。', keywords: ['缺什么资料', '答不上的问题'] },

  // —— 设置 ——
  { id: 'settings', label: '设置', where: '设置', route: 'settings', summary: '一键配置模型、显示方式、快捷键、主题色、授权、备份。', keywords: ['设置页', '选项', '偏好'] },
  { id: 'settings.phone', label: '用手机接待（实验）', where: '设置 · 实验功能', route: 'settings', steps: ['实验功能'], target: 'phone-settings', find: '用手机接待', summary: '用数据线连上 Android 手机，咔哒在手机里收消息、回复（实验）；支持手机上的应用分身，电脑照常用', keywords: ['手机', '安卓', 'Android', 'adb', '用手机回复', '手机接待', '多台手机'] },
  { id: 'settings.update', label: '版本与更新', where: '设置', route: 'settings', find: '版本与更新', summary: '看当前版本、检查并安装更新。', keywords: ['更新', '升级', '新版本', '版本号', '检查更新'] },
  { id: 'settings.model', label: '一键配置模型', where: '设置', route: 'settings', find: '一键配置模型', summary: '用咔哒内置模型、导入配置文件，或选服务商粘贴 Key 一键配好。', keywords: ['配模型', 'api key', 'key', '密钥', '填key', '模型配置', '免费模型', '换模型', '服务商'] },
  { id: 'settings.builtin-model', label: '咔哒内置模型', where: '设置 · 一键配置模型', route: 'settings', find: '用咔哒内置模型', summary: '不用填任何东西，点一下就能用；用量从账户余额扣。', keywords: ['内置', '不用填', '最省事', '余额'] },
  { id: 'settings.import-config', label: '导入模型配置文件', where: '设置 · 一键配置模型', route: 'settings', find: '导入配置文件', summary: '服务人员给的配置文件或配置文字，选中或粘贴就配好。', keywords: ['配置文件', '服务人员给的', '导入配置', '粘贴配置'] },
  { id: 'settings.display-mode', label: '显示方式（小浮窗 / 侧边面板 / 后台）', where: '设置', route: 'settings', find: '显示方式', summary: '咔哒在屏幕上占多大地方；小浮窗可以贴边自动隐藏，接待照常运行。', keywords: ['小浮窗', '浮窗', '侧边面板', '后台运行', '窗口太大', '贴边隐藏', '挡住了', '缩小'] },
  { id: 'settings.shortcuts', label: '快捷键', where: '设置', route: 'settings', find: '快捷键', summary: '暂停/继续和急停的组合键，在任何软件里都能用。', keywords: ['暂停快捷键', '急停快捷键', '热键', '组合键', '键盘'] },
  { id: 'settings.theme', label: '主题色', where: '设置', route: 'settings', find: '主题色', summary: '换界面颜色，马上生效。', keywords: ['换颜色', '皮肤', '颜色', '配色', '紫色', '界面颜色', '换肤'] },
  { id: 'settings.icon', label: '图标款式', where: '设置', route: 'settings', find: '图标款式', summary: '换程序坞 / 任务栏和小浮窗上的图标。', keywords: ['换图标', '程序图标', '任务栏图标', 'logo', '图标'] },
  { id: 'settings.vision-model', label: '画面识别模型', where: '设置 · 高级', route: 'settings/vision', steps: ['?高级：用自己的模型'], target: 'vision-model-settings', summary: '负责看懂聊天窗口的模型，要能看图片；可以和写回复的模型不同。', keywords: ['识图', '看屏幕', '视觉模型', '看图模型', '识别模型', '读屏'] },
  { id: 'settings.model-pool', label: '自动挑选模型', where: '设置 · 高级', route: 'settings/reply', steps: ['?高级：用自己的模型'], target: 'model-pool-settings', summary: '找出同一服务里能看图的其他模型按速度轮流用，被限流的先歇着。', keywords: ['自动换模型', '轮流用模型', '限流', '多个模型', '模型太慢', '自动选模型'] },
  { id: 'settings.backup-model', label: '备用模型', where: '设置 · 高级', route: 'settings/reply', steps: ['?高级：用自己的模型'], target: 'backup-model-settings', summary: '主模型被限流、没响应或连不上时自动换用另一家服务，过几分钟再试回主模型。', keywords: ['限流', '换模型', '模型挂了', '模型不响应', '429', '连不上', '备份模型', '第二个模型', '调用太频繁', '模型繁忙'] },
  { id: 'settings.reply-model', label: '回复生成模型（自己的文字模型）', where: '设置 · 高级', route: 'settings/reply', steps: ['?高级：用自己的模型'], target: 'reply-model-settings', summary: '填自己的文字模型（接口地址、模型名称、API Key），用于写客户回复。', keywords: ['文字模型', 'deepseek', '写回复的模型', '自己的模型', '接口地址', '温度', '发挥程度', '移除密钥'] },
  { id: 'settings.workspace', label: '工作空间名称与称呼', where: '设置', route: 'settings', find: '工作空间', summary: '改左上角的工作空间名称和你的称呼。', keywords: ['改名字', '名称', '称呼', '我的名字', '店铺名'] },
  { id: 'settings.license', label: '软件授权（卡密）', where: '设置', route: 'settings', find: '软件授权', summary: '看授权状态和本机机器码，填写卡密激活。', keywords: ['卡密', '授权码', '机器码', '激活', '授权状态', '商业版'] },
  { id: 'settings.backup', label: '备份与迁移', where: '设置', route: 'settings', find: '备份与迁移', summary: '导出或恢复任务、知识、流程；备份不含密钥和截图。', keywords: ['导出', '备份', '恢复备份', '换电脑', '迁移', '数据导出'] },
  { id: 'license', label: '购买与激活（授权窗口）', where: '顶栏 · 软件授权', route: 'settings', open: 'license', summary: '看软件试用还剩几次，选套餐付款，填写授权码激活。', keywords: ['购买', '付款', '续费', '套餐', '授权码', '试用次数', '用完了', '激活码', '买', '价格'] },

  // —— 帮助 ——
  { id: 'help.diagnostics', label: '帮助与日志（求助包）', where: '顶栏', route: 'settings', open: 'diagnostics', summary: '一键生成求助包，发给咔哒客服；不含客户名字、聊天内容、密钥。', keywords: ['求助', '求助包', '日志', '诊断', '出问题了', '报错', '联系客服', '帮助'] },
  { id: 'help.feedback', label: '反馈问题', where: '顶栏', route: 'settings', open: 'feedback', summary: '写一句刚才发生了什么，附上诊断日志发给负责人。', keywords: ['反馈', '提意见', 'bug', '建议', '投诉软件'] },
  { id: 'help.manual', label: '使用手册（常见问题）', where: '顶栏 · 左侧导航', route: 'manual', summary: '像说明书一样从头教你用咔哒：第一步、导资料、开始接待，常见问题放在最前面，每个版本都会更新。', keywords: ['使用手册', '手册', '说明书', '说明', '用户手册', '常见问题', 'faq', '新手教程', '教程', '怎么用', '更新记录', '更新了什么', '版本说明'] },
  { id: 'help.assistant', label: '问咔哒怎么用', where: '帮助', route: 'settings', open: 'assistant', summary: '用一句话问怎么用咔哒，AI 回答并带你去对应的地方。', keywords: ['ai 助手', '问问', '怎么用', '不会用', '使用帮助', '问ai'] },

  // —— 插件 ——
  { id: 'plugins', label: '插件（插件中心）', where: '插件', route: 'plugins', summary: '装话术包、知识包、工具和自动化，让咔哒工作台做更多事；装之前用大白话列出权限，你同意才装，每一步都能撤销。', keywords: ['插件', '插件中心', '扩展', '装插件', '安装插件', '话术包', '工具插件', '外部工具', '自动化', '规则', '提醒规则', '一切皆插件'] },
  { id: 'plugins.automation', label: '自动化规则（当…就…）', where: '插件', route: 'plugins', find: '已装的插件', summary: '不写代码定规则：新客户来消息、提到关键词、每天某时、转人工时，就提醒你、发给管理员聊天、调用工具或记到本地表格。', keywords: ['自动化', '当就', '触发', '关键词提醒', '提到就提醒', '定时提醒', '记表格', '本地表格'] },
  { id: 'plugins.evolution', label: '每周进化建议', where: '插件', route: 'plugins', find: '每周进化建议', summary: '每周看一次本机接待记录，建议补知识缺口、把你改过的说法设为默认、给常转人工的词开提醒；点一下采纳，可撤销。', keywords: ['进化', '进化建议', '自我进化', '改进建议', '优化建议', '每周建议'] },

  // —— 开放 ——
  { id: 'open', label: '开放（给其他 AI 工具调用）', where: '开放', route: 'open', summary: '把知识检索、试答和接待控制通过 MCP 开放给 Claude、Codex、Cursor 等工具。', keywords: ['mcp', 'claude', 'codex', 'cursor', 'antigravity', 'workbuddy', '接口', '开发者', 'api', '其他ai'] },
  { id: 'open.mcp', label: 'MCP 服务开关', where: '开放', route: 'open', find: 'MCP 服务', summary: '打开或关闭本机 MCP 服务，只监听本机。', keywords: ['开启mcp', '服务开关', '本机服务'] },
  { id: 'open.tools', label: '开放的工具', where: '开放', route: 'open', find: '开放的工具', summary: '逐个勾选允许其他 AI 工具使用的功能。', keywords: ['工具列表', '权限', '允许哪些'] },
  { id: 'open.connect', label: '接入方式（复制配置）', where: '开放', route: 'open', find: '接入方式', summary: '复制对应 AI 工具的配置粘贴过去即可。', keywords: ['配置粘贴', '本机桥', '怎么接入', '复制配置'] },
  { id: 'open.clients', label: '客户端（每个工具单独密钥）', where: '开放', route: 'open', find: '客户端', summary: '给每个 AI 工具单独一把密钥，删掉只影响这一个工具。', keywords: ['客户端密钥', '多个工具', '单独密钥'] },
  { id: 'open.app-tasks', label: '应用操作（试验）', where: '开放', route: 'open', target: 'open-app-tasks', summary: 'AI 工具提交的任务要你批准；目前只有合成演练，不操作任何应用。', keywords: ['应用任务', '批准任务', '演练'] },
  { id: 'open.changes', label: '修改设置与修改记录', where: '开放', route: 'open', find: '修改设置', summary: '其他 AI 工具改设置的开关和最近 50 条修改记录。', keywords: ['修改记录', '谁改了设置'] },

  // —— 硬件与其他 ——
  { id: 'hardware', label: '咔哒硬件-皮卡', where: '硬件', route: 'hardware', summary: '用 USB 数据线连接配套皮卡，点「一键识别」；软件模式不需要它。', keywords: ['皮卡', 'usb', '硬件', 'pico', '连接设备', '数据线'] },
  { id: 'hardware.connect', label: '连接皮卡', where: '硬件', route: 'hardware', find: '连接皮卡', summary: '识别并连接皮卡，显示「已连接」即可。', keywords: ['识别皮卡', '一键识别', '连不上皮卡'] },
  { id: 'hardware.firmware', label: '更新皮卡程序与测试', where: '硬件', route: 'hardware', find: '更新皮卡程序', summary: '更新皮卡里的程序并做输入测试。', keywords: ['固件', '烧录', '刷机', '硬件测试'] },
  { id: 'moments', label: '每天自动写营销内容', where: '营销', route: 'moments', summary: '咔哒每天按你的资料写几条营销文案、从图片文件夹挑图，你审核通过的才按时发。', keywords: ['营销', '朋友圈', '每天朋友圈', '发圈', '每天发圈', '定时发', '自动发营销内容', '营销配图', '审核营销'] },
  { id: 'moments.settings', label: '营销：每天几条、审核和发布时间', where: '营销 · 设置', route: 'moments', find: '设置', summary: '设每天发几条、几点一起审核、每条几点发，每两条至少隔多久。', keywords: ['发布时间', '朋友圈发布时间', '时区', '北京时间', '审核时间', '每天几条', '发圈时间'] },
  { id: 'customers', label: '客户档案', where: '客户', route: 'customers', summary: '每位客户一份档案：行业、需求、预算、买过什么、聊到哪一步，按每条业务分开记，标着是客户说的还是咔哒推测的。', keywords: ['客户', '客户档案', '客户标签', '客户分类', '客户画像', '客户管理', 'crm', '买过什么', '客户资料', '老客户'] },
  { id: 'customers.follow', label: '今日跟进清单', where: '客户 · 今日跟进', route: 'customers', find: '今日跟进', summary: '每天告诉你该跟进谁、为什么，写好消息等你点「发送」。', keywords: ['跟进', '跟进清单', '回访', '复购', '续费提醒', '到期提醒', '催单'] },
  { id: 'customers.broadcast', label: '按分组发消息', where: '客户 · 按分组发消息', route: 'customers', find: '按分组发消息', summary: '给一组客户每人写一条，你逐条确认后慢慢发。', keywords: ['群发', '分组', '批量发消息', '通知老客户', '活动通知'] },
  { id: 'customers.import', label: '导入客户表', where: '客户 · 导入', route: 'customers', find: '导入', summary: '把已有的客户表、订单表（Excel 或 CSV）导进来，名字或电话一样的合并。', keywords: ['导入客户', '客户表', '订单表', 'excel导入', '导入订单'] },
  { id: 'customers.lines', label: '业务线', where: '客户 · 业务线', route: 'customers', find: '业务线', summary: '你有几条业务就建几条，每条有自己的产品、阶段和栏目。', keywords: ['业务', '产品线', '多个业务', '多个产品', '阶段'] },
  { id: 'follow-up', label: '客户跟进与内容', where: '客户跟进与内容', route: 'chat_app-operations', summary: '用业务知识和你的表达风格写跟进消息和运营文案。', keywords: ['文案', '运营', '跟进客户', '营销内容', '写文案'] },
  { id: 'workflows', label: '工作流程', where: '工作流程', route: 'workflows', summary: '把你的工作方式写下来，让每份回复保持一致的标准。', keywords: ['流程', 'sop', '标准', '规范'] },
  { id: 'audit', label: '活动记录', where: '活动记录', route: 'audit', summary: '起草、审核、导入和设置修改的本地记录。', keywords: ['操作记录', '历史记录', '审计', '谁动了'] },
  { id: 'tasks', label: '任务中心', where: '任务中心', route: 'tasks', summary: '手动建的回复任务和草稿。', keywords: ['任务', '草稿', '新建任务'] },
];

export const FEATURE_IDS = new Set(FEATURES.map(f => f.id));
export const featureById = (id: string) => FEATURES.find(f => f.id === id);

/** Lowercase, drop spaces and punctuation, so 「API Key」「apikey」「换 颜色」 compare equal to their plain forms. */
export function normalize(text: string): string {
  return text.toLowerCase().normalize('NFKC').replace(/[\s·・，。、,.;；:：!！?？'"“”‘’（）()【】\[\]「」/\\|_\-–—>→▾]+/g, '');
}
const subsequence = (needle: string, hay: string) => { let i = 0; for (const ch of hay) if (ch === needle[i]) i++; return i === needle.length; };
const bigrams = (s: string) => { const out = new Set<string>(); for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2)); return out; };
const dice = (a: string, b: string) => { if (a.length < 2 || b.length < 2) return 0; const x = bigrams(a), y = bigrams(b); let n = 0; for (const g of x) if (y.has(g)) n++; return 2 * n / (x.size + y.size); };
/** 「怎么」「如何」… carry no meaning for finding a feature. */
const FILLER = /怎么样|怎么办|怎么|如何|在哪里|在哪儿|在哪|哪里|设置一下|一下|可以|能不能|我想|我要|想要|请问|帮我|的|了|吗|呢|吧/g;

function scoreText(q: string, text: string, weight: number): number {
  const t = normalize(text);
  if (!t || !q) return 0;
  if (t === q) return 100 * weight;
  if (t.startsWith(q)) return 85 * weight;
  if (t.includes(q)) return 70 * weight;
  if (q.length >= 2 && t.length >= 2 && q.includes(t)) return (45 + Math.min(20, t.length * 5)) * weight;
  if (q.length >= 2 && subsequence(q, t)) return 40 * weight;
  if (t.length >= 2 && q.length > t.length && subsequence(t, q)) return 35 * weight;
  const d = dice(q, t);
  return d >= 0.5 ? 50 * d * weight : 0;
}

/** Fuzzy search over labels, keywords, breadcrumb and summary. Every space-separated word must match something. */
export function searchFeatures(query: string, limit = 8): FeatureEntry[] {
  const words = query.split(/\s+/).map(w => normalize(w)).filter(Boolean);
  const stripped = words.map(w => w.replace(FILLER, '') || w);
  if (!stripped.length) return [];
  const scored = FEATURES.map((f, index) => {
    let total = 0;
    for (const q of stripped) {
      const best = Math.max(scoreText(q, f.label, 1.2), ...f.keywords.map(k => scoreText(q, k, 1)), scoreText(q, f.where, 0.5), f.summary && q.length >= 2 && normalize(f.summary).includes(q) ? 30 : 0);
      if (!best) return { f, total: 0, index };
      total += best;
    }
    return { f, total, index };
  }).filter(x => x.total > 0);
  scored.sort((a, b) => b.total - a.total || a.index - b.index);
  return scored.slice(0, limit).map(x => x.f);
}
