/**
 * 平台档案: what differs between chat apps on the screen route. The reception engine, safety checks, knowledge and
 * reply rules are shared; a new app is mostly a new profile plus its acceptance checklist.
 * WeChat keeps the exact behaviour it had before profiles existed (its prompts are not rewritten).
 */
export type ChatPlatform = 'chat_app' | 'wecom' | 'qianniu' | 'whatsapp' | 'other';
/** Stored value of DesktopReplyConfig.application ('generic' predates profiles and means WeChat). */
export type ApplicationSetting = 'generic' | 'chat_app' | 'wecom' | 'qianniu' | 'whatsapp' | 'other';

export interface PlatformProfile {
  id: ChatPlatform;
  label: string;
  /** stable: accepted on real devices; beta: works, still under acceptance; test: generic, every reply reviewed. */
  maturity: 'stable' | 'beta' | 'test';
  /** One line shown under the app choice. */
  note: string;
  /** WeChat's sidebar chat icon carries the total unread count; only then may "no badge" mean "nothing new". */
  sidebarBadge: boolean;
  /** A red numbered badge on a list row locates the customer by pixels (no model read). */
  redListBadge: boolean;
  /** 通讯录 friend requests and the 窗口 → 聊天 menu exist only in WeChat. */
  friendRequests: boolean;
  chatsMenu: boolean;
  /** The WeChat search box flow (selected chats that are not in view). */
  search: boolean;
  /** Every drafted reply waits for the owner first (generic mode), whatever the review setting says. */
  forceReview: boolean;
  defaultMarket: 'domestic' | 'international' | 'unknown';
  /** Replaces the WeChat unread/mute/kind rule in the screen-reading prompts. Empty for WeChat (prompts unchanged). */
  listRule: string;
}

const COMMON_KIND = 'Personal chats are direct, group chats group, system/app notification feeds service; use unknown when unclear, never infer solely from the name. Clipped/ellipsis names have nameComplete=false. mentioned=true only when the row preview shows an @我 / [有人@我] marker.';

export const PLATFORM_PROFILES: Record<ChatPlatform, PlatformProfile> = {
  chat_app: { id: 'chat_app', label: '常用聊天软件（已适配，推荐）', maturity: 'stable', note: '已在真机长期验收：自动发现新消息、逐个回复。', sidebarBadge: true, redListBadge: true, friendRequests: true, chatsMenu: true, search: true, forceReview: false, defaultMarket: 'unknown', listRule: '' },
  wecom: {
    id: 'wecom', label: '企业办公聊天（测试中）', maturity: 'beta', note: '企业办公聊天软件电脑版（测试中）：能自动接待，建议先用测试账号试一遍，再接真实客户。',
    sidebarBadge: false, redListBadge: true, friendRequests: false, chatsMenu: false, search: false, forceReview: false, defaultMarket: 'domestic',
    listRule: `WECOM RULE: a red badge with a WHITE NUMBER on a row means unread (unread:"unread", muted:"no"). A bare red dot or a bell-slash icon means the chat is muted (muted:"yes"). External contacts may show a suffix such as @聊天软件 or a company name after the name: keep it as part of the exact name. App/approval/announcement feeds (审批, 汇报, 打卡, 公告, 工作台, 企业通讯团队) are service. ${COMMON_KIND}`,
  },
  qianniu: {
    id: 'qianniu', label: '千牛 · 电商客服（测试中）', maturity: 'beta', note: '千牛接待中心（测试中）：接待买家咨询；退款、投诉、议价类问题会先给你确认。',
    sidebarBadge: false, redListBadge: true, friendRequests: false, chatsMenu: false, search: false, forceReview: false, defaultMarket: 'domestic',
    listRule: `QIANNIU RULE: the left list holds buyer conversations in the 接待中心. A red badge with a WHITE NUMBER (or a clearly highlighted unread count) on a buyer row means unread (unread:"unread", muted:"no"); rows without it are read. Buyer rows are direct. System, platform and shop notifications (系统消息, 官方通知, 服务市场, 千牛头条, 订单提醒) are service. Product, order or coupon cards in the timeline are kind "card" with text "" — never answer a card as if it were text. ${COMMON_KIND}`,
  },
  whatsapp: { id: 'whatsapp', label: 'WhatsApp 网页版（测试中）', maturity: 'beta', note: 'WhatsApp 网页版（测试中）；更稳的方式是在「客户跟进与内容」里接官方接口。', sidebarBadge: false, redListBadge: false, friendRequests: false, chatsMenu: false, search: false, forceReview: false, defaultMarket: 'international', listRule: '' },
  other: {
    id: 'other', label: '其他聊天软件 · 通用模式（测试中）', maturity: 'test', note: '通用模式（测试中）：适用于大多数聊天软件，先在「窗口与校准」框好五个区域；每条回复都会先给你确认再发。',
    sidebarBadge: false, redListBadge: false, friendRequests: false, chatsMenu: false, search: false, forceReview: true, defaultMarket: 'unknown',
    listRule: `GENERIC CHAT APP RULE: this may be any desktop chat app. A row is unread only when it shows an explicit unread count badge or a clearly highlighted unread marker that this app uses for new messages; when you cannot tell, use unread:"unknown". A bell-slash/mute icon means muted:"yes". ${COMMON_KIND}`,
  },
};

export function platformOf(config: { application?: string } | undefined): PlatformProfile {
  const a = config?.application;
  return a === 'wecom' || a === 'qianniu' || a === 'whatsapp' || a === 'other' ? PLATFORM_PROFILES[a] : PLATFORM_PROFILES.chat_app;
}
/** The order shown in the app picker. */
export const PLATFORM_CHOICES: ReadonlyArray<{ value: ApplicationSetting; profile: PlatformProfile }> = [
  { value: 'generic', profile: PLATFORM_PROFILES.chat_app },
  { value: 'wecom', profile: PLATFORM_PROFILES.wecom },
  { value: 'qianniu', profile: PLATFORM_PROFILES.qianniu },
  { value: 'whatsapp', profile: PLATFORM_PROFILES.whatsapp },
  { value: 'other', profile: PLATFORM_PROFILES.other },
];
/** Review applies to every reply on a test-maturity platform. */
export function effectiveReviewMode<T extends string | undefined>(config: { application?: string; reviewMode?: T }): T | 'all' {
  return platformOf(config).forceReview ? 'all' : (config.reviewMode as T);
}
