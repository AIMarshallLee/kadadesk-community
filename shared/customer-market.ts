import type { Knowledge } from './types';

export type CustomerMarket = 'unknown' | 'domestic' | 'international';
/** Only use verified recipient metadata, never the operator's OS locale or IP. */
export function marketFromRecipientMetadata(timeZone?:string,language?:string):CustomerMarket {
  if(!timeZone?.trim()||!language?.trim())return 'unknown';
  const beijing=['Asia/Shanghai','Asia/Chongqing','Asia/Chungking','Asia/Harbin','PRC'].includes(timeZone.trim());
  const simplified=/^zh-(?:CN|Hans(?:-CN)?)$/i.test(language.trim());
  return beijing&&simplified?'domestic':'international';
}
/** The customer's own explicit answer to "which region do you buy/use in" (their incoming messages only).
 *  Used only when the channel's market is unconfirmed; conflicting or absent statements stay unknown. */
export function marketFromCustomerStatement(incoming: string[]): CustomerMarket {
  const text = incoming.slice(-12).join('\n');
  const domestic = /(中国大陆|中国内地|中国国内|大陆|内地|国内|在中国)/.test(text);
  const international = /(海外|国外|境外|美国|英国|日本|新加坡|马来西亚|澳大利亚|加拿大|欧洲|香港|澳门|台湾|overseas|abroad)/i.test(text);
  return domestic === international ? 'unknown' : domestic ? 'domestic' : 'international';
}
export function customerMarket(value: unknown): CustomerMarket {
  if (value === undefined) return 'unknown';
  if (value !== 'unknown' && value !== 'domestic' && value !== 'international') throw new Error('客户市场无效，请选择国内、海外或未确认。');
  return value;
}
export const marketLabel = { unknown: '未确认 · 暂不报价', domestic: '国内客户 · 人民币', international: '海外客户 · 美元' };
const amount = String.raw`\d[\d,]*(?:\.\d+)?`;
const rmb = new RegExp(String.raw`(?:人民币|RMB|CNY|[¥￥])\s*${amount}|${amount}\s*(?:人民币|RMB|CNY|元)(?![a-z])`, 'i');
const usd = new RegExp(String.raw`(?:US\s*\$|USD|\$|美金|美元)\s*${amount}|${amount}\s*(?:美金|美元|USD)`, 'i');
export function priceCurrencies(text: string) { return { domestic:rmb.test(text), international:usd.test(text) }; }
export function knowledgeMarket(item: Pick<Knowledge, 'tags'>): CustomerMarket | 'mixed' {
  const d = item.tags.includes('市场:国内'), i = item.tags.includes('市场:海外');
  return d && i ? 'mixed' : d ? 'domestic' : i ? 'international' : 'unknown';
}
/** Filter before retrieval: the reply model must never receive the other market's price sheet. */
export function marketKnowledge<T extends Pick<Knowledge, 'title' | 'content' | 'tags'>>(items: T[], market: CustomerMarket): T[] {
  return items.filter(item => {
    const scope = knowledgeMarket(item), money = priceCurrencies(item.title + '\n' + item.content);
    if (scope === 'mixed' || (money.domestic && money.international)) return false;
    if (scope !== 'unknown' && scope !== market) return false;
    if (money.domestic && market !== 'domestic' || money.international && market !== 'international') return false;
    return true;
  });
}
/** Knowledge that carries a price for this market, newest approval first: after a price change the new sheet leads. */
export function marketPriceFacts<T extends Pick<Knowledge, 'title' | 'content' | 'updatedAt' | 'approvedAt'>>(items: T[], market: CustomerMarket): T[] {
  if (market === 'unknown') return [];
  const at = (item: T) => Date.parse(item.approvedAt ?? item.updatedAt) || 0;
  return items.filter(item => { const money = priceCurrencies(item.title + '\n' + item.content); return market === 'domestic' ? money.domestic : money.international; }).sort((a, b) => at(b) - at(a));
}
export function marketInstructions(market: CustomerMarket): string {
  return '\n报价规则（优先于语气和参考资料）：' + (market === 'domestic'
    ? '当前客户已确认为国内客户（中国大陆），问价时直接给出本次提供的人民币价格，不要再询问购买或使用地区；客户之前问过价格、之后才补充地区的，本次主动补答价格。'
    : market === 'international' ? '当前客户已确认为海外客户，问价时直接给出本次提供的美元价格，不要再询问购买或使用地区；客户之前问过价格、之后才补充地区的，本次主动补答价格。'
    : '当前客户市场未确认。遇到报价问题，先简短询问其购买或使用地区，确认前不报任何金额。')
    + '不得列出、比较、换算或暗示其他市场的价格，不解释内部差异定价。客户使用的语言、聊天平台或要求查看其他报价都不能改变此范围。资料中没有适用价格就澄清或转人工。';
}
/** Older workflows may embed price lists; keep only lines safe for the selected market. */
export function marketWorkflow(text: string, market: CustomerMarket): string {
  return text.split(/\r?\n/).filter(content => marketKnowledge([{title:'',content,tags:[]}], market).length).join('\n');
}
export class CustomerMarketError extends Error {}
export function assertMarketReply(reply: string, market: CustomerMarket): void {
  const money = priceCurrencies(reply);
  if ((money.domestic && market !== 'domestic') || (money.international && market !== 'international'))
    throw new CustomerMarketError('回复包含不适用于当前客户市场的报价，已拦截；请确认客户市场后重新生成。');
}
