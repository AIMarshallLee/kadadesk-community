/**
 * 飞轮事件映射层与安全护栏 (Flywheel Mapping & Guardrails)
 * 严格按照《增长飞轮数据底座统一接口规范 V1.0》进行转换与脱敏
 */

import { randomUUID } from 'node:crypto';
import { redactSecrets } from '../secret-guard';
import type { CustomerProfile, CustomerFact } from '../customers';
import type {
  FlywheelEnvelope,
  FlywheelSource,
  FlywheelContact,
  FlywheelIdentity,
  ConversationStartedPayload,
  ConversationFirstReplyPayload,
  ConversationHandoffPayload,
  ContactProfiledPayload,
  LeadCreatedPayload,
  DailyHealthPayload,
  DailyHealthFacts,
} from './types';

export const FLYWHEEL_SCHEMA = 'flywheel.v1';
export const DEFAULT_WORKSPACE_ID = 'kunlun';
export const KADADESK_VERSION = 'v0.8.51';

export function normalizePhoneE164(phone: string): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+86${digits}`;
  }
  if (digits.length === 13 && digits.startsWith('861')) {
    return `+${digits}`;
  }
  return undefined;
}

export function buildFlywheelContact(
  profile: Pick<CustomerProfile, 'id' | 'name' | 'facts' | 'flywheelContactId'>,
  consentBasis: 'customer_initiated' | 'public_business_info' = 'customer_initiated',
  occurredAt?: string
): FlywheelContact {
  const identities: FlywheelIdentity[] = [];

  if (profile.name) {
    identities.push({
      type: 'wechat_remark',
      value: profile.name.slice(0, 80),
    });
  }

  const phoneFact = profile.facts?.find(f => f.field === 'phone' && !f.sensitive);
  if (phoneFact?.value) {
    const e164 = normalizePhoneE164(phoneFact.value);
    if (e164) {
      identities.push({
        type: 'phone',
        value: e164,
      });
    }
  }

  const wecomFact = profile.facts?.find(f => f.field === 'wecom_external_userid' && !f.sensitive);
  if (wecomFact?.value) {
    identities.push({
      type: 'wecom_external_userid',
      value: wecomFact.value.trim(),
    });
  }

  return {
    contact_id: profile.flywheelContactId || null,
    local_id: profile.id,
    display_name: redactSecrets(profile.name || '客户').text.slice(0, 60),
    identities: identities.length > 0 ? identities : undefined,
    consent: {
      basis: consentBasis,
      at: occurredAt || new Date().toISOString(),
    },
  };
}

export function createFlywheelEnvelope<T = any>(params: {
  type: FlywheelEnvelope['type'];
  payload: T;
  contact?: FlywheelContact;
  refs?: FlywheelEnvelope['refs'];
  occurredAt?: string;
  workspaceId?: string;
  sourceInstance?: string;
  version?: string;
}): FlywheelEnvelope<T> {
  const nowIso = new Date().toISOString();
  const occurredAt = params.occurredAt && Number.isFinite(Date.parse(params.occurredAt)) ? params.occurredAt : nowIso;

  const source: FlywheelSource = {
    system: 'kadadesk',
    instance: params.sourceInstance || 'desktop-main',
    version: params.version || KADADESK_VERSION,
  };

  const sanitizedPayload = sanitizePayload(params.payload);

  return {
    $schema: FLYWHEEL_SCHEMA,
    event_id: randomUUID(),
    type: params.type,
    occurred_at: occurredAt,
    recorded_at: nowIso,
    workspace_id: params.workspaceId || DEFAULT_WORKSPACE_ID,
    source,
    ...(params.contact ? { contact: params.contact } : {}),
    ...(params.refs && Object.keys(params.refs).length > 0 ? { refs: params.refs } : {}),
    is_demo: false,
    payload: sanitizedPayload as T,
  };
}

function sanitizePayload<T>(input: T): T {
  if (typeof input === 'string') {
    return redactSecrets(input).text as unknown as T;
  }
  if (Array.isArray(input)) {
    return input.map(item => sanitizePayload(item)) as unknown as T;
  }
  if (input !== null && typeof input === 'object') {
    const res: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      res[k] = sanitizePayload(v);
    }
    return res as unknown as T;
  }
  return input;
}

export function mapReceptionChannel(channel?: string): ConversationStartedPayload['channel'] {
  const ch = channel?.toLowerCase() || '';
  if (ch.includes('wecom') || ch.includes('企微')) return 'wecom';
  if (ch.includes('feishu') || ch.includes('飞书')) return 'feishu';
  if (ch.includes('dingtalk') || ch.includes('钉钉')) return 'dingtalk';
  if (ch.includes('whatsapp')) return 'whatsapp';
  if (ch.includes('qianniu') || ch.includes('千牛')) return 'qianniu';
  if (ch.includes('phone') || ch.includes('手机')) return 'phone';
  if (ch.includes('web')) return 'web';
  return 'wechat';
}

export function mapConversationStarted(params: {
  contact: FlywheelContact;
  channel?: string;
  firstMessageAt?: string;
  occurredAt?: string;
  workspaceId?: string;
}): FlywheelEnvelope<ConversationStartedPayload> {
  const payload: ConversationStartedPayload = {
    channel: mapReceptionChannel(params.channel),
    first_message_at: params.firstMessageAt || params.occurredAt || new Date().toISOString(),
  };

  return createFlywheelEnvelope({
    type: 'conversation.started',
    contact: params.contact,
    payload,
    occurredAt: params.occurredAt,
    workspaceId: params.workspaceId,
  });
}

export function mapConversationFirstReply(params: {
  contact: FlywheelContact;
  latencySeconds: number;
  by?: 'ai' | 'human';
  mode?: 'auto' | 'review' | 'manual';
  occurredAt?: string;
  workspaceId?: string;
}): FlywheelEnvelope<ConversationFirstReplyPayload> {
  const payload: ConversationFirstReplyPayload = {
    latency_seconds: Math.max(0, Math.round(params.latencySeconds)),
    by: params.by || 'ai',
    mode: params.mode || 'auto',
  };

  return createFlywheelEnvelope({
    type: 'conversation.first_reply',
    contact: params.contact,
    payload,
    occurredAt: params.occurredAt,
    workspaceId: params.workspaceId,
  });
}

export function mapHandoffReason(detail?: string): ConversationHandoffPayload['reason'] {
  const d = detail?.toLowerCase() || '';
  if (/知识|资料|答案|没找到|未覆盖|不知道/u.test(d)) return 'knowledge_gap';
  if (/价|费用|优惠|折扣|多少钱|贵/u.test(d)) return 'price';
  if (/投诉|差评|态度|生气|不满|骗/u.test(d)) return 'complaint';
  if (/图|文件|视频|语音|看不了/u.test(d)) return 'media';
  if (/人工|真人|老板|转接|电话|聊天软件/u.test(d)) return 'explicit_request';
  if (/密码|账号|验证码|安全|隐私|泄露/u.test(d)) return 'risk';
  return 'other';
}

export function mapConversationHandoff(params: {
  contact: FlywheelContact;
  detail: string;
  topic?: string;
  occurredAt?: string;
  workspaceId?: string;
}): FlywheelEnvelope<ConversationHandoffPayload> {
  const reason = mapHandoffReason(params.detail);
  const topic = params.topic ? redactSecrets(params.topic).text.slice(0, 50) : undefined;

  const payload: ConversationHandoffPayload = {
    reason,
    ...(topic ? { topic } : {}),
  };

  return createFlywheelEnvelope({
    type: 'conversation.handoff',
    contact: params.contact,
    payload,
    occurredAt: params.occurredAt,
    workspaceId: params.workspaceId,
  });
}

export function mapCustomerIntent(intentStr?: string): 'high' | 'medium' | 'low' | 'complaint' | undefined {
  if (!intentStr) return undefined;
  const s = intentStr.trim();
  if (s.includes('高') || s.toLowerCase() === 'high') return 'high';
  if (s.includes('中') || s.toLowerCase() === 'medium') return 'medium';
  if (s.includes('低') || s.toLowerCase() === 'low') return 'low';
  if (s.includes('投诉') || s.toLowerCase() === 'complaint') return 'complaint';
  return undefined;
}

export function mapDecisionMaker(value?: string): boolean | undefined {
  if (!value) return undefined;
  const s = value.trim();
  if (/是|本人|自己|老板|拍板|决定|负责人/u.test(s)) return true;
  if (/否|商量|问老婆|问老公|问领导|汇报|不是/u.test(s)) return false;
  return undefined;
}

export function mapContactProfiled(params: {
  contact: FlywheelContact;
  changedFacts: Array<Pick<CustomerFact, 'field' | 'value' | 'source' | 'sensitive'>>;
  occurredAt?: string;
  workspaceId?: string;
}): FlywheelEnvelope<ContactProfiledPayload> | null {
  const fields: ContactProfiledPayload['fields'] = {};
  let hasHumanSource = false;

  for (const fact of params.changedFacts) {
    if (fact.sensitive) continue;

    const key = fact.field;
    const val = fact.value?.trim();
    if (!val) continue;

    if (fact.source === 'owner' || fact.source === 'import') {
      hasHumanSource = true;
    }

    if (key === 'industry') {
      fields.industry = redactSecrets(val).text.slice(0, 40);
    } else if (key === 'city') {
      fields.city = redactSecrets(val).text.slice(0, 30);
    } else if (key.endsWith('.intent') || key === 'intent') {
      const mapped = mapCustomerIntent(val);
      if (mapped) fields.intent = mapped;
    } else if (key.endsWith('.needs') || key === 'needs' || key === 'need') {
      fields.need = redactSecrets(val).text.slice(0, 200);
    } else if (key.endsWith('.budget') || key === 'budget') {
      fields.budget = redactSecrets(val).text.slice(0, 60);
    } else if (key.endsWith('.timeline') || key === 'timeline') {
      fields.timeline = redactSecrets(val).text.slice(0, 60);
    } else if (key.endsWith('.decisionMaker') || key === 'decisionMaker') {
      const dm = mapDecisionMaker(val);
      if (dm !== undefined) fields.decision_maker = dm;
    }
  }

  if (Object.keys(fields).length === 0) {
    return null;
  }

  const payload: ContactProfiledPayload = {
    fields,
    by: hasHumanSource ? 'human' : 'ai',
  };

  return createFlywheelEnvelope({
    type: 'contact.profiled',
    contact: params.contact,
    payload,
    occurredAt: params.occurredAt,
    workspaceId: params.workspaceId,
  });
}

export function mapLeadCaptured(params: {
  contact: FlywheelContact;
  isFirstTime: boolean;
  captureChannel: LeadCreatedPayload['capture_channel'];
  contentId?: string;
  keyword?: string;
  need?: string;
  note?: string;
  occurredAt?: string;
  workspaceId?: string;
}): FlywheelEnvelope<LeadCreatedPayload> {
  const payload: LeadCreatedPayload = {
    capture_channel: params.captureChannel,
    ...(params.keyword ? { keyword: redactSecrets(params.keyword).text.slice(0, 60) } : {}),
    ...(params.need ? { need: redactSecrets(params.need).text.slice(0, 200) } : {}),
    ...(params.note ? { note: redactSecrets(params.note).text.slice(0, 200) } : {}),
  };

  return createFlywheelEnvelope({
    type: params.isFirstTime ? 'lead.created' : 'lead.touched',
    contact: params.contact,
    refs: params.contentId ? { content_id: params.contentId } : undefined,
    payload,
    occurredAt: params.occurredAt,
    workspaceId: params.workspaceId,
  });
}

export function mapDailyHealth(params: {
  date: string;
  facts: DailyHealthFacts;
  occurredAt?: string;
  workspaceId?: string;
}): FlywheelEnvelope<DailyHealthPayload> {
  const f = params.facts;
  const payload: DailyHealthPayload = {
    date: params.date,
    conversations: f.total,
    replied: f.replied,
    within_120s: f.within2min,
    p50_seconds: f.p50Seconds,
    slowest_seconds: f.slowestSeconds,
    handoffs: f.handoff,
    failed: f.failed,
    knowledge_gaps: f.knowledgeGaps,
    stall_minutes: f.stallMinutes,
    restarts: f.restarts,
  };

  return createFlywheelEnvelope({
    type: 'kadadesk.daily_health',
    payload,
    occurredAt: params.occurredAt,
    workspaceId: params.workspaceId,
  });
}
