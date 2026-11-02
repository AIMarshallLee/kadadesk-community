import test from 'node:test';
import assert from 'node:assert/strict';
import { currentValue, findProfile } from '../shared/customers';
import { harness, startFakeHub } from './flywheel-test-kit';
import type { FlywheelCustomersPort } from './flywheel-connect';
import type { FlywheelEnvelope } from '../shared/flywheel/types';

// The hub resolves two kadadesk records to one person after the fact (content factory first, the chat later).
const PHONE = '13900005678';
const A = 'ct_01M6EDE55PMP8YFWZS7YDE5H59';
let seq = 0;
const ev = (type: string, contact: Record<string, unknown>, payload: Record<string, unknown>, system = 'content-factory') => ({
  schema: 'flywheel.v1', event_id: `00000000-0000-7000-8000-${String(++seq).padStart(12, '0')}`, type, occurred_at: '2026-11-02T10:00:00+08:00', recorded_at: '2026-11-02T10:00:00+08:00',
  workspace_id: 'kunlun', source: { system, instance: 'x' }, is_demo: false, contact, payload,
}) as unknown as FlywheelEnvelope<Record<string, unknown>>;
const cfLead = () => ev('lead.created', { contact_id: A, local_id: 'cf_1', display_name: '李总', identities: [{ type: 'phone', value: PHONE }] }, { capture_channel: 'comment', need: '评论区要获客表' });
const stage = (contactId: string, to: string, identities?: Array<{ type: string; value: string }>) => ev('stage.changed', { contact_id: contactId, ...(identities ? { identities } : {}) }, { opportunity_id: 'op1', from: 'NEW', to }, 'crm');
const capturePhone = async () => JSON.stringify({ facts: [{ field: 'phone', value: PHONE, quote: PHONE }], lines: [{ line: 'soft', intent: '高' }] });

test('CF first, hub returns the same contact id for the chat: the pre-created 未接触 profile is merged into the chat profile; sales lands on it', async t => {
  const h = await harness(); t.after(() => h.close());
  const store = () => h.customers._state().store;
  h.hub.feed = [cfLead()];
  await h.manager.sync();
  assert.equal(store().profiles.length, 1);
  const pre = store().profiles[0]!;
  assert.deepEqual(pre.tags, ['未接触']); assert.equal(pre.flywheelContactId, A);

  // The same customer chats under another name; the hub links the chat to contact A (receipt).
  await h.emit({ kind: 'incoming', conversation: '李总（即时通讯）', text: '获客表', first: true, channel: 'desk', app: 'wechat' });
  const chat = findProfile(store(), '李总（即时通讯）', 'desk')!;
  assert.notEqual(chat.id, pre.id); assert.equal(store().profiles.length, 2);
  h.hub.contactIds.set(chat.id, A);
  await h.manager.flush(); await h.settle();

  assert.equal(store().profiles.length, 1, 'one profile remains');
  const one = store().profiles[0]!;
  assert.equal(one.id, chat.id); assert.equal(one.name, '李总（即时通讯）'); assert.equal(one.flywheelContactId, A);
  assert.ok(one.aliases.includes('李总'));
  assert.ok(!one.tags.includes('未接触'), 'the chat profile is not marked 未接触');
  assert.equal(currentValue(one, 'phone'), PHONE, 'facts of the pre-created profile kept');
  assert.ok(one.facts.some(f => f.field === 'source' && f.value.includes('内容工厂')), 'source kept');
  assert.ok(one.facts.some(f => f.value === '评论区要获客表'), 'need kept');
  assert.ok(one.lastContactAt);

  // CRM stage for contact A
  h.hub.feed.push(stage(A, 'QUALIFIED'));
  await h.manager.sync();
  assert.equal(store().profiles.length, 1);
  assert.equal(store().profiles[0]!.salesStage?.stage, 'QUALIFIED');
  assert.equal(h.manager.view().suspects.length, 0);
});

test('CF first, the chat gets its own hub id but tells the same phone: merged on the receipt; the old id still routes CRM stages (probe scenario)', async t => {
  const h = await harness({ customersDeps: { writeText: capturePhone } }); t.after(() => h.close());
  const store = () => h.customers._state().store;
  h.hub.feed = [cfLead()];
  await h.manager.sync();
  const NAME = '李总（即时通讯）';
  await h.emit({ kind: 'incoming', conversation: NAME, text: '获客表', first: true, channel: 'desk', app: 'wechat' });
  await h.manager.flush(); await h.settle();
  const chat = findProfile(store(), NAME, 'desk')!;
  const B = chat.flywheelContactId!;
  assert.ok(B && B !== A); assert.equal(store().profiles.length, 2, 'no phone yet: nothing in common');

  // capture: the customer sends the phone → profile event → receipt (same id B) → reconciled on the shared phone
  h.clock.now += 30_000;
  await h.emit({ kind: 'incoming', conversation: NAME, text: `发我手机吧 ${PHONE}`, first: false, channel: 'desk', app: 'wechat' });
  h.customers.onTranscript({ channel: 'desk', conversationId: 'c2', conversationName: NAME, kind: 'direct', messages: [{ direction: 'incoming', text: '获客表' }, { direction: 'incoming', text: `发我手机吧 ${PHONE}` }], reason: 'incoming' } as never);
  h.clock.now += 11 * 60_000; await h.customers.tick(); await h.settle();
  await h.manager.flush(); await h.settle();

  assert.deepEqual(store().profiles.map(p => p.name), [NAME], 'one profile for this person');
  const one = store().profiles[0]!;
  assert.equal(one.flywheelContactId, B); assert.deepEqual(one.flywheelAltIds, [A]);
  assert.ok(one.facts.some(f => f.value === '评论区要获客表'));

  // the hub merged B into A: CRM events now carry A
  h.hub.feed.push(stage(A, 'QUALIFIED'));
  await h.manager.sync();
  assert.equal(store().profiles.length, 1);
  assert.equal(store().profiles[0]!.salesStage?.stage, 'QUALIFIED');
});

test('feed after the chat: a lead for the pre-created id is merged into the chat profile that shares the phone; applySales never picks the 未接触 one', async t => {
  const h = await harness(); t.after(() => h.close());
  const store = () => h.customers._state().store;
  // Two records exist before any link (e.g. restored from an older version): a pre-created and a chat profile with the same id.
  h.hub.feed = [cfLead()];
  await h.manager.sync();
  await h.emit({ kind: 'incoming', conversation: '李总（即时通讯）', text: 'hi', first: true });
  const chat = findProfile(store(), '李总（即时通讯）')!;
  chat.flywheelContactId = A; // same id, written before this fix
  // applySales by id prefers the chat profile, and merges the pre-created one into it
  assert.equal(await h.customers.flywheel.applySales({ contactId: A, type: 'stage.changed', to: 'PROPOSAL' }), true);
  assert.equal(store().profiles.length, 1);
  assert.equal(store().profiles[0]!.id, chat.id); assert.equal(store().profiles[0]!.salesStage?.stage, 'PROPOSAL');
});

test('both profiles have chats: no automatic merge, one 疑似同一人 prompt; 是同一人 merges, 不是 is not asked again', async t => {
  const h = await harness(); t.after(() => h.close());
  const store = () => h.customers._state().store;
  const C = 'ct_01M6EDE5KGJ1XA64ZWDR9NKE9C';
  await h.emit({ kind: 'incoming', conversation: '王姐', text: 'hi', first: true });
  h.clock.now += 60_000;
  await h.emit({ kind: 'incoming', conversation: '王姐小号', text: 'hi', first: true });
  const p1 = findProfile(store(), '王姐')!, p2 = findProfile(store(), '王姐小号')!;
  h.hub.contactIds.set(p1.id, C); h.hub.contactIds.set(p2.id, C);
  await h.manager.flush(); await h.settle();
  assert.equal(store().profiles.length, 2, 'never merged automatically');
  const s = h.manager.view().suspects;
  assert.equal(s.length, 1); assert.equal(s[0]!.kind, 'pair');
  assert.deepEqual([s[0]!.displayName, s[0]!.candidateName].sort(), ['王姐', '王姐小号']);
  assert.equal(h.notices.length, 1);
  // more events for the same pair: still one prompt
  h.clock.now += 60_000;
  await h.emit({ kind: 'handoff', conversation: '王姐', text: '', detail: '', cause: 'media' });
  await h.manager.flush(); await h.settle();
  assert.equal(h.manager.view().suspects.length, 1);
  // sales for C goes to one profile (the latest chat), never to both
  assert.equal(await h.customers.flywheel.applySales({ contactId: C, type: 'stage.changed', to: 'PROPOSAL' }), true);
  assert.equal(store().profiles.filter(p => p.salesStage?.stage === 'PROPOSAL').length, 1);
  // 是同一人 → one profile with both names
  await h.manager.answerSuspect(s[0]!.id, true);
  assert.equal(store().profiles.length, 1);
  const one = store().profiles[0]!;
  assert.deepEqual([one.name, ...one.aliases].sort(), ['王姐', '王姐小号']);
  assert.equal(one.flywheelContactId, C); assert.equal(one.salesStage?.stage, 'PROPOSAL');
  assert.equal(h.manager.view().suspects.length, 0);

  // a second pair answered 不是: both kept, not asked again
  const D = 'ct_01M6EDE5KGJ1XA64ZWDR9NKE9D';
  await h.emit({ kind: 'incoming', conversation: '赵哥', text: 'hi', first: true });
  await h.emit({ kind: 'incoming', conversation: '赵哥二号', text: 'hi', first: true });
  h.hub.contactIds.set(findProfile(store(), '赵哥')!.id, D); h.hub.contactIds.set(findProfile(store(), '赵哥二号')!.id, D);
  await h.manager.flush(); await h.settle();
  const s2 = h.manager.view().suspects; assert.equal(s2.length, 1);
  await h.manager.answerSuspect(s2[0]!.id, false);
  h.clock.now += 60_000;
  await h.emit({ kind: 'handoff', conversation: '赵哥', text: '', detail: '', cause: 'media' });
  await h.emit({ kind: 'handoff', conversation: '赵哥二号', text: '', detail: '', cause: 'media' });
  await h.manager.flush(); await h.settle();
  assert.equal(h.manager.view().suspects.length, 0);
  assert.ok(findProfile(store(), '赵哥') && findProfile(store(), '赵哥二号'));
});

test('merged ids: a feed event with another contact id for a known person (strong identity) updates flywheelContactId and keeps the old one', async t => {
  const h = await harness(); t.after(() => h.close());
  const store = () => h.customers._state().store;
  await h.emit({ kind: 'incoming', conversation: '钱总', text: 'hi', first: true });
  await h.manager.flush(); await h.settle();
  const p = findProfile(store(), '钱总')!; const B = p.flywheelContactId!;
  await h.customers.setFact(p.id, 'phone', '13700001111');
  const MERGED = 'ct_01M6EDE5KGJ1XA64ZWDR9NKE9E';
  h.hub.feed = [stage(MERGED, 'PROPOSAL', [{ type: 'phone', value: '13700001111' }])];
  await h.manager.sync();
  assert.equal(p.flywheelContactId, MERGED); assert.deepEqual(p.flywheelAltIds, [B]);
  assert.equal(p.salesStage?.stage, 'PROPOSAL');
  // the old id still finds the same profile
  assert.equal(await h.customers.flywheel.applySales({ contactId: B, type: 'stage.changed', to: 'WON' }), true);
  assert.equal(p.salesStage?.stage, 'WON'); assert.equal(store().profiles.length, 1);
  // a lead.touched with yet another id matched by phone: same rule
  const NEWER = 'ct_01M6EDE5KGJ1XA64ZWDR9NKE9F';
  h.hub.feed.push(ev('lead.touched', { contact_id: NEWER, display_name: '钱总', identities: [{ type: 'phone', value: '+86 137 0000 1111' }] }, { capture_channel: 'form' }));
  await h.manager.sync();
  assert.equal(p.flywheelContactId, NEWER); assert.deepEqual(p.flywheelAltIds?.sort(), [B, MERGED].sort());
  // ids survive a restart of 客户档案 (profiles.json)
  const { createCustomers } = await import('./customers');
  const { join } = await import('node:path');
  await h.customers.flush();
  const again = await createCustomers({ file: join(h.dir, 'customers', 'profiles.json'), now: () => h.clock.now, config: () => undefined });
  assert.deepEqual(again.findProfileById(p.id)?.flywheelAltIds?.sort(), [B, MERGED].sort());
});

test('reception hot path unaffected: incoming messages never reach the reconcile calls, and a known chat resolves without waiting for them', async t => {
  const hub = await startFakeHub(); t.after(() => hub.close());
  const h = await harness({ hub }); t.after(() => h.close());
  const calls: string[] = [];
  const port = h.port as FlywheelCustomersPort & Record<string, unknown>;
  for (const k of ['writeContactId', 'importLead', 'applySales', 'mergePair', 'resolveSuspect'] as const) {
    const orig = port[k] as (...a: unknown[]) => unknown; port[k] = ((...a: unknown[]) => { calls.push(k); return orig(...a); }) as never;
  }
  h.state.idle = false; // a customer is waiting: nothing is sent, so no receipt work either
  await h.emit({ kind: 'incoming', conversation: '新客户', text: 'hi', first: true });
  await h.emit({ kind: 'reply-sent', conversation: '新客户', text: '您好', mode: 'auto', by: 'ai' });
  await h.settle();
  assert.deepEqual(calls, [], 'reception events only enqueue');
  h.state.idle = true; await h.manager.flush(); await h.settle();
  assert.ok(calls.some(c => c === 'writeContactId'), 'linking happens later, in the idle-time send');
  // a known chat profile resolves at once even while a reconcile is queued on the customer-store lock
  const name = '新客户';
  const pending = h.customers.flywheel.writeContactId(findProfile(h.customers._state().store, name)!.id, A);
  let resolved = false;
  const id = h.customers.ensureProfile(name, 'desk').then(x => { resolved = true; return x; });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(resolved, true);
  assert.ok(await id); await pending;
});
