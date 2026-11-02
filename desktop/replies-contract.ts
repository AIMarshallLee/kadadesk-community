/**
 * Reception Event Contracts for Plugins (社区版事件契约)
 * 仅定义插件框架所需的标准化事件类型，不含专有平台驱动
 */

export type ReceptionEvent =
  | { kind: 'incoming'; conversation: string; text: string; first: boolean; at?: string; jobId?: string; profileId?: string; conversationKey?: string }
  | { kind: 'handoff'; conversation: string; text: string; detail: string; at?: string; jobId?: string; profileId?: string; conversationKey?: string }
  | { kind: 'review-edited'; conversation: string; text: string; draft: string; edited: string; at?: string; jobId?: string; profileId?: string; conversationKey?: string }
  | { kind: 'reply-sent'; conversation: string; text: string; latencySeconds?: number; mode?: 'auto' | 'review' | 'manual'; by?: 'ai' | 'human'; firstInConversation?: boolean; at?: string; jobId?: string; profileId?: string; conversationKey?: string }
  | { kind: 'profile-updated'; conversation: string; profileId: string; changedFacts: Array<{ field: string; value: string; old?: string; source?: string; sensitive?: boolean }>; by?: 'ai' | 'human'; at?: string; conversationKey?: string }
  | { kind: 'lead-captured'; conversation: string; profileId?: string; captureChannel: 'keyword' | 'add_friend' | 'map_listing' | 'showroom_booking' | 'group' | 'other'; detail?: Record<string, unknown>; at?: string; conversationKey?: string };
