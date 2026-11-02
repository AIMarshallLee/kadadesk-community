/**
 * Reception Event Contracts for Plugins (社区版事件契约)
 * 仅定义插件框架所需的标准化事件类型，不含专有平台驱动
 */

export interface ReceptionEventBase { conversation: string; at?: string; jobId?: string; profileId?: string; conversationKey?: string; channel?: 'desk' | 'phone'; app?: string; chatKind?: 'direct' | 'group' }
export type ReceptionHandoffCause = import('../shared/flywheel/mapping').HandoffCause;

export type ReceptionEvent =
  | (ReceptionEventBase & { kind: 'incoming'; text: string; first: boolean })
  | (ReceptionEventBase & { kind: 'handoff'; text: string; detail: string; cause?: ReceptionHandoffCause; ruleKeyword?: string })
  | (ReceptionEventBase & { kind: 'review-edited'; text: string; draft: string; edited: string })
  | (ReceptionEventBase & { kind: 'reply-sent'; text: string; latencySeconds?: number; mode: 'auto' | 'review' | 'manual'; by: 'ai' | 'human'; firstInConversation?: boolean })
  | (ReceptionEventBase & { kind: 'profile-updated'; profileId: string; changedFacts: Array<{ field: string; value: string; old?: string; source?: string; sensitive?: boolean }>; by?: 'ai' | 'human' })
  | (ReceptionEventBase & { kind: 'lead-captured'; captureChannel: 'keyword' | 'add_friend' | 'map_listing' | 'showroom_booking' | 'group' | 'other'; detail?: { contentId?: string; keyword?: string; platform?: string; storeId?: string; formPhone?: string; need?: string } });

export type ResolvedReceptionEvent = ReceptionEvent & { at: string; profileId: string; conversationKey: string };
export interface ReplyContextMeta { conversation: string; channel: 'desk' | 'phone'; app?: string; chatKind?: 'direct' | 'group'; firstInConversation: boolean }

