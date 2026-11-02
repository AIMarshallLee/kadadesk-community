/**
 * 增长飞轮: what kadadesk observed → flywheel.v1 events (spec 00 §3–§5, task 03 §3).
 * Rules enforced here, whatever the caller passes:
 * - no chat text at all: handoffs carry only a reason code, never a topic; profile facts are the 7 spec fields only,
 *   never `sensitive` facts and never quotes;
 * - identities only with a consent basis: customer_initiated (the customer wrote / added us), form_opt_in (a form the
 *   customer filled, e.g. the 3D showroom), public_business_info (a 手机找客户 shop: its public store id only);
 * - every text field is masked (phone / ID / bank numbers, secrets) and cut to the schema's limit.
 */
import { randomBytes } from 'node:crypto';
import type { DailyHealthFacts } from '../reception-health';
import { fit, maskOutboundText } from './mask';
import {
  FLYWHEEL_SCHEMA, type CaptureChannel, type ConsentBasis, type ContactProfiledPayload, type ConversationChannel, type ConversationFirstReplyPayload,
  type ConversationHandoffPayload, type ConversationStartedPayload, type DailyHealthPayload, type FlywheelContact, type FlywheelEnvelope,
  type FlywheelIdentity, type FlywheelRefs, type HandoffReason, type LeadPayload, type ProfiledFields,
} from './types';

export const DEFAULT_WORKSPACE_ID = 'kunlun';
export const WORKSPACE_ID = /^[a-z0-9][a-z0-9_-]{1,62}$/;
export const CONTACT_ID = /^ct_[0-9A-HJKMNP-TV-Z]{26}$/;

/** Where events come from: this install (instance id, persisted) and the running app version. */
export interface EventContext { workspaceId: string; instance: string; version: string; now?: () => number; /** Test traffic: is_demo = true (kept by the hub, excluded from every metric). */ demo?: boolean }

/** UUID v7 (RFC 9562): 48-bit Unix milliseconds, then random bits; sortable by time. */
export function uuidV7(ms = Date.now()): string {
  const b = randomBytes(16);
  let t = Math.max(0, Math.floor(ms));
  for (let i = 5; i >= 0; i--) { b[i] = t % 256; t = Math.floor(t / 256); }
  b[6] = (b[6]! & 0x0f) | 0x70; b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** ISO 8601 with the +08:00 offset (Beijing time, as the spec examples). Valid against the schema's datetime pattern. */
export function beijingIso(ms: number): string {
  const d = new Date(ms + 8 * 3600000);
  return `${d.toISOString().slice(0, 19)}+08:00`;
}
const isoOr = (value: string | undefined, fallback: number) => { const t = value ? Date.parse(value) : NaN; return beijingIso(Number.isFinite(t) ? t : fallback); };

export function envelope<T>(ctx: EventContext, type: string, payload: T, options: { contact?: FlywheelContact; refs?: FlywheelRefs; occurredAt?: string } = {}): FlywheelEnvelope<T> {
  const now = ctx.now?.() ?? Date.now();
  const refs = options.refs ? Object.fromEntries(Object.entries(options.refs).filter(([, v]) => v !== undefined && v !== null && v !== '')) : undefined;
  return {
    schema: FLYWHEEL_SCHEMA,
    event_id: uuidV7(now),
    type,
    occurred_at: isoOr(options.occurredAt, now),
    recorded_at: beijingIso(now),
    workspace_id: ctx.workspaceId,
    source: { system: 'kadadesk', instance: ctx.instance.slice(0, 64), version: ctx.version.slice(0, 32) },
    ...(options.contact ? { contact: options.contact } : {}),
    ...(refs && Object.keys(refs).length ? { refs } : {}),
    is_demo: ctx.demo === true,
    payload,
  };
}

// ——— contacts ———

export interface ProfileFactLike { field: string; value: string; source: string; sensitive?: boolean; at?: string }
export interface ProfileLike { id: string; name: string; facts: ProfileFactLike[]; flywheelContactId?: string; lastContactAt?: string }

/** Mainland mobile numbers become E.164 (+86…); other numbers already in + form are kept; anything else is dropped. */
export function phoneE164(value: string): string | undefined {
  const s = value.normalize('NFKC').replace(/[\s()-]/g, '');
  const cn = /^(?:\+?86)?(1[3-9]\d{9})$/.exec(s); if (cn) return `+86${cn[1]}`;
  return /^\+[1-9]\d{6,14}$/.test(s) ? s : undefined;
}
const latest = (p: ProfileLike, field: string, sources?: string[]) => [...p.facts].reverse().find(f => f.field === field && !f.sensitive && (!sources || sources.includes(f.source)))?.value?.trim();

/**
 * How a contact is identified:
 * - 'customer': the customer wrote to us — the chat remark name plus strong ids we hold (a phone only if the customer
 *   gave it), basis customer_initiated;
 * - 'form': the customer filled a form (3D showroom booking) — the phone from the form, basis form_opt_in;
 * - 'store': a 手机找客户 shop we found — only its public store id, basis public_business_info;
 * - 'none': no identities (contact_id / local_id only).
 */
export type IdentityMode = 'customer' | 'form' | 'store' | 'none';
export function contactFor(p: ProfileLike, mode: IdentityMode, at: string, extra: { storeId?: string; formPhone?: string } = {}): FlywheelContact {
  const ids: FlywheelIdentity[] = [];
  const add = (type: FlywheelIdentity['type'], value: string | undefined) => { const v = value?.trim(); if (v && v.length <= 128 && !ids.some(i => i.type === type && i.value === v)) ids.push({ type, value: v }); };
  let basis: ConsentBasis | undefined;
  if (mode === 'customer') {
    basis = 'customer_initiated';
    add('wechat_remark', [...maskOutboundText(p.name)].slice(0, 128).join(''));
    const phone = latest(p, 'phone', ['customer']); if (phone) add('phone', phoneE164(phone));
    add('wechat_id', latest(p, 'wechatId'));
    add('wecom_external_userid', latest(p, 'wecomId'));
    const uid = latest(p, 'platformUid'); if (uid && /^[a-z0-9_]+:.+$/.test(uid)) add('platform_uid', uid);
    const email = latest(p, 'email', ['customer']); if (email && /^[^\s@]+@[^\s@]+$/.test(email)) add('email', email.toLowerCase());
  } else if (mode === 'form') {
    basis = 'form_opt_in';
    if (extra.formPhone) add('phone', phoneE164(extra.formPhone));
  } else if (mode === 'store') {
    basis = 'public_business_info';
    if (extra.storeId && /^[a-z0-9_]+:.+$/.test(extra.storeId)) add('store_id', [...extra.storeId].slice(0, 128).join(''));
  }
  const contactId = p.flywheelContactId && CONTACT_ID.test(p.flywheelContactId) ? p.flywheelContactId : null;
  return {
    contact_id: contactId,
    local_id: p.id.slice(0, 128),
    display_name: fit(p.name, 64) ?? null,
    ...(ids.length && basis ? { identities: ids.slice(0, 10), consent: { basis, at } } : {}),
  };
}

// ——— reception ———

export function conversationStarted(ctx: EventContext, contact: FlywheelContact, channel: ConversationChannel, firstMessageAt: string, conversationId?: string) {
  const at = isoOr(firstMessageAt, ctx.now?.() ?? Date.now());
  const payload: ConversationStartedPayload = { channel, first_message_at: at };
  return envelope(ctx, 'conversation.started', payload, { contact, occurredAt: at, refs: { conversation_id: conversationId } });
}

export function conversationFirstReply(ctx: EventContext, contact: FlywheelContact, input: { latencySeconds: number; by: 'ai' | 'human'; mode: 'auto' | 'review' | 'manual'; at: string; conversationId?: string }) {
  const payload: ConversationFirstReplyPayload = { latency_seconds: Math.max(0, Math.round(Number.isFinite(input.latencySeconds) ? input.latencySeconds : 0)), by: input.by, mode: input.mode };
  return envelope(ctx, 'conversation.first_reply', payload, { contact, occurredAt: input.at, refs: { conversation_id: input.conversationId } });
}

/**
 * Structured handoff causes set by the reception code where it hands a chat over (never derived from chat text).
 * Each maps to one spec reason; anything without a cause is `other`.
 */
export type HandoffCause = 'knowledge-gap' | 'price' | 'complaint' | 'media' | 'customer-asked' | 'risk' | 'keyword-rule' | 'owner-active' | 'technical' | 'other';
const CAUSE_REASON: Record<Exclude<HandoffCause, 'keyword-rule'>, HandoffReason> = {
  'knowledge-gap': 'knowledge_gap', price: 'price', complaint: 'complaint', media: 'media', 'customer-asked': 'explicit_request', risk: 'risk', 'owner-active': 'other', technical: 'other', other: 'other',
};
/** A 转人工 keyword rule: the OWNER's configured keyword (not the customer's text) tells what kind of rule it is. */
export function ruleKeywordReason(keyword: string | undefined): HandoffReason {
  const k = (keyword ?? '').normalize('NFKC');
  if (/人工|真人|客服|老板|店长|经理|找人|电话/u.test(k)) return 'explicit_request';
  if (/投诉|差评|退款|退货|维权|曝光|骗/u.test(k)) return 'complaint';
  if (/价|钱|优惠|折扣|便宜|报价|费用/u.test(k)) return 'price';
  return 'other';
}
export function handoffReason(cause: HandoffCause | undefined, ruleKeyword?: string): HandoffReason {
  if (cause === 'keyword-rule') return ruleKeywordReason(ruleKeyword);
  return cause ? CAUSE_REASON[cause] ?? 'other' : 'other';
}
export function conversationHandoff(ctx: EventContext, contact: FlywheelContact, reason: HandoffReason, at: string, conversationId?: string) {
  const payload: ConversationHandoffPayload = { reason };
  return envelope(ctx, 'conversation.handoff', payload, { contact, occurredAt: at, refs: { conversation_id: conversationId } });
}

// ——— profile ———

export function mapIntent(value: string): ProfiledFields['intent'] {
  const s = value.normalize('NFKC').trim().toLowerCase();
  if (/投诉|complaint/.test(s)) return 'complaint';
  if (/^(高|high|强|很高)/.test(s) || s === '高意向') return 'high';
  if (/^(中|medium|一般)/.test(s)) return 'medium';
  if (/^(低|low|弱)/.test(s)) return 'low';
  return undefined;
}

/** 谁拍板 → whether this customer decides. Negations and other deciders come first; unclear values are not sent. */
export function parseDecisionMaker(value: string): boolean | undefined {
  const s = value.normalize('NFKC').replace(/\s+/g, '');
  if (!s) return undefined;
  if (/^(否|不是|no|false)$/i.test(s)) return false;
  if (/^(是|yes|true)$/i.test(s)) return true;
  if (/不是|不能|没法|无法|做不了主|不拍板|不说了算|不负责|不由|要问|得问|需要问|问问|商量|请示|汇报|审批|同意才|老婆|老公|爱人|家里|领导|上级|合伙人|股东|总部|别人|其他人/u.test(s)) return false;
  if (/本人|自己|我说了算|我定|我拍板|他说了算|她说了算|他定|她定|他拍板|她拍板|就是老板|是老板|自己是老板/u.test(s)) return true;
  return undefined;
}

const PROFILE_FIELD = (field: string): keyof ProfiledFields | undefined => {
  if (field === 'industry') return 'industry';
  if (field === 'city') return 'city';
  const m = /^biz\.[^.]+\.(intent|needs|budget|timeline|decisionMaker)$/.exec(field); if (!m) return undefined;
  return ({ intent: 'intent', needs: 'need', budget: 'budget', timeline: 'timeline', decisionMaker: 'decision_maker' } as const)[m[1] as 'intent'];
};
const LIMITS: Partial<Record<keyof ProfiledFields, number>> = { industry: 32, city: 32, need: 200, budget: 32, timeline: 32 };

/** Owner / import facts → by human; customer / inferred → by ai. One event per side that has something to say. */
export function contactProfiled(ctx: EventContext, contact: FlywheelContact, facts: ProfileFactLike[], at: string): FlywheelEnvelope<ContactProfiledPayload>[] {
  const groups: Record<'human' | 'ai', ProfiledFields> = { human: {}, ai: {} };
  for (const f of facts) {
    if (f.sensitive) continue;
    const key = PROFILE_FIELD(f.field); if (!key) continue;
    const by = f.source === 'owner' || f.source === 'import' ? 'human' : f.source === 'customer' || f.source === 'inferred' ? 'ai' : undefined; if (!by) continue;
    const fields = groups[by] as Record<string, unknown>;
    if (key === 'intent') { const v = mapIntent(f.value); if (v) fields.intent = v; }
    else if (key === 'decision_maker') { const v = parseDecisionMaker(f.value); if (v !== undefined) fields.decision_maker = v; }
    else { const v = fit(f.value, LIMITS[key]!); if (v) fields[key] = v; }
  }
  return (['human', 'ai'] as const).filter(by => Object.keys(groups[by]).length).map(by => envelope(ctx, 'contact.profiled', { fields: groups[by], by }, { contact, occurredAt: at }));
}

// ——— leads ———

export function lead(ctx: EventContext, contact: FlywheelContact, input: { first: boolean; channel: CaptureChannel; at: string; platform?: string; keyword?: string; contentId?: string; need?: string; note?: string }): FlywheelEnvelope<LeadPayload> | undefined {
  const keyword = fit(input.keyword, 20);
  if (input.channel === 'keyword' && !keyword) return undefined;
  const payload: LeadPayload = {
    capture_channel: input.channel,
    ...(input.platform ? { platform: fit(input.platform, 32) ?? null } : {}),
    ...(keyword ? { keyword } : {}),
    ...(fit(input.need, 200) ? { need: fit(input.need, 200) } : {}),
    ...(fit(input.note, 200) ? { note: fit(input.note, 200) } : {}),
  };
  const contentId = input.contentId ? [...input.contentId].slice(0, 128).join('') : undefined;
  return envelope(ctx, input.first ? 'lead.created' : 'lead.touched', payload, { contact, occurredAt: input.at, refs: { content_id: contentId } });
}

// ——— daily health ———

export function dailyHealth(ctx: EventContext, date: string, f: DailyHealthFacts & { within1min?: number }): FlywheelEnvelope<DailyHealthPayload> {
  const int = (n: unknown) => Number.isFinite(n) ? Math.max(0, Math.round(n as number)) : 0;
  const payload: DailyHealthPayload = {
    date, conversations: int(f.total), replied: int(f.replied),
    ...(f.within1min !== undefined ? { within_60s: int(f.within1min) } : {}),
    within_120s: int(f.within2min),
    p50_seconds: f.replied > 0 ? Math.max(0, f.p50Seconds) : null,
    slowest_seconds: f.replied > 0 ? Math.max(0, f.slowestSeconds) : null,
    handoffs: int(f.handoff), failed: int(f.failed), knowledge_gaps: int(f.knowledgeGaps),
    stall_minutes: Math.max(0, Number.isFinite(f.stallMinutes) ? f.stallMinutes : 0), restarts: int(f.restarts),
  };
  return envelope(ctx, 'kadadesk.daily_health', payload, {});
}
