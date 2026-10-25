// Local query normalization only. It never creates business facts or calls a model.
export function normalizeKnowledgeQuery(value: string): string {
  return value.normalize('NFKC').toLowerCase()
    .replace(/how much|pricing|prices?|costs?|多少钱|多少费用|怎么收费|费用多少|报价|收费|售价|单价|定价|卖多少|怎么卖|什么价|啥价/g, '价格')
    // Everyday ways to ask "how long": 几天能发货 means the same as 多久发货.
    .replace(/几天|多少天|多长时间|多久|什么时候|啥时候/g, '多久')
    .replace(/邮费|快递费/g, '运费')
    .replace(/退换货?/g, '退货换货')
    // 能退吗 / 退掉 / 不想要了能退: a bare 退 is a return.
    .replace(/退(?![货款订出役休伍步烧让避])/g, '退货')
    .replace(/\bannual(?:ly)?\b|\bper year\b|\byearly\b|一年|年费|年付|按年(?:付费|付款|支付|付)?/g, '年度')
    .replace(/\bper month\b|\bmonthly\b|一个月|月费|月付|按月(?:付费|付款|支付|付)?/g, '月度')
    .replace(/苹果电脑|苹果笔记本|macbook|macos/g, 'mac')
    .replace(/泄露|泄漏|保密/g, '数据安全')
    .replace(/\s+/g, ' ').trim();
}

export function businessNames(tags: string[]): string[] {
  return tags.flatMap(tag => /^(业务|business)[:：]/i.test(tag) ? [tag.replace(/^[^:：]+[:：]/, '').normalize('NFKC').toLowerCase().trim()] : []).filter(Boolean);
}

export function mentionsBusiness(text: string, name: string): boolean {
  const index = text.indexOf(name);
  if (index < 0) return false;
  if (/^[a-z0-9 ]+$/.test(name)) return new RegExp(`(^|[^a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(text);
  return true;
}
