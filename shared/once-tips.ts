/**
 * 页面里的一次性提示和确认框：每个都有一个固定的 key。点「不再提醒」（提示）或勾「以后不再问」（确认框）后，
 * 这个 key 记在本机数据目录的 ui-tips.json 里，升级、清浏览器缓存都不会丢；设置里可以一键恢复。
 * In-page one-time tips and confirmations. Desktop reminders (cards / system notifications) live in shared/notices.ts.
 */
export interface TipKind {
  key: string;
  /** Where it shows, in plain words (for a future 设置 → 提醒 list). */
  label: string;
  /** A confirmation (asks before an action) rather than an explanation. */
  confirm?: boolean;
}
export const TIP_KINDS: TipKind[] = [
  { key: 'reception-mouse', label: '接待页：接待时咔哒会借用鼠标键盘' },
  { key: 'reception-sleep', label: '接待页：电脑睡着或锁屏时接不了客户' },
  { key: 'emergency-stop', label: '接待页：急停是什么意思' },
  { key: 'review-first', label: '接待页：刚开始建议每条先审核' },
  { key: 'moments-posting', label: '营销页：到了发布时间要你自己发一下' },
  { key: 'knowledge-try', label: '知识页：开始接待前先试问几句' },
  { key: 'customers-intro', label: '客户页：咔哒会记下什么、存在哪里' },
  { key: 'confirm-setup-start', label: '开始页：开始接待前的说明', confirm: true },
  { key: 'confirm-auto-mode', label: '改成「自动回复」前确认', confirm: true },
  { key: 'confirm-review-off', label: '关掉「发送前审核」前确认', confirm: true },
  { key: 'confirm-include-groups', label: '同时接待群聊前确认', confirm: true },
  { key: 'confirm-friend-accept', label: '自动通过好友申请前确认', confirm: true },
  { key: 'confirm-default-auto', label: '全部人改成自动回复前确认', confirm: true },
  { key: 'confirm-group-sync-on', label: '打开群同步前确认', confirm: true },
  { key: 'confirm-group-mingle-on', label: '打开混群前确认', confirm: true },
  { key: 'confirm-moments-all', label: '营销内容「全部通过」前确认', confirm: true },
  { key: 'confirm-phone-start', label: '开始用手机接待前确认', confirm: true },
  { key: 'confirm-update-now', label: '「现在更新」前确认', confirm: true },
  { key: 'confirm-customer-delete', label: '删除客户档案前确认', confirm: true },
  { key: 'confirm-followup-auto', label: '打开「跟进消息自动发」前确认', confirm: true },
  { key: 'confirm-broadcast-send', label: '「按分组发消息」开始发送前确认', confirm: true },
];
export const TIP_KEY_MAX = 60;
export const TIPS_MAX = 200;
/** Any short, plain key is accepted (a newer page may know tips an older registry does not). */
export const validTipKey = (key: unknown): key is string => typeof key === 'string' && key.length > 0 && key.length <= TIP_KEY_MAX && /^[a-z0-9][a-z0-9-]*$/.test(key);
/** Keeps the valid, unique keys of a stored list, newest last, at most TIPS_MAX. */
export function cleanTipList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const key of value) if (validTipKey(key)) { seen.delete(key); seen.add(key); }
  return [...seen].slice(-TIPS_MAX);
}
/** A confirmation with a 「以后不再问」 key the owner already ticked answers yes without showing. */
export const skipConfirm = (spec: { remember?: string }, muted: (key: string) => boolean) => Boolean(spec.remember && muted(spec.remember));
export const tipLabel = (key: string) => TIP_KINDS.find(k => k.key === key)?.label ?? key;
