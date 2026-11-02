import type { ConversationChannel } from './types';

/**
 * Channel names in ONE place. The community edition names no chat app: every chat app is 「聊天软件」 here, and the
 * wire values stay the spec's enum (see types.ts).
 */
export const FLYWHEEL_CHANNEL_LABELS: Record<ConversationChannel, string> = {
  wechat: '聊天软件', wecom: '企业聊天软件', feishu: '飞书', dingtalk: '钉钉', whatsapp: 'WhatsApp', qianniu: '电商客服', phone: '手机', web: '网页', other: '其他聊天软件',
};

/** Content platforms of the keyword table (spec §5.1 platform enum), as the reply context line names them. */
export const FLYWHEEL_PLATFORM_LABELS: Record<string, string> = {
  douyin: '抖音', shipinhao: '视频号', xhs: '小红书', bilibili: 'B站', kuaishou: '快手', wechat_article: '公众号', moments: '社交动态', other: '线上内容',
};
export const platformLabel = (platform?: string) => (platform && FLYWHEEL_PLATFORM_LABELS[platform]) || '线上内容';

/**
 * A reception source → spec channel. `channel` is the account kind (desk / phone), `app` the chat software id a
 * core event names (or nothing). The community edition reads no chat window: core events usually give no app and
 * map to `other`.
 */
export function laneChannel(channel: 'desk' | 'phone' | undefined, app: string | undefined): ConversationChannel {
  if (channel === 'phone') return 'phone';
  switch (app) {
    case 'wechat': return 'wechat';
    case 'wecom': case 'wecom-bot': return 'wecom';
    case 'feishu': return 'feishu';
    case 'dingtalk': return 'dingtalk';
    case 'whatsapp': case 'whatsapp-cloud': return 'whatsapp';
    case 'qianniu': return 'qianniu';
    case 'web': return 'web';
    default: return 'other';
  }
}
