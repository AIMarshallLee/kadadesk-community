/**
 * 增长飞轮 flywheel.v1 — the wire types (00-飞轮数据底座-统一接口规范 V1.0 + 线上格式细则 V1.0.1).
 * shared/flywheel/flywheel-v1.schema.json is the authority; these types follow it and every outgoing event is checked
 * against that file (validate.ts) before it enters the outbox.
 *
 * The identity and channel enum values (`wechat_id`, `wecom`, …) are the spec's wire values: they name the chat
 * software a value came from and are kept exactly as the schema spells them.
 */

export const FLYWHEEL_SCHEMA = 'flywheel.v1' as const;

export type FlywheelSystem = 'content-factory' | 'crm' | 'kadadesk' | 'command-center' | 'feishu-bitable' | 'manual';
export interface FlywheelSource { system: FlywheelSystem; instance: string; version?: string }

export type IdentityType = 'phone' | 'wechat_id' | 'wecom_external_userid' | 'email' | 'platform_uid' | 'store_id' | 'wechat_remark' | 'company_name';
/** Strong identities: the hub (and kadadesk, for events it receives) merges on these alone. */
export const STRONG_IDENTITIES: readonly IdentityType[] = ['phone', 'wechat_id', 'wecom_external_userid', 'email', 'platform_uid', 'store_id'];
export interface FlywheelIdentity { type: IdentityType; value: string }

export type ConsentBasis = 'customer_initiated' | 'form_opt_in' | 'offline_authorized' | 'public_business_info';
export interface FlywheelContact {
  contact_id?: string | null;
  local_id?: string | null;
  display_name?: string | null;
  identities?: FlywheelIdentity[];
  consent?: { basis: ConsentBasis; at: string };
}

export interface FlywheelRefs {
  content_id?: string | null;
  conversation_id?: string | null;
  opportunity_id?: string | null;
  quote_id?: string | null;
  contract_id?: string | null;
  payment_id?: string | null;
  external?: Array<{ system: string; id: string }>;
}

/** The types the community edition writes (spec §6): conversation.* and contact.profiled, lead.* when it saw the person first. */
export type KadadeskEventType = 'lead.created' | 'lead.touched' | 'conversation.started' | 'conversation.first_reply' | 'conversation.handoff' | 'contact.profiled';

export interface FlywheelEnvelope<T = Record<string, unknown>> {
  schema: typeof FLYWHEEL_SCHEMA;
  event_id: string;
  type: string;
  occurred_at: string;
  recorded_at: string;
  workspace_id: string;
  source: FlywheelSource;
  contact?: FlywheelContact;
  refs?: FlywheelRefs;
  is_demo: boolean;
  payload: T;
}

export type ConversationChannel = 'wechat' | 'wecom' | 'feishu' | 'dingtalk' | 'whatsapp' | 'qianniu' | 'phone' | 'web' | 'other';
export interface ConversationStartedPayload { channel: ConversationChannel; first_message_at: string }
export interface ConversationFirstReplyPayload { latency_seconds: number; by: 'ai' | 'human'; mode: 'auto' | 'review' | 'manual' }
export type HandoffReason = 'knowledge_gap' | 'price' | 'complaint' | 'media' | 'explicit_request' | 'risk' | 'other';
export const HANDOFF_REASONS: readonly HandoffReason[] = ['knowledge_gap', 'price', 'complaint', 'media', 'explicit_request', 'risk', 'other'];
/** No free text: only the classified reason. `topic` is never sent by kadadesk. */
export interface ConversationHandoffPayload { reason: HandoffReason }
export interface ProfiledFields {
  intent?: 'high' | 'medium' | 'low' | 'complaint';
  industry?: string; city?: string; need?: string; budget?: string; timeline?: string;
  decision_maker?: boolean;
}
export interface ContactProfiledPayload { fields: ProfiledFields; by: 'ai' | 'human' }
export type CaptureChannel = 'dm' | 'comment' | 'keyword' | 'form' | 'add_friend' | 'group' | 'visit' | 'event' | 'referral' | 'partner' | 'map_listing' | 'showroom_booking' | 'other';
export interface LeadPayload { capture_channel: CaptureChannel; platform?: string | null; keyword?: string; need?: string; note?: string }

/** GET /api/flywheel/keywords: a bare array (V1.0.1). */
export interface FlywheelKeywordItem { keyword: string; content_id: string; platform?: string; title: string; published_at?: string }

/** Settings kept in <userData>/flywheel/config.json. The key is NOT here: it lives in the encrypted key store. */
export interface FlywheelSettings {
  hubUrl: string;
  workspaceId: string;
  sendReceptionEvents: boolean;
  sendProfileUpdates: boolean;
  receiveExternalLeads: boolean;
  receiveSalesStages: boolean;
  /** When the owner accepted the confirmation card (what is and is not sent). Cleared on uninstall. */
  consentAt?: string;
}

export interface FlywheelAttentionItem { id: string; type: string; at: string; reason: string }
/** kind 'pair': two profiles that both have chats share a hub id or a strong identity (displayName is the other profile). */
export interface FlywheelSuspect { id: string; at: string; kind?: 'pair'; displayName: string; candidateId: string; candidateName: string; contactId?: string; via: string }

/** What the settings page gets. Never the key itself. */
export interface FlywheelView {
  /** Effective state: plugin installed + switched on + confirmed. Only then anything is sent or received. */
  active: boolean;
  installed: boolean; pluginEnabled: boolean; consented: boolean;
  settings: Omit<FlywheelSettings, 'consentAt'>;
  apiKeyConfigured: boolean;
  /** False when this computer has no encrypted key store: the key cannot be saved (it is never written in plain text). */
  keyStoreAvailable: boolean;
  sent: number; pending: number; attention: number; errors: number;
  lastSuccessAt?: string; lastError?: string; pausedReason?: string;
  keywords: number; lastKeywordsSyncAt?: string; lastFeedAt?: string;
  attentionItems: FlywheelAttentionItem[];
  suspects: FlywheelSuspect[];
}
