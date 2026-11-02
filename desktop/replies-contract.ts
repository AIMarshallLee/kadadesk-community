/**
 * Reception event contract for plugins (community edition).
 *
 * The community edition reads and writes no chat window. These types are the generic contract a core event source
 * (customer profiles, the open MCP interface, a future reception source of your own) uses to tell plugins what
 * happened. Events carry codes, times and profile ids; the `text` fields exist for local automation rules only and are
 * never sent anywhere by 连接增长飞轮 (see shared/flywheel/mapping.ts).
 */

/** Fields every reception event may carry. The source sets `at`, `channel`, `app`; the dispatcher in plugin-hooks.ts
 *  adds `profileId` and `conversationKey` (a hash of account + chat name, never the name) before listeners see it. */
export interface ReceptionEventBase { conversation: string; at?: string; jobId?: string; profileId?: string; conversationKey?: string; channel?: 'desk' | 'phone'; app?: string; chatKind?: 'direct' | 'group' }
/** Why a chat was handed over, set where the source hands it over (never derived from chat text). */
export type ReceptionHandoffCause = import('../shared/flywheel/mapping').HandoffCause;
export type ReceptionEvent =
  | (ReceptionEventBase & { kind: 'incoming'; text: string; first: boolean })
  | (ReceptionEventBase & { kind: 'handoff'; text: string; detail: string; cause?: ReceptionHandoffCause; ruleKeyword?: string })
  | (ReceptionEventBase & { kind: 'review-edited'; text: string; draft: string; edited: string })
  /** A reply confirmed sent, or a message the owner typed himself (by human, manual). */
  | (ReceptionEventBase & { kind: 'reply-sent'; text: string; latencySeconds?: number; mode: 'auto' | 'review' | 'manual'; by: 'ai' | 'human'; firstInConversation?: boolean })
  | (ReceptionEventBase & { kind: 'profile-updated'; profileId: string; changedFacts: Array<{ field: string; value: string; source?: string; sensitive?: boolean }>; by?: 'ai' | 'human' })
  | (ReceptionEventBase & { kind: 'lead-captured'; captureChannel: 'keyword' | 'form' | 'referral' | 'event' | 'other'; detail?: { contentId?: string; keyword?: string; platform?: string; need?: string } });
/** What plugin listeners receive: always with a time, a profile and a conversation key. */
export type ResolvedReceptionEvent = ReceptionEvent & { at: string; profileId: string; conversationKey: string };
/** What the context hook knows about the message being answered (a reception source → plugins). */
export interface ReplyContextMeta { conversation: string; channel: 'desk' | 'phone'; app?: string; chatKind?: 'direct' | 'group'; firstInConversation: boolean }
