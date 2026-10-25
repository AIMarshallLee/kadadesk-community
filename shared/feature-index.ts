/**
 * 搜索所有功能: every page, tab, section and setting an owner may look for, in plain words.
 */
export type FeatureOpen = 'diagnostics' | 'feedback' | 'assistant';
export interface FeatureEntry {
  id: string;
  label: string;
  /** Breadcrumb shown under the label, e.g. 「知识 · 导入与试答」. */
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
  { id: 'setup', label: '开始（使用引导）', where: '开始', route: 'setup', summary: '第一次用时按步骤准备：配模型、导资料、试答，做完自动打钩。', keywords: ['开始', '引导', '新手', '第一次', '上手', '教程', '准备', '怎么开始', '检查一遍', '准备项'] },

  // —— 知识 ——
  { id: 'knowledge', label: '知识', where: '知识', route: 'knowledge', summary: '把产品说明、价格表、常见问题导进来，审核启用后用于问答与起草回复。', keywords: ['知识库', '资料', '业务资料', '导入资料', 'faq', '常见问题', '产品说明', '价格表'] },
  { id: 'knowledge.quick-import', label: '导入与试答', where: '知识', route: 'knowledge', steps: ['导入与试答'], summary: '拖入资料、自动整理，然后用客户真会问的问题试答。', keywords: ['拖进来', '上传资料', '一键导入', '快速导入', '整理资料'] },
  { id: 'knowledge.practice', label: '试答一个问题', where: '知识 · 导入与试答', route: 'knowledge/practice', target: 'coach-practice', summary: '写一句客户会问的话让咔哒试答，对照资料标记答对或要修改；试答不会对外发消息。', keywords: ['试答', '测试回答', '答得对不对', '演练', '问一下试试', '回答不对', '答错了', '纠正回答'] },
  { id: 'knowledge.templates', label: '行业样板', where: '知识', route: 'knowledge/templates', target: 'industry-templates', summary: '选一个接近你生意的行业样板问答，把【】里换成自己的信息再审核启用。', keywords: ['样板', '模板', '行业', '示例问答', '没有资料', '从零开始'] },
  { id: 'knowledge.manage', label: '管理资料（审核、启用、编辑）', where: '知识 · 管理资料', route: 'knowledge/import', target: 'knowledge-import', summary: '导入文件、预览核对、批量审核启用；改过的知识要再审核才会用。', keywords: ['审核知识', '启用知识', '待审核', '编辑知识', '删除知识', '停用知识', '上传文件', 'pdf', 'word', 'excel', '文档'] },
  { id: 'knowledge.pack', label: '导出 / 导入知识包', where: '知识 · 管理资料', route: 'knowledge/import', find: '导出知识包|导入知识包', summary: '把整套知识导出成一个文件，在另一台电脑导入，多台电脑共用一套知识。', keywords: ['知识包', '换电脑', '多台电脑', '共享知识', '导出知识', '复制知识'] },
  { id: 'knowledge.learning', label: '从已审核的回复中学习', where: '知识 · 管理资料', route: 'knowledge/import', steps: ['进阶：从已审核的回复中持续学习'], find: '进阶：从已审核的回复中持续学习', summary: '把你确认过的问答提炼成新知识或流程候选，审核后才启用。', keywords: ['学习', '自动学习', '越用越聪明', '沉淀', '提炼'] },
  { id: 'knowledge.gaps', label: '待补充知识（没答上来的问题）', where: '知识', route: 'knowledge', steps: ['导入与试答'], find: '待补充知识', summary: '客户问过、咔哒没答上来的问题，填一句答案就存成知识。', keywords: ['没答上来', '不会回答', '缺资料', '补充知识', '答不上', '问题清单'] },
  { id: 'knowledge.add', label: '添加知识', where: '知识', route: 'knowledge', find: '添加知识', summary: '手动写一条问题和答案。新知识默认待审核。', keywords: ['手动添加', '新增知识', '写一条', '加一条'] },
  { id: 'knowledge.playbooks', label: '预置话术包', where: '知识', route: 'knowledge', find: '预置话术包', summary: '一键载入常见行业的沟通话术，载入后同样要审核。', keywords: ['话术', '话术包', 'sop', '销售话术', '售后话术'] },
  { id: 'knowledge.repos', label: '自动更新的知识来源（GitHub 仓库 / 文件夹）', where: '知识 · 导入与试答', route: 'knowledge', steps: ['导入与试答'], target: 'knowledge-repos', summary: '添加 GitHub 仓库（私有的也行）或电脑上的文件夹，选好要导入的文件夹和用途；后台自动更新，也可以点「立即更新」。', keywords: ['github', 'GitHub 仓库', '私有仓库', '仓库', '自动更新', '定期更新', '同步知识', '立即更新', 'git', '知识库自动同步', '写法参考'] },
  { id: 'knowledge.sources', label: '我的资料源（电脑文件夹）', where: '知识 · 我的资料源', route: 'knowledge/sources', summary: '资料在电脑文件夹里时直接选那个文件夹，读取整理后审核；原文件改了要再整理。', keywords: ['文件夹', '本地文件夹', '资料源', '同步文件夹', '自动读取'] },
  { id: 'knowledge.drives', label: '连接网盘', where: '知识 · 连接网盘', route: 'knowledge/drives', summary: '连接网盘账号选文件；也可以先读电脑上已同步的文件夹。', keywords: ['网盘', '云盘', '百度网盘', '阿里云盘', 'onedrive', '坚果云'] },
  { id: 'knowledge.connections', label: '连接在线知识库（飞书 / Notion）', where: '知识 · 连接在线知识库', route: 'knowledge/connections', target: 'knowledge-connections', summary: '按页面步骤连接飞书或 Notion；没有管理员权限就先导出文件再导入。', keywords: ['飞书', 'notion', '在线文档', '语雀', '云文档', '知识库同步'] },
  { id: 'knowledge.lab', label: '查找测试（批量演练）', where: '知识 · 查找测试', route: 'knowledge', steps: ['?更多方式', '查找测试'], summary: '一次测很多问题，看咔哒能不能找到对的资料。', keywords: ['批量测试', '评估', '检索测试', '找不到资料', '多个问题'] },

  // —— 客户 ——
  { id: 'customers', label: '客户档案', where: '客户', route: 'customers', summary: '每位客户一份档案：行业、需求、预算、买过什么、聊到哪一步，按每条业务分开记。', keywords: ['客户', '客户档案', '客户标签', '客户分类', '客户画像', '客户管理', 'crm', '买过什么', '客户资料', '老客户'] },
  { id: 'customers.follow', label: '今日跟进清单', where: '客户 · 今日跟进', route: 'customers', find: '今日跟进', summary: '每天告诉你该跟进谁、为什么，生成建议草稿供复制。', keywords: ['跟进', '跟进清单', '回访', '复购', '续费提醒', '到期提醒', '催单'] },
  { id: 'customers.import', label: '导入客户表', where: '客户 · 导入', route: 'customers', find: '导入', summary: '把已有的客户表、订单表（Excel 或 CSV）导进来，名字或电话一样的合并。', keywords: ['导入客户', '客户表', '订单表', 'excel导入', '导入订单'] },
  { id: 'customers.lines', label: '业务线', where: '客户 · 业务线', route: 'customers', find: '业务线', summary: '你有几条业务就建几条，每条有自己的产品、阶段和栏目。', keywords: ['业务', '产品线', '多个业务', '多个产品', '阶段'] },

  // —— 设置 ——
  { id: 'settings', label: '设置', where: '设置', route: 'settings', summary: '配置大模型、显示方式、快捷键、主题色、备份与迁移。', keywords: ['设置页', '选项', '偏好'] },
  { id: 'settings.model', label: '模型设置', where: '设置', route: 'settings', find: '一键配置模型', summary: '导入配置文件，或选服务商粘贴 Key 配置大模型。', keywords: ['配模型', 'api key', 'key', '密钥', '填key', '模型配置', '换模型', '服务商'] },
  { id: 'settings.import-config', label: '导入模型配置文件', where: '设置 · 模型设置', route: 'settings', find: '导入配置文件', summary: '导入团队的配置文件或配置文字，选中或粘贴就配好。', keywords: ['配置文件', '导入配置', '粘贴配置'] },
  { id: 'settings.display-mode', label: '显示方式（小浮窗 / 侧边面板 / 后台）', where: '设置', route: 'settings', find: '显示方式', summary: '咔哒在屏幕上占多大地方；小浮窗可以贴边自动隐藏。', keywords: ['小浮窗', '浮窗', '侧边面板', '后台运行', '窗口太大', '贴边隐藏', '挡住了', '缩小'] },
  { id: 'settings.shortcuts', label: '快捷键', where: '设置', route: 'settings', find: '快捷键', summary: '全局快捷键配置。', keywords: ['快捷键', '热键', '组合键', '键盘'] },
  { id: 'settings.theme', label: '主题色', where: '设置', route: 'settings', find: '主题色', summary: '换界面颜色，马上生效。', keywords: ['换颜色', '皮肤', '颜色', '配色', '紫色', '界面颜色', '换肤'] },
  { id: 'settings.icon', label: '图标款式', where: '设置', route: 'settings', find: '图标款式', summary: '换程序坞 / 任务栏和小浮窗上的图标。', keywords: ['换图标', '程序图标', '任务栏图标', 'logo', '图标'] },
  { id: 'settings.model-pool', label: '自动挑选模型', where: '设置 · 高级', route: 'settings/reply', steps: ['?高级：用自己的模型'], target: 'model-pool-settings', summary: '找出同一服务里可用的其他模型轮流使用。', keywords: ['自动换模型', '轮流用模型', '限流', '多个模型', '自动选模型'] },
  { id: 'settings.backup-model', label: '备用模型', where: '设置 · 高级', route: 'settings/reply', steps: ['?高级：用自己的模型'], target: 'backup-model-settings', summary: '主模型被限流、没响应或连不上时自动换用另一家服务，过几分钟再试回主模型。', keywords: ['限流', '换模型', '模型挂了', '模型不响应', '429', '连不上', '备份模型', '第二个模型', '调用太频繁', '模型繁忙'] },
  { id: 'settings.reply-model', label: '回复生成模型', where: '设置 · 高级', route: 'settings/reply', steps: ['?高级：用自己的模型'], target: 'reply-model-settings', summary: '配置文字模型（接口地址、模型名称、API Key），用于草稿生成与问答。', keywords: ['文字模型', 'deepseek', '写回复的模型', '自己的模型', '接口地址', '温度', '发挥程度', '移除密钥'] },
  { id: 'settings.workspace', label: '工作空间名称与称呼', where: '设置', route: 'settings', find: '工作空间', summary: '改左上角的工作空间名称和你的称呼。', keywords: ['改名字', '名称', '称呼', '我的名字', '店铺名'] },
  { id: 'settings.backup', label: '备份与迁移', where: '设置', route: 'settings', find: '备份与迁移', summary: '导出或恢复任务、知识、流程；备份不含密钥。', keywords: ['导出', '备份', '恢复备份', '换电脑', '迁移', '数据导出'] },

  // —— 帮助 ——
  { id: 'help.diagnostics', label: '帮助与日志（求助包）', where: '顶栏', route: 'settings', open: 'diagnostics', summary: '一键生成求助包，用于在 GitHub 提交排查日志；不含客户名字、内容、密钥。', keywords: ['求助', '求助包', '日志', '诊断', '出问题了', '报错', '帮助'] },
  { id: 'help.feedback', label: '反馈问题', where: '顶栏', route: 'settings', open: 'feedback', summary: '写一句刚才发生了什么，附上诊断日志。', keywords: ['反馈', '提意见', 'bug', '建议'] },
  { id: 'help.manual', label: '使用手册（常见问题）', where: '顶栏 · 左侧导航', route: 'manual', summary: '像说明书一样从头教你用咔哒：第一步、导资料、模型配置，常见问题放在最前面。', keywords: ['使用手册', '手册', '说明书', '说明', '用户手册', '常见问题', 'faq', '新手教程', '教程', '怎么用', '更新日志', '更新了什么', '版本说明'] },
  { id: 'help.assistant', label: '问咔哒怎么用', where: '帮助', route: 'settings', open: 'assistant', summary: '用一句话问怎么用咔哒，AI 回答并带你去对应的地方。', keywords: ['ai 助手', '问问', '怎么用', '不会用', '使用帮助', '问ai'] },

  // —— 插件 ——
  { id: 'plugins', label: '插件（插件中心）', where: '插件', route: 'plugins', summary: '装话术包、知识包、工具和自动化，让咔哒工作台做更多事。', keywords: ['插件', '插件中心', '扩展', '装插件', '安装插件', '话术包', '工具插件', '外部工具', '自动化', '规则'] },

  // —— 开放 ——
  { id: 'open', label: '开放（给其他 AI 工具调用）', where: '开放', route: 'open', summary: '把知识检索、试答通过 MCP 开放给 Claude、Codex、Cursor 等工具。', keywords: ['mcp', 'claude', 'codex', 'cursor', 'antigravity', 'workbuddy', '接口', '开发者', 'api', '其他ai'] },
  { id: 'open.mcp', label: 'MCP 服务开关', where: '开放', route: 'open', find: 'MCP 服务', summary: '打开或关闭本机 MCP 服务，只监听本机。', keywords: ['开启mcp', '服务开关', '本机服务'] },
  { id: 'open.tools', label: '开放的工具', where: '开放', route: 'open', find: '开放的工具', summary: '逐个勾选允许其他 AI 工具使用的功能。', keywords: ['工具列表', '权限', '允许哪些'] },
  { id: 'open.connect', label: '接入方式（复制配置）', where: '开放', route: 'open', find: '接入方式', summary: '复制对应 AI 工具的配置粘贴过去即可。', keywords: ['配置粘贴', '本机桥', '怎么接入', '复制配置'] },
  { id: 'open.clients', label: '客户端（每个工具单独密钥）', where: '开放', route: 'open', find: '客户端', summary: '给每个 AI 工具单独一把密钥，删掉只影响这一个工具。', keywords: ['客户端密钥', '多个工具', '单独密钥'] },

  // —— 流程与审计 ——
  { id: 'workflows', label: '工作流程', where: '工作流程', route: 'workflows', summary: '把你的工作方式写下来，让每份回复草稿保持一致的标准。', keywords: ['流程', 'sop', '标准', '规范'] },
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
