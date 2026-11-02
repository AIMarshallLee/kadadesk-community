/**
 * Flywheel v1 Types (增长飞轮数据底座统一接口规范 V1.0)
 */

export interface FlywheelSource {
  system: 'kadadesk' | 'content-factory' | 'crm' | 'feishu-bitable' | 'web';
  instance: string;
  version: string;
}

export interface FlywheelIdentity {
  type: 'phone' | 'wechat_id' | 'wecom_external_userid' | 'email' | 'platform_uid' | 'store_id' | 'wechat_remark' | 'company_name';
  value: string;
}

export interface FlywheelContact {
  contact_id?: string | null;
  local_id: string;
  display_name: string;
  identities?: FlywheelIdentity[];
  consent?: {
    basis: 'customer_initiated' | 'public_business_info' | 'explicit_opt_in' | 'contract_execution' | 'offline_visit';
    at?: string;
  };
}

export interface FlywheelRefs {
  content_id?: string;
  lead_id?: string;
  opportunity_id?: string;
  contract_id?: string;
  payment_id?: string;
}

export interface DailyHealthFacts {
  total: number;
  replied: number;
  within2min: number;
  p50Seconds: number;
  slowestSeconds: number;
  handoff: number;
  uncertain: number;
  failed: number;
  knowledgeGaps: number;
  stallMinutes: number;
  stallsByReason: Record<string, number>;
  restarts: number;
}

export type FlywheelEventType =
  | 'content.published'
  | 'content.metrics'
  | 'lead.created'
  | 'lead.touched'
  | 'conversation.started'
  | 'conversation.first_reply'
  | 'conversation.handoff'
  | 'contact.profiled'
  | 'kadadesk.daily_health'
  | 'opportunity.created'
  | 'stage.changed'
  | 'followup.scheduled'
  | 'followup.completed'
  | 'quote.sent'
  | 'contract.signed'
  | 'payment.recorded'
  | 'payment.verified'
  | 'deal.lost'
  | 'visit.scheduled'
  | 'visit.done';

export interface FlywheelEnvelope<T = Record<string, unknown>> {
  $schema: 'flywheel.v1';
  event_id: string;
  type: FlywheelEventType;
  occurred_at: string;
  recorded_at: string;
  workspace_id: string;
  source: FlywheelSource;
  contact?: FlywheelContact;
  refs?: FlywheelRefs;
  is_demo?: boolean;
  payload: T;
}

export interface ConversationStartedPayload {
  channel: 'wechat' | 'wecom' | 'feishu' | 'dingtalk' | 'whatsapp' | 'qianniu' | 'phone' | 'web' | 'other';
  first_message_at: string;
}

export interface ConversationFirstReplyPayload {
  latency_seconds: number;
  by: 'ai' | 'human';
  mode: 'auto' | 'review' | 'manual';
}

export interface ConversationHandoffPayload {
  reason: 'knowledge_gap' | 'price' | 'complaint' | 'media' | 'explicit_request' | 'risk' | 'other';
  topic?: string;
}

export interface ContactProfiledPayload {
  fields: {
    intent?: 'high' | 'medium' | 'low' | 'complaint';
    industry?: string;
    city?: string;
    need?: string;
    budget?: string;
    timeline?: string;
    decision_maker?: boolean;
  };
  by: 'ai' | 'human';
}

export interface LeadCreatedPayload {
  capture_channel:
    | 'dm'
    | 'comment'
    | 'keyword'
    | 'form'
    | 'add_friend'
    | 'group'
    | 'visit'
    | 'event'
    | 'referral'
    | 'partner'
    | 'map_listing'
    | 'showroom_booking'
    | 'other';
  platform?: string;
  keyword?: string;
  campaign?: string;
  landing_page?: string;
  utm?: {
    source?: string;
    medium?: string;
    campaign?: string;
  };
  partner_code?: string;
  need?: string;
  note?: string;
}

export interface DailyHealthPayload {
  date: string;
  conversations: number;
  replied: number;
  within_60s?: number;
  within_120s?: number;
  p50_seconds?: number;
  slowest_seconds?: number;
  handoffs?: number;
  failed?: number;
  knowledge_gaps?: number;
  stall_minutes?: number;
  restarts?: number;
}

export interface FlywheelKeywordItem {
  keyword: string;
  content_id: string;
  platform?: string;
  title: string;
  published_at?: string;
  reply_text?: string;
  reply_media_url?: string;
}

export interface FlywheelPluginConfig {
  enabled: boolean;
  hubUrl: string;
  apiKey: string;
  workspaceId: string;
  sendReceptionEvents: boolean;
  sendProfileUpdates: boolean;
  receiveExternalLeads: boolean;
  receiveSalesStages: boolean;
}

export interface FlywheelPluginState {
  sentCount: number;
  pendingCount: number;
  errorCount: number;
  lastSuccessAt?: string;
  lastError?: string;
  lastFeedCursor?: string;
  lastKeywordsSyncAt?: string;
}
