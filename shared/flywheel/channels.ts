import type { ConversationChannel } from './types';

/**
 * Channel names in ONE place. The internal build names the chat apps; the community port swaps this table
 * (「聊天软件」 instead of the app names) and nothing else has to change.
 */
export const FLYWHEEL_CHANNEL_LABELS: Record<ConversationChannel, string> = {
  wechat: '即时通讯', wecom: '企业办公软件', feishu: '飞书', dingtalk: '钉钉', whatsapp: 'WhatsApp', qianniu: '千牛', phone: '手机', web: '网页', other: '其他聊天软件',
};

/** Content platforms of the keyword table (spec §5.1 platform enum), as the reply context line names them. */
export const FLYWHEEL_PLATFORM_LABELS: Record<string, string> = {
  douyin: '抖音', shipinhao: '视频号', xhs: '小红书', bilibili: 'B站', kuaishou: '快手', wechat_article: '公众号', moments: '朋友圈', other: '线上内容',
};
export const platformLabel = (platform?: string) => (platform && FLYWHEEL_PLATFORM_LABELS[platform]) || '线上内容';

/**
 * The reception lane → spec channel. `channel` is the account kind of the engine (desk / phone), `app` the chat app
 * the lane is set to (DesktopReplyConfig.application) or an official lane's platform id.
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
