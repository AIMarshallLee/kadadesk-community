// The chat app's own feeds and system accounts (公众号、服务通知…): never a customer, never a reception candidate,
// however a list read classified the row. Matched on the whole name (a customer called 「公众号运营小王」 is not one).
const EXACT = new Set([
  '公众号', '服务号', '订阅号', '订阅号消息', '服务通知', '聊天软件团队', '文件传输助手', '聊天软件支付', '腾讯新闻', '聊天软件运动',
  '聊天软件游戏', 'QQ邮箱提醒', '视频号', '视频号消息', '视频号助手', '搜一搜', '看一看', '漂流瓶', '腾讯客服', '聊天软件公众平台',
  '聊天软件小店', '小程序客服消息', '折叠的聊天', '聊天软件收款助手', '聊天软件卡包', '腾讯视频', '聊天软件读书', '新的朋友',
  'WeChat Team', 'File Transfer', 'Official Accounts', 'Subscriptions', 'Service Notifications', 'WeChat Pay',
].map(n => fold(n)));
function fold(name: string) { return name.normalize('NFKC').replace(/[\s​]+/gu, '').toLowerCase(); }
export function isSystemFeed(name: string | undefined): boolean {
  if (!name) return false;
  return EXACT.has(fold(name.replace(/\s*[（(]\d+[)）]\s*$/u, '')));
}
