/**
 * 提醒中心：每个提醒一个固定的 key。用户点「不再提醒」后这个 key 永久静音，设置里「提醒」可以恢复。
 * Every reminder the owner can see on the desktop (a card near the screen corner, or a system notification) goes
 * through this list, so each one can be switched off and switched back on.
 */
export interface NoticeKind {
  key: string;
  /** Name shown in 设置 → 提醒 (plain words). */
  label: string;
  /** Important for not losing customers: muting asks once more, and the settings list marks it. */
  important?: boolean;
}
export const NOTICE_KINDS: NoticeKind[] = [
  { key: 'reception-started', label: '开始接待时：说明咔哒会借用鼠标键盘' },
  { key: 'owner-busy', label: '你在用电脑、咔哒等你停手发回复时' },
  { key: 'customer-waiting', label: '客户等了 2 分钟还没回上', important: true },
  { key: 'handoff', label: '有客户需要你看一眼', important: true },
  { key: 'window-wait', label: '聊天窗口不见了 / 需要扫码登录', important: true },
  { key: 'screen-consent', label: '系统在问能不能录屏' , important: true },
  { key: 'resource-tight', label: '电脑内存紧张或发热，咔哒放慢了' },
  { key: 'reply-fallback', label: '回复模型出问题，换用了备用模型' },
  { key: 'model-trouble', label: '回复模型连续出错' , important: true },
  { key: 'paused-by-key', label: '用快捷键暂停 / 继续接待' },
  { key: 'background-mode', label: '咔哒转到后台运行' },
  { key: 'stuck-key', label: '某个按键好像一直按着' },
  { key: 'reply-failed', label: '有客户的回复没发成功', important: true },
  { key: 'moments', label: '营销内容到点了 / 没发成功' },
  { key: 'follow-ups', label: '今天该跟进的客户 / 分组消息停下了' },
  { key: 'group-mingle', label: '混群认出了新群，请你确认类型' },
  { key: 'group-mingle-alert', label: '混群在某个群停了 / 有人在群里问到你的业务', important: true },
  { key: 'plugins', label: '插件出错或被自动停用' },
  { key: 'license', label: '软件授权有变化（如卡密被停用）', important: true },
  { key: 'storage', label: '电脑空间不够，咔哒在整理存储' },
  { key: 'authenticator', label: '手机验证码接连出错，聊天里的指令已暂停', important: true },
  { key: 'knowledge-sync', label: '知识来源自动更新了 / 没更新成功' },
  { key: 'other', label: '其他提醒' },
];
export const noticeLabel = (key: string) => NOTICE_KINDS.find(k => k.key === key)?.label ?? key;
/** A card the notice window shows. */
export interface NoticeCard {
  id: string;
  key: string;
  title: string;
  body: string;
  /** Offer 「暂停接待」 (only while reception runs). */
  pause?: boolean;
  /** Offer 「打开咔哒」. */
  open?: boolean;
  /** Muting it could cost customers: 「不再提醒」 asks once more. */
  important?: boolean;
  /** One extra choice on the card (e.g. 「这个群别管」); its action is 'extra'. */
  extra?: string;
  /** How long the card stays before it slides away by itself. */
  ttlMs: number;
}
export type NoticeAction = 'pause' | 'open' | 'ok' | 'mute' | 'extra';
