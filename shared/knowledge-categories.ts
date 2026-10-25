import { secretIn } from './secret-guard';
/** The six customer-service categories every knowledge entry lands in. The sixth is never sent to customers. */
export const KNOWLEDGE_CATEGORIES = ['产品与价格', '购买与售后', '使用方法', '常见异议', '联系与转人工', '内部资料'] as const;
export type KnowledgeCategory = typeof KNOWLEDGE_CATEGORIES[number];
export const CATEGORY_TAG_PREFIX = '分类:';

// 内部资料 is never guessed from ordinary words: 「园区厂房出租价格」「展会搭建报价」「视频加字幕怎么收费」 are real customer facts.
// Only an explicit 分类:内部资料 tag or a title that starts with 内部 / 仅内部 marks an entry as internal.
const INTERNAL_TITLE = /^\s*[【\[（(「]?\s*(?:仅限?内部|内部)/u;
const RULES: Array<[KnowledgeCategory, RegExp]> = [
  ['联系与转人工', /(联系|转人工|负责人|客服聊天软件|电话|邮箱|工作时间|人工|进群|群二维码)/u],
  ['购买与售后', /(购买|下单|付款|支付|发票|退款|换机|售后|授权|激活|试用|订单|开通|续费|迁移)/u],
  ['产品与价格', /(价格|多少钱|费用|报价|收费|售价|租金|单价|元\/|美元|US\$|版本|支持.*系统|Mac|Windows|功能|能做什么|是什么|介绍|套餐|专业版|旗舰版)/u],
  ['使用方法', /(怎么用|如何|步骤|配置|设置|安装|导入|上手|教程|操作|连接|识别|校准|指南)/u],
  ['常见异议', /(异议|保证|安全|准确|风险|隐私|训练|资料会|能不能|可以.*吗|为什么|靠谱|区别|对比|直接问)/u],
];

/** Category by title/question/tags text; unmatched entries default to 使用方法-neutral "常见异议"? No: to 产品与价格 only when priced, else 使用方法. */
export function categorize(text: string, tags: string[] = []): KnowledgeCategory {
  const tagged = tags.find(t => t.startsWith(CATEGORY_TAG_PREFIX))?.slice(CATEGORY_TAG_PREFIX.length);
  if (tagged && (KNOWLEDGE_CATEGORIES as readonly string[]).includes(tagged)) return tagged as KnowledgeCategory;
  if (INTERNAL_TITLE.test(text)) return '内部资料';
  for (const [category, rule] of RULES) if (rule.test(text)) return category;
  return '使用方法';
}

/**
 * 写法参考: entries imported only as style examples (good posts, scripts). Other features may read them to learn a
 * voice (the tag carries 「文案」 so style-example finders recognize it), but they are never facts for a customer.
 */
export const STYLE_REFERENCE_TAG = '写法参考·文案';
export const styleReferenceOnly = (item: { tags: string[] }) => item.tags.includes(STYLE_REFERENCE_TAG);
/** May be used as a fact in a customer reply: not 内部资料 and not a 写法参考 style example. */
export const customerFactKnowledge = (item: { title: string; question?: string; tags: string[] }) => !styleReferenceOnly(item) && categorize(`${item.title} ${item.question ?? ''}`, item.tags) !== '内部资料';

export function withCategoryTag(tags: string[], category: KnowledgeCategory): string[] {
  return [...tags.filter(t => !t.startsWith(CATEGORY_TAG_PREFIX)), CATEGORY_TAG_PREFIX + category];
}

/** 知识体检: how many enabled entries each customer-facing category has, and what a desk usually still lacks. */
export function knowledgeHealth(items: Array<{ title: string; question?: string; content?: string; tags: string[]; enabled: boolean; reviewStatus?: string }>) {
  const live = items.filter(i => i.enabled && i.reviewStatus !== 'pending' && !styleReferenceOnly(i));
  const counts = Object.fromEntries(KNOWLEDGE_CATEGORIES.map(c => [c, 0])) as Record<KnowledgeCategory, number>;
  for (const item of live) counts[categorize(`${item.title} ${item.question ?? ''}`, item.tags)]++;
  const gaps: Array<{ category: KnowledgeCategory; hint: string }> = [];
  const hints: Record<KnowledgeCategory, string> = { '产品与价格': '价格、版本、包含什么', '购买与售后': '怎么买、怎么开票、退款规则', '使用方法': '安装、配置、常见操作', '常见异议': '"能保证吗""安全吗""和 XX 比"', '联系与转人工': '找谁、工作时间、什么问题转人工', '内部资料': '' };
  for (const c of KNOWLEDGE_CATEGORIES) if (c !== '内部资料' && counts[c] === 0) gaps.push({ category: c, hint: hints[c] });
  // 资料里像密钥、密码、证件号的内容：回复时会被隐藏、绝不发出，但最好删掉。
  const secrets = items.filter(i => secretIn(`${i.title}\n${i.question ?? ''}\n${i.content ?? ''}`)).map(i => i.title);
  return { counts, gaps, total: live.length, secrets };
}
