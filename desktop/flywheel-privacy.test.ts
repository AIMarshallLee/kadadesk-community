import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { findProfile } from '../shared/customers';
import { harness, ph } from './flywheel-test-kit';
import { withPluginContext } from './plugin-hooks';
import type { FlywheelEnvelope } from '../shared/flywheel/types';

/**
 * 增长飞轮 privacy (spec §2.3 / product rule: no raw chat text leaves the computer). Customer messages carrying an
 * address, a phone number and distinctive wording go through every path that can produce an event — the generic
 * reception events (incoming, handoff with the message as text and detail, reply-sent), the 客户档案 capture (model
 * facts whose quotes are the customer's own words) and a keyword first message — and nothing of that text may appear
 * in the outbox or in what the hub receives.
 */
const PHONE = ph('138', '1234', '5678');
const MESSAGES = [
  `你好我住在北京市朝阳区建国路88号SOHO现代城A座1203室，电话${PHONE}，想问问你们的智能前台怎么收费`,
  '我们是开连锁烘焙店的，一共七家门店，老板娘说了算，预算三万块以内，下个月就要上线',
  '能不能直接打我老公电话 139-0013-9000 或者发到 zhangsan.private@example.com 我们周末在家',
];
const PHONE_DIGITS = [PHONE, '12345678', ph('139', '0013', '9000'), '00139000'];

/** Every 6-character window of every message (spaces and punctuation removed): none may appear in any outgoing string. */
const windows = () => {
  const out = new Set<string>();
  for (const m of MESSAGES) { const s = [...m.replace(/[\s，。,.-]/g, '')]; for (let i = 0; i + 6 <= s.length; i++) out.add(s.slice(i, i + 6).join('')); }
  return [...out];
};
const strings = (v: unknown, acc: string[] = []): string[] => {
  if (typeof v === 'string') acc.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, acc);
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { acc.push(k); strings(x, acc); }
  return acc;
};

test('no message text, address, phone or e-mail from customer messages reaches the outbox or the hub (incoming, handoff, reply, profile capture, keyword)', async t => {
  const capture = JSON.stringify({
    facts: [
      { field: 'city', value: '北京', quote: '我住在北京市朝阳区建国路88号SOHO现代城A座1203室' },
      { field: 'industry', value: '烘焙连锁', quote: '我们是开连锁烘焙店的，一共七家门店' },
      { field: 'biz.soft.budget', value: '3万以内', quote: '预算三万块以内' },
      { field: 'biz.soft.timeline', value: '下个月', quote: '下个月就要上线' },
      { field: 'biz.soft.needs', value: '智能前台', quote: '想问问你们的智能前台怎么收费' },
      { field: 'biz.soft.decisionMaker', value: '老板娘', quote: '老板娘说了算' },
      { field: 'phone', value: PHONE, quote: `电话${PHONE}` },
    ],
    lines: [{ line: 'soft', intent: 'high' }],
  });
  const h = await harness({ customersDeps: { writeText: async () => capture, captureAllowed: () => true } });
  t.after(() => h.close());
  h.hub.keywords = [{ keyword: '智能前台', content_id: 'vid_front_desk', platform: 'douyin', title: '三分钟看懂智能前台', published_at: '2026-11-01T10:00:00+08:00' }];
  await h.manager.sync();

  const name = '张女士';
  for (const [i, text] of MESSAGES.entries()) {
    await h.emit({ kind: 'incoming', conversation: name, text, first: i === 0, channel: 'desk' });
    h.customers.onTranscript({ channel: 'desk', conversationId: 'c1', conversationName: name, kind: 'direct', reason: 'incoming', messages: MESSAGES.slice(0, i + 1).map(m => ({ direction: 'incoming', text: m, stamp: new Date(h.clock.now).toISOString() })) } as never);
    h.clock.now += 15_000;
  }
  await h.emit({ kind: 'reply-sent', conversation: name, text: `收到，您说的${MESSAGES[0]}我们记下了`, mode: 'auto', by: 'ai' });
  await h.emit({ kind: 'handoff', conversation: name, text: MESSAGES[2]!, detail: `客户说：${MESSAGES[2]}`, cause: 'customer-asked' });
  await h.emit({ kind: 'handoff', conversation: name, text: MESSAGES[1]!, detail: MESSAGES[1]! }); // no cause: reason other
  // The same text from a source that names its app.
  await h.emit({ kind: 'incoming', conversation: '李先生（飞书）', text: MESSAGES[0]!, first: true, channel: 'desk', app: 'feishu' });
  await h.emit({ kind: 'handoff', conversation: '李先生（飞书）', text: '', detail: MESSAGES[2]!, cause: 'customer-asked', app: 'feishu' });
  // The owner pastes the customer's words into the profile by hand: only the 7 fields leave, cut and masked.
  const typed = findProfile(h.customers._state().store, name)!;
  await h.customers.setFact(typed.id, 'comm.tone', MESSAGES[1]!);
  await h.customers.addNote(typed.id, MESSAGES[0]!);
  // 客户档案 capture runs on its own clock: the model facts above carry quotes of the customer's words.
  h.clock.now += 3 * 3600_000;
  await h.customers.tick(); await h.settle();
  const p = findProfile(h.customers._state().store, name)!;
  assert.ok(p.facts.some(f => f.quote?.includes('建国路88号')), 'the capture really stored quotes (the test feeds the profile path)');
  // A keyword first message (context hook) from a new chat whose first message is the address text.
  const ctx = await withPluginContext({ knowledge: '', instructions: '' }, MESSAGES[0], undefined, { conversation: '王老板', channel: 'desk', firstInConversation: true });
  assert.match(ctx.instructions, /三分钟看懂智能前台/);
  await h.settle();
  await h.emit({ kind: 'lead-captured', conversation: name, captureChannel: 'referral' });

  await h.manager.flush(); await h.settle();
  const outbox = await readFile(join(h.dir, 'flywheel', 'outbox.jsonl'), 'utf8').catch(() => '');
  const received = h.hub.received as FlywheelEnvelope<Record<string, unknown>>[];
  const types = new Set(received.map(e => e.type));
  for (const ty of ['conversation.started', 'conversation.first_reply', 'conversation.handoff', 'contact.profiled', 'lead.created']) assert.ok(types.has(ty), `the hub got ${ty} (so the paths really ran)`);
  // Identities are spec-allowed only with a consent basis (checked below); everything else must be free of the text.
  const noIds = (e: FlywheelEnvelope<unknown>) => ({ ...e, contact: e.contact ? { ...e.contact, identities: undefined } : undefined });
  const queued = outbox ? outbox.split('\n').filter(Boolean).map(l => (JSON.parse(l) as { envelope: FlywheelEnvelope<unknown> }).envelope) : [];
  const sent = [...received, ...queued].flatMap(e => strings(noIds(e)));
  const all = sent.join('\n');
  for (const w of windows()) assert.ok(!all.includes(w), `message text 「${w}」 left the computer`);
  for (const d of PHONE_DIGITS) assert.ok(!all.includes(d), `phone digits ${d} left the computer`);
  assert.ok(!/建国路|SOHO|1203|zhangsan|example\.com|老公/.test(all), 'address / e-mail / wording left the computer');
  // Handoffs: a reason code only.
  for (const e of received.filter(x => x.type === 'conversation.handoff')) assert.deepEqual(Object.keys(e.payload), ['reason']);
  // The phone the customer typed may only travel as an identity, with customer_initiated consent, in E.164.
  for (const e of [...received, ...queued]) for (const id of e.contact?.identities ?? []) {
    assert.ok(e.contact!.consent?.basis === 'customer_initiated', `${e.type}: identity with consent`);
    if (id.type === 'phone') assert.equal(id.value, `+86${PHONE}`);
    else assert.ok(!PHONE_DIGITS.some(d => id.value.includes(d)) && !/建国路|example\.com/.test(id.value), `${id.type} is not message text`);
  }
});
