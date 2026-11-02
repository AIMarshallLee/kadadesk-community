import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePhoneE164,
  buildFlywheelContact,
  createFlywheelEnvelope,
  mapReceptionChannel,
  mapConversationStarted,
  mapConversationFirstReply,
  mapHandoffReason,
  mapConversationHandoff,
  mapContactProfiled,
  mapLeadCaptured,
  mapDailyHealth,
  FLYWHEEL_SCHEMA,
} from './flywheel/mapping';
import type { CustomerFact } from './customers';

test('normalizePhoneE164 formats Chinese mobile numbers to E.164', () => {
  const p1 = ['138', '0013', '8000'].join('');
  const p2 = ['199', '1234', '5678'].join('');
  assert.equal(normalizePhoneE164(p1), '+86' + p1);
  assert.equal(normalizePhoneE164('86' + p1), '+86' + p1);
  assert.equal(normalizePhoneE164(p2), '+86' + p2);
  assert.equal(normalizePhoneE164('not-a-phone'), undefined);
  assert.equal(normalizePhoneE164('12345'), undefined);
});

test('createFlywheelEnvelope produces spec-compliant envelope', () => {
  const env = createFlywheelEnvelope({
    type: 'conversation.started',
    payload: {
      channel: 'wechat',
      first_message_at: '2026-11-02T10:00:00Z',
    },
    sourceInstance: 'kadadesk-mac',
  });

  assert.equal(env.$schema, FLYWHEEL_SCHEMA);
  assert.equal(env.type, 'conversation.started');
  assert.equal(env.source.system, 'kadadesk');
  assert.equal(env.source.instance, 'kadadesk-mac');
  assert.ok(env.event_id);
  assert.ok(env.occurred_at);
  assert.ok(env.recorded_at);
  assert.equal(env.payload.channel, 'wechat');
});

test('buildFlywheelContact builds identities and drops sensitive data', () => {
  const samplePhone = ['138', '1234', '5678'].join('');
  const sensitivePhone = ['139', '9999', '9999'].join('');
  const contact = buildFlywheelContact({
    id: 'c1',
    name: '张总（相山花园）',
    flywheelContactId: 'fw_c1',
    facts: [
      { field: 'phone', value: samplePhone, source: 'customer', at: '2026-11-02T10:00:00Z' },
      { field: 'phone', value: sensitivePhone, sensitive: true, source: 'customer', at: '2026-11-02T10:00:00Z' },
      { field: 'wecom_external_userid', value: 'wm123456', source: 'import', at: '2026-11-02T10:00:00Z' },
    ],
  });

  assert.equal(contact.local_id, 'c1');
  assert.equal(contact.contact_id, 'fw_c1');
  assert.equal(contact.display_name, '张总(相山花园)');

  const phoneIdentity = contact.identities?.find(i => i.type === 'phone');
  assert.ok(phoneIdentity);
  assert.equal(phoneIdentity.value, '+86' + samplePhone);

  const wecomIdentity = contact.identities?.find(i => i.type === 'wecom_external_userid');
  assert.ok(wecomIdentity);
  assert.equal(wecomIdentity.value, 'wm123456');
});

test('mapConversationStarted and mapConversationFirstReply generate proper events', () => {
  const contact = buildFlywheelContact({ id: 'c2', name: '李女士', facts: [] });

  const started = mapConversationStarted({
    contact,
    channel: '企微',
    occurredAt: '2026-11-02T10:00:00Z',
  });
  assert.equal(started.type, 'conversation.started');
  assert.equal(started.payload.channel, 'wecom');

  const reply = mapConversationFirstReply({
    contact,
    latencySeconds: 15,
    by: 'ai',
    mode: 'auto',
  });
  assert.equal(reply.type, 'conversation.first_reply');
  assert.equal(reply.payload.latency_seconds, 15);
  assert.equal(reply.payload.by, 'ai');
  assert.equal(reply.payload.mode, 'auto');
});

test('mapConversationHandoff translates reasons safely', () => {
  const contact = buildFlywheelContact({ id: 'c3', name: '王总', facts: [] });

  assert.equal(mapHandoffReason('这个价格多少钱可以打折吗'), 'price');
  assert.equal(mapHandoffReason('你们客服态度太差了我要投诉'), 'complaint');
  assert.equal(mapHandoffReason('请转人工电话联系我'), 'explicit_request');
  assert.equal(mapHandoffReason('这个资料库里查不到'), 'knowledge_gap');

  const handoff = mapConversationHandoff({
    contact,
    detail: '请问价格多少钱？',
  });
  assert.equal(handoff.type, 'conversation.handoff');
  assert.equal(handoff.payload.reason, 'price');
});

test('mapContactProfiled strictly keeps whitelisted fields and discards sensitive ones', () => {
  const contact = buildFlywheelContact({ id: 'c4', name: '赵总', facts: [] });
  const facts: CustomerFact[] = [
    { field: 'city', value: '深圳', quote: '我住南山', source: 'customer', at: '2026-11-02T10:00:00Z' },
    { field: 'industry', value: '珠宝设计', source: 'owner', at: '2026-11-02T10:00:00Z' },
    { field: 'intent', value: '高意向', source: 'inferred', at: '2026-11-02T10:00:00Z' },
    { field: 'needs', value: '120平整装', sensitive: true, source: 'customer', at: '2026-11-02T10:00:00Z' },
    { field: 'unrelated_field', value: 'secret_info', source: 'customer', at: '2026-11-02T10:00:00Z' },
  ];

  const profiled = mapContactProfiled({
    contact,
    changedFacts: facts,
  });

  assert.ok(profiled);
  assert.equal(profiled.type, 'contact.profiled');
  assert.equal(profiled.payload.fields.city, '深圳');
  assert.equal(profiled.payload.fields.industry, '珠宝设计');
  assert.equal(profiled.payload.fields.intent, 'high');
  // sensitive fact 'needs' is dropped
  assert.equal(profiled.payload.fields.need, undefined);
  // unrelated field is dropped
  assert.equal((profiled.payload.fields as any).unrelated_field, undefined);
  // Owner fact presence makes 'by' human
  assert.equal(profiled.payload.by, 'human');
});

test('mapDailyHealth formats daily operational health metrics', () => {
  const env = mapDailyHealth({
    date: '2026-11-02',
    facts: {
      total: 50,
      replied: 48,
      within2min: 46,
      p50Seconds: 8,
      slowestSeconds: 75,
      handoff: 4,
      uncertain: 0,
      stallsByReason: {},
      failed: 1,
      knowledgeGaps: 2,
      stallMinutes: 0,
      restarts: 0,
    },
  });

  assert.equal(env.type, 'kadadesk.daily_health');
  assert.equal(env.payload.date, '2026-11-02');
  assert.equal(env.payload.conversations, 50);
  assert.equal(env.payload.replied, 48);
  assert.equal(env.payload.within_120s, 46);
  assert.equal(env.payload.p50_seconds, 8);
});
