import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import schemaObject from '../shared/flywheel/flywheel-v1.schema.json';
import { FLYWHEEL_PUBLIC_SCHEMA_SHA256, FLYWHEEL_SCHEMA_SHA256, flywheelEventError } from '../shared/flywheel/validate';
import { currentValue, findProfile, replyContext } from '../shared/customers';
import { withPluginContext } from './plugin-hooks';
import { harness, hubValidator, ph, tick } from './flywheel-test-kit';
import { backoffMs, retryAfterMs } from './flywheel-connect';
import type { FlywheelEnvelope } from '../shared/flywheel/types';

const root = fileURLToPath(new URL('..', import.meta.url));
const HOUR = 3600_000;
const types = (evs: Array<{ type: string }>) => evs.map(e => e.type);
const outboxOf = async (dir: string) => (await readFile(join(dir, 'flywheel', 'outbox.jsonl'), 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l) as { id: string; status: string; envelope: FlywheelEnvelope<Record<string, unknown>> });
const P1 = ph('138', '0013', '8000'), P2 = ph('139', '0013', '9000'), P3 = ph('137', '0013', '7000'), P4 = ph('136', '0013', '6000');

test('the bundled schema is the authoritative file except its $id (sha256 of both), the app imports exactly it, and every spec example passes', () => {
  const bytes = readFileSync(join(root, 'shared', 'flywheel', 'flywheel-v1.schema.json'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), FLYWHEEL_PUBLIC_SCHEMA_SHA256);
  assert.equal(FLYWHEEL_PUBLIC_SCHEMA_SHA256, '4156c7de5671605d999b0729ac14e4d10c2839c6cfab984f67aef5d6010e46bb');
  assert.equal(FLYWHEEL_SCHEMA_SHA256, '22d4a509bf1eae8f19b9ac7d66597437310b8bf50321a0b4e3f00607bf31a9a8');
  // The one public-repository change: the $id names a placeholder host (no rule depends on $id).
  const parsed = JSON.parse(bytes.toString('utf8'));
  assert.equal(parsed.$id, 'https://example.com/schemas/flywheel-v1.schema.json');
  assert.equal(bytes.toString('utf8').split('\n').filter(l => l.includes('example.com')).length, 1);
  assert.deepEqual(schemaObject, parsed);
  const examples = JSON.parse(readFileSync(join(root, 'shared', 'flywheel', 'flywheel-v1.examples.json'), 'utf8'));
  const list = (Array.isArray(examples) ? examples : examples.events ?? examples.examples ?? []) as unknown[];
  assert.ok(list.length > 10);
  for (const e of list) assert.equal(flywheelEventError(e), undefined);
  // The first community version wrote "$schema": every such event fails; "schema" is required.
  assert.match(flywheelEventError({ $schema: 'flywheel.v1' }) ?? '', /required|schema/);
});

test('every event goes source → plugin hook → resolver → manager → schema check → outbox → hub, and the hub validates each one independently', async t => {
  const h = await harness(); t.after(() => h.close());
  h.hub.keywords = [{ keyword: 'AI客服', content_id: 'vid_t12_60s_v2', platform: 'douyin', title: '3分钟搭好AI客服', published_at: '2026-11-01T10:00:00+08:00' }];
  await h.manager.sync();
  // A generic reception source (a source of your own, through the public hook): started, first_reply, handoff
  await h.emit({ kind: 'incoming', conversation: '小周', text: '你好', first: true, channel: 'desk' });
  h.clock.now += 20_000;
  await h.emit({ kind: 'reply-sent', conversation: '小周', text: '您好', mode: 'auto', by: 'ai' });
  await h.emit({ kind: 'handoff', conversation: '小周', text: '这是图片', detail: '对方发来图片、文件或视频，需人工查看后回复。', cause: 'media' });
  // contact.profiled through the real 客户档案 (owner edits → by human; long values cut to the schema limits)
  const p = findProfile(h.customers._state().store, '小周')!;
  await h.customers.setFact(p.id, 'industry', '家居建材与全屋定制装修设计服务及相关配套产品和售后服务');
  await h.customers.setFact(p.id, 'biz.soft.budget', '预算大概在三到五万左右，如果效果好的话可以再追加一些投入');
  await h.customers.setFact(p.id, 'biz.soft.decisionMaker', '不是老板，要问合伙人');
  await h.settle();
  // A profile the owner typed in and nobody chatted with: contact.profiled without identities.
  await h.customers.addProfile('手动录入的客户', 'desk');
  const typed = findProfile(h.customers._state().store, '手动录入的客户')!;
  await h.customers.setFact(typed.id, 'city', '杭州');
  // lead.created: a generic referral lead, then keyword (first message, context hook)
  await h.emit({ kind: 'lead-captured', conversation: '新朋友老陈', captureChannel: 'referral' });
  const ctx = await withPluginContext({ knowledge: '', instructions: '' }, 'AI·客服', undefined, { conversation: '看视频的客户', channel: 'desk', firstInConversation: true });
  assert.match(ctx.instructions, /《3分钟搭好AI客服》（抖音）/);
  await h.settle();
  await h.emit({ kind: 'lead-captured', conversation: '新朋友老陈', captureChannel: 'event' });
  const sent = await h.manager.flush();
  assert.equal(h.manager.view().attention, 0);
  assert.equal(h.manager.view().errors, 0);
  assert.equal(sent, h.hub.received.length);
  const got = h.hub.received;
  const validate = hubValidator();
  for (const e of got) assert.ok(validate(e), `${e.type}: ${JSON.stringify(validate.errors)}`);
  for (const ty of ['conversation.started', 'conversation.first_reply', 'conversation.handoff', 'contact.profiled', 'lead.created', 'lead.touched']) assert.ok(types(got).includes(ty), ty);
  assert.equal(types(got).includes('kadadesk.daily_health'), false);
  const leads = got.filter(e => e.type.startsWith('lead.'));
  assert.deepEqual(leads.map(e => e.payload.capture_channel).sort(), ['event', 'keyword', 'referral']);
  const started = got.find(e => e.type === 'conversation.started')!;
  assert.equal(started.payload.channel, 'other'); assert.equal(started.schema, 'flywheel.v1'); assert.equal((started as unknown as Record<string, unknown>).$schema, undefined);
  assert.equal(started.workspace_id, 'default');
  assert.equal(started.source.version, '0.3.0'); assert.match(started.source.instance, /^kd-[0-9a-f]{16}$/);
  assert.match(started.event_id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(started.contact?.consent?.basis, 'customer_initiated');
  const profiled = got.filter(e => e.type === 'contact.profiled');
  const human = Object.assign({}, ...profiled.filter(e => e.payload.by === 'human' && e.contact?.local_id === p.id).map(e => e.payload.fields)) as Record<string, unknown>;
  assert.equal([...String(human.industry)].length <= 32, true);
  assert.equal([...String(human.budget)].length <= 32, true);
  assert.equal(human.decision_maker, false);
  const typedEv = profiled.find(e => e.contact?.local_id === typed.id)!;
  assert.deepEqual(typedEv.payload.fields, { city: '杭州' });
  assert.equal(typedEv.contact?.identities, undefined); assert.equal(typedEv.contact?.consent, undefined);
  const keyword = leads.find(e => e.payload.capture_channel === 'keyword')!;
  assert.equal(keyword.refs?.content_id, 'vid_t12_60s_v2'); assert.equal(keyword.payload.keyword, 'AI客服');
  // The second lead for the same person is lead.touched.
  assert.equal(leads.find(e => e.payload.capture_channel === 'event')!.type, 'lead.touched');
});

test('24-hour rule counts both directions and survives a restart', async t => {
  const h = await harness(); t.after(() => h.close());
  const started = () => h.manager.view().pending; // all events stay pending (no flush)
  await h.emit({ kind: 'incoming', conversation: '王总', text: '在吗', first: true });
  assert.equal(started(), 1);
  h.clock.now += 20 * HOUR;
  await h.emit({ kind: 'reply-sent', conversation: '王总', text: '', mode: 'manual', by: 'human' }); // the owner wrote by hand: first reply (human)
  assert.equal(started(), 2);
  await h.restart();
  h.clock.now += 20 * HOUR; // 40 h after the start, 20 h after the owner's message: same conversation
  await h.emit({ kind: 'incoming', conversation: '王总', text: '还有个问题', first: false });
  const after1 = (await outboxOf(h.dir)).map(i => i.envelope.type);
  assert.deepEqual(after1, ['conversation.started', 'conversation.first_reply']);
  h.clock.now += 25 * HOUR; // more than 24 h of silence on both sides
  await h.emit({ kind: 'incoming', conversation: '王总', text: '你好', first: false });
  const after2 = (await outboxOf(h.dir)).map(i => i.envelope.type);
  assert.deepEqual(after2, ['conversation.started', 'conversation.first_reply', 'conversation.started']);
  const fr = (await outboxOf(h.dir))[1]!.envelope.payload;
  assert.deepEqual({ by: fr.by, mode: fr.mode, latency: fr.latency_seconds }, { by: 'human', mode: 'manual', latency: 20 * 3600 });
});

test('first reply is sent once per conversation, with the real mode and who replied', async t => {
  const h = await harness(); t.after(() => h.close());
  await h.emit({ kind: 'incoming', conversation: '李姐', text: '多少钱', first: true });
  h.clock.now += 12_000;
  await h.emit({ kind: 'reply-sent', conversation: '李姐', text: 'x', mode: 'review', by: 'human' });
  await h.emit({ kind: 'incoming', conversation: '李姐', text: '好的', first: false });
  await h.emit({ kind: 'reply-sent', conversation: '李姐', text: 'y', mode: 'auto', by: 'ai' });
  await h.restart();
  await h.emit({ kind: 'reply-sent', conversation: '李姐', text: 'z', mode: 'auto', by: 'ai' });
  let list = (await outboxOf(h.dir)).filter(i => i.envelope.type === 'conversation.first_reply');
  assert.equal(list.length, 1);
  assert.deepEqual([list[0]!.envelope.payload.mode, list[0]!.envelope.payload.by, list[0]!.envelope.payload.latency_seconds], ['review', 'human', 12]);
  h.clock.now += 25 * HOUR;
  await h.emit({ kind: 'incoming', conversation: '李姐', text: '再问下', first: false });
  await h.emit({ kind: 'reply-sent', conversation: '李姐', text: 'z', mode: 'auto', by: 'ai' });
  list = (await outboxOf(h.dir)).filter(i => i.envelope.type === 'conversation.first_reply');
  assert.equal(list.length, 2);
});

test('a handoff carries only a reason code: no customer text, no topic', async t => {
  const h = await harness(); t.after(() => h.close());
  const secretText = `我电话${P1}，住幸福路12号，你们多少钱`;
  await h.emit({ kind: 'handoff', conversation: '赵', text: secretText, detail: '关键词「人工」命中，转人工', cause: 'keyword-rule', ruleKeyword: '人工' });
  await h.emit({ kind: 'handoff', conversation: '赵', text: secretText, detail: '回复里答应了资料里没有的东西，需要你亲自回复（未输入）', cause: 'risk' });
  await h.emit({ kind: 'handoff', conversation: '赵', text: secretText, detail: '检测到人工发出消息', cause: 'owner-active' });
  await h.emit({ kind: 'handoff', conversation: '赵', text: secretText, detail: '新增消息过长，请人工处理' });
  const items = (await outboxOf(h.dir)).filter(i => i.envelope.type === 'conversation.handoff');
  assert.deepEqual(items.map(i => i.envelope.payload.reason), ['explicit_request', 'risk', 'other', 'other']);
  for (const i of items) assert.deepEqual(Object.keys(i.envelope.payload), ['reason']);
  const raw = await readFile(join(h.dir, 'flywheel', 'outbox.jsonl'), 'utf8');
  for (const x of [P1, '幸福路', '多少钱', '关键词', '人工发出']) assert.ok(!raw.includes(x), x);
});

test('outgoing text is masked: phone, ID and bank numbers never leave in clear', async t => {
  const h = await harness(); t.after(() => h.close());
  await h.emit({ kind: 'incoming', conversation: P3, text: 'hi', first: true });
  const p = findProfile(h.customers._state().store, P3)!;
  // 客户档案 itself refuses ID / bank numbers (secret-guard); a phone number in a need is kept there and masked on the way out.
  await h.customers.setFact(p.id, 'biz.soft.needs', '回电 138-0013-8000，想要 AI 客服');
  await h.settle();
  const raw = await readFile(join(h.dir, 'flywheel', 'outbox.jsonl'), 'utf8');
  assert.ok(!raw.includes(P1) && !raw.includes('138-0013-8000'));
  assert.match(raw, /138\*\*\*\*8000/);
  // The chat name is a phone number here: the remark identity and display name are masked as well.
  assert.ok(!raw.includes(P3));
});

test('hub contract: 429 with an HTTP date waits until then; 5xx backs off 1m/5m/30m/2h/1h; 401 pauses; other 4xx go to 需要处理; partial receipts keep the rest', async t => {
  const h = await harness(); t.after(() => h.close());
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(backoffMs), [60_000, 300_000, 1_800_000, 7_200_000, 3_600_000, 3_600_000]);
  assert.equal(retryAfterMs('120', 0), 120_000);
  assert.equal(retryAfterMs(new Date(1_000_000 + 90_000).toUTCString(), 1_000_000), 90_000);
  await h.emit({ kind: 'incoming', conversation: '客户甲', text: 'hi', first: true });
  const until = new Date(h.clock.now + 10 * 60_000);
  h.hub.mode = { status: 429, retryAfter: until.toUTCString() };
  assert.equal(await h.manager.flush(), 0);
  h.hub.mode = {};
  h.clock.now += 5 * 60_000; assert.equal(await h.manager.flush(), 0); // still waiting for the date
  h.clock.now += 5 * 60_000 + 1000; assert.equal(await h.manager.flush(), 1);
  // 5xx: retried later, kept
  await h.emit({ kind: 'incoming', conversation: '客户乙', text: 'hi', first: true });
  h.hub.mode = { status: 503 }; const posts = h.hub.posts;
  await h.manager.flush(); h.hub.mode = {};
  await h.manager.flush(); assert.equal(h.hub.posts, posts + 1); // not yet: 1 minute
  h.clock.now += 61_000; assert.equal(await h.manager.flush(), 1);
  // 401: paused with a plain message until the key changes
  await h.emit({ kind: 'incoming', conversation: '客户丙', text: 'hi', first: true });
  h.hub.token = 'rotated';
  await h.manager.flush();
  assert.match(h.manager.view().pausedReason ?? '', /密钥不对/);
  assert.equal(await h.manager.flush(), 0);
  await h.manager.saveSettings({ apiKey: 'rotated' });
  assert.equal(await h.manager.flush(), 1);
  // other 4xx: 需要处理, not retried; 重新发送 puts it back
  await h.emit({ kind: 'incoming', conversation: '客户丁', text: 'hi', first: true });
  h.hub.mode = { status: 422 };
  await h.manager.flush();
  assert.equal(h.manager.view().attention, 1); assert.match(h.manager.view().attentionItems[0]!.reason, /HTTP 422/);
  h.hub.mode = {}; h.clock.now += 3 * HOUR;
  assert.equal(await h.manager.flush(), 0);
  await h.manager.resend(); assert.equal(await h.manager.flush(), 1);
  // a receipt that leaves an event out: that one stays pending; rejected ones go to 需要处理
  await h.emit({ kind: 'incoming', conversation: '客户戊', text: 'hi', first: true });
  await h.emit({ kind: 'handoff', conversation: '客户戊', text: '', detail: '', cause: 'media' });
  const [a, b] = (await outboxOf(h.dir)).filter(i => i.status === 'pending');
  h.hub.mode = { dropFromReceipt: new Set([a!.id]), rejectTypes: new Set(['conversation.handoff']) };
  assert.equal(await h.manager.flush(), 0);
  const left = await outboxOf(h.dir);
  assert.deepEqual(left.map(i => [i.id, i.status]), [[a!.id, 'pending'], [b!.id, 'attention']]);
  assert.equal(h.manager.view().sent, 4);
});

test('sending waits while the computer is busy (idle check), and the switch stops everything at once', async t => {
  const h = await harness(); t.after(() => h.close());
  await h.emit({ kind: 'incoming', conversation: '客户', text: 'hi', first: true });
  h.state.idle = false;
  await h.manager.tick();
  assert.equal(h.hub.posts, 0); assert.equal(h.hub.requests.length, 0);
  h.state.idle = true;
  await h.manager.tick();
  assert.equal(h.hub.posts, 1);
  // Off: no events recorded, nothing sent or fetched; the outbox stays and can be cleared.
  await h.manager.setPluginState({ installed: true, enabled: false });
  await h.emit({ kind: 'incoming', conversation: '新客户', text: 'hi', first: true });
  assert.equal(h.manager.view().pending, 0);
  await h.manager.setPluginState({ installed: true, enabled: true });
  await h.emit({ kind: 'incoming', conversation: '新客户', text: 'hi', first: true });
  await h.manager.setPluginState({ installed: true, enabled: false });
  const before = h.hub.requests.length;
  await h.manager.tick(); await h.manager.flush(); await h.manager.sync();
  assert.equal(h.hub.requests.length, before);
  assert.equal(h.manager.view().pending, 1);
  await h.manager.clearOutbox(); assert.equal(h.manager.view().pending, 0);
  // Uninstall forgets the key and the consent.
  await h.manager.setPluginState({ installed: false, enabled: false });
  assert.equal(h.secrets.peek(), undefined); assert.equal(h.manager.view().consented, false); assert.equal(h.manager.view().apiKeyConfigured, false);
});

test('keyword end to end: hub keywords → first customer message → reply context line, 来源 fact, lead.created with content_id', async t => {
  const h = await harness(); t.after(() => h.close());
  h.hub.keywords = [{ keyword: 'AI客服', content_id: 'vid_t12_60s_v2', platform: 'douyin', title: '3分钟搭好AI客服' }, { keyword: '资料', content_id: 'vid_x', platform: 'xhs', title: '资料包' }];
  await h.manager.sync();
  const meta = { conversation: '刷到视频的人', channel: 'desk' as const, firstInConversation: true };
  await h.emit({ kind: 'incoming', conversation: '刷到视频的人', text: 'ＡＩ 客服！', first: true });
  const ctx = await withPluginContext({ knowledge: '', instructions: '已有说明' }, 'ＡＩ 客服！', undefined, meta);
  assert.match(ctx.instructions, /^已有说明\n【客户来源】这位客户是看了《3分钟搭好AI客服》（抖音）来的，发了扣词「AI客服」/);
  await h.settle();
  const p = findProfile(h.customers._state().store, '刷到视频的人')!;
  assert.equal(currentValue(p, 'source'), '《3分钟搭好AI客服》/扣词');
  // Not the first message / a long sentence that merely mentions a 2-character keyword: no line.
  assert.equal((await withPluginContext({ knowledge: '', instructions: '' }, 'AI客服', undefined, { ...meta, firstInConversation: false })).instructions, '');
  assert.equal((await withPluginContext({ knowledge: '', instructions: '' }, '我想看看你们有没有什么资料可以发给我', undefined, { ...meta, conversation: '别人' })).instructions, '');
  assert.match((await withPluginContext({ knowledge: '', instructions: '' }, '资料。', undefined, { ...meta, conversation: '要资料的人' })).instructions, /资料包/);
  await h.settle();
  await h.manager.flush();
  const kw = h.hub.received.filter(e => e.type === 'lead.created' && e.payload.capture_channel === 'keyword');
  assert.equal(kw.length, 2);
  assert.equal(kw[0]!.refs?.content_id, 'vid_t12_60s_v2'); assert.equal(kw[0]!.payload.keyword, 'AI客服'); assert.equal(kw[0]!.payload.platform, 'douyin');
  // The same conversation asks again (context rebuilt): no second lead.
  await withPluginContext({ knowledge: '', instructions: '' }, 'AI客服', undefined, meta); await h.settle(); await h.manager.flush();
  assert.equal(h.hub.received.filter(e => e.payload.capture_channel === 'keyword').length, 2);
});

test('receipt contact_id is written back to the profile through local_id, and used from then on', async t => {
  const h = await harness(); t.after(() => h.close());
  await h.emit({ kind: 'incoming', conversation: '回填客户', text: 'hi', first: true });
  await h.manager.flush(); await h.settle();
  const p = findProfile(h.customers._state().store, '回填客户')!;
  const cid = h.hub.contactIds.get(p.id)!;
  assert.match(cid, /^ct_[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.equal(p.flywheelContactId, cid);
  h.clock.now += 1000;
  await h.emit({ kind: 'handoff', conversation: '回填客户', text: '', detail: '', cause: 'media' });
  await h.manager.flush();
  assert.equal(h.hub.received.at(-1)!.contact?.contact_id, cid);
});

test('inbound: strong ids merge, a name alone only asks 疑似同一人 (no merge), unknown people are pre-created as 未接触; sales progress merges', async t => {
  const h = await harness(); t.after(() => h.close());
  await h.customers.addProfile('张三', 'desk');
  await h.customers.addProfile('王老板', 'desk');
  const wang = findProfile(h.customers._state().store, '王老板')!;
  await h.customers.setFact(wang.id, 'phone', P4);
  const ev = (id: string, type: string, contact: Record<string, unknown>, payload: Record<string, unknown>, system = 'content-factory') => ({ schema: 'flywheel.v1', event_id: id, type, occurred_at: '2026-11-02T10:00:00+08:00', recorded_at: '2026-11-02T10:00:00+08:00', workspace_id: 'default', source: { system, instance: 'x' }, is_demo: false, contact, payload }) as unknown as FlywheelEnvelope<Record<string, unknown>>;
  h.hub.feed = [
    ev('00000000-0000-7000-8000-000000000001', 'lead.created', { contact_id: 'ct_01JBXYZ0000000000000000001', local_id: 'cf_999', display_name: '张三', identities: [{ type: 'wechat_remark', value: '张三' }] }, { capture_channel: 'comment', need: '想做AI客服' }),
    ev('00000000-0000-7000-8000-000000000002', 'lead.created', { contact_id: 'ct_01JBXYZ0000000000000000002', display_name: '王总', identities: [{ type: 'phone', value: `+86${P4}` }] }, { capture_channel: 'form' }),
    ev('00000000-0000-7000-8000-000000000003', 'lead.created', { contact_id: 'ct_01JBXYZ0000000000000000003', local_id: 'p_should_not_be_used', display_name: '走访客户', identities: [{ type: 'wecom_external_userid', value: 'wmLsl7EAAAqK6Ri5F2YjB0eXaBcDeFgH' }] }, {}, 'feishu-bitable'),
    ev('00000000-0000-7000-8000-000000000004', 'lead.created', { contact_id: 'ct_01JBXYZ0000000000000000004', display_name: '自己发的' }, { capture_channel: 'keyword', keyword: 'x' }, 'kadadesk'),
    ev('00000000-0000-7000-8000-000000000005', 'stage.changed', { contact_id: 'ct_01JBXYZ0000000000000000002' }, { opportunity_id: 'op1', from: 'NEW', to: 'PROPOSAL' }, 'crm'),
    ev('00000000-0000-7000-8000-000000000006', 'followup.scheduled', { contact_id: 'ct_01JBXYZ0000000000000000002' }, { due_at: '2026-11-05T10:00:00+08:00', action: '回访' }, 'crm'),
  ];
  h.hub.feed[2]!.type = 'visit.done';
  await h.manager.sync();
  const store = h.customers._state().store;
  // weak only: nothing merged, a prompt for the owner
  assert.equal(store.profiles.filter(p => p.name.startsWith('张三')).length, 1);
  assert.equal(findProfile(store, '张三')!.flywheelContactId, undefined);
  assert.equal(h.manager.view().suspects.length, 1); assert.equal(h.notices.length, 1);
  // strong: merged, contact id stored, sales stage kept across a later follow-up
  const merged = findProfile(store, '王老板')!;
  assert.equal(merged.flywheelContactId, 'ct_01JBXYZ0000000000000000002');
  assert.equal(merged.salesStage?.stage, 'PROPOSAL'); assert.equal(merged.salesStage?.nextFollowupAt, '2026-11-05T02:00:00.000Z');
  assert.match(replyContext(merged, store.lines), /「报价中」阶段，不要从头介绍产品/);
  // unknown: pre-created 未接触 with the hub id (never the other system's local id as kadadesk's id)
  const visit = findProfile(store, '走访客户')!;
  assert.deepEqual(visit.tags, ['未接触']); assert.equal(visit.flywheelContactId, 'ct_01JBXYZ0000000000000000003');
  assert.notEqual(visit.id, 'p_should_not_be_used');
  assert.equal(currentValue(visit, 'wecomId'), 'wmLsl7EAAAqK6Ri5F2YjB0eXaBcDeFgH');
  // own events skipped
  assert.equal(findProfile(store, '自己发的'), undefined);
  // cursor kept as an opaque string; the second sync asks with after=<cursor>
  await h.manager.sync();
  assert.ok(h.hub.requests.some(r => r.path.includes('after=c6')));
  // owner says: not the same person → a separate pre-created profile with a distinct name
  await h.manager.answerSuspect(h.manager.view().suspects[0]!.id, false);
  assert.ok(findProfile(store, '张三（飞轮）'));
  // contract.signed → won; a later follow-up keeps it won
  h.hub.feed.push(ev('00000000-0000-7000-8000-000000000007', 'contract.signed', { contact_id: 'ct_01JBXYZ0000000000000000002' }, { opportunity_id: 'op1', contract_id: 'k1', amount_cents: 100 }, 'crm'));
  h.hub.feed.push(ev('00000000-0000-7000-8000-000000000008', 'followup.scheduled', { contact_id: 'ct_01JBXYZ0000000000000000002' }, { due_at: '2026-12-01T10:00:00+08:00', action: '续费' }, 'crm'));
  await h.manager.sync();
  assert.equal(findProfile(store, '王老板')!.salesStage?.dealStatus, 'won');
  assert.match(replyContext(findProfile(store, '王老板')!, store.lines), /已成交客户/);
});

test('end to end against the fake hub: hub down, events kept on disk across a restart, then resent once; duplicates count as sent', async t => {
  const h = await harness(); t.after(() => h.close());
  for (const n of ['甲', '乙', '丙']) await h.emit({ kind: 'incoming', conversation: `客户${n}`, text: 'hi', first: true });
  h.hub.mode = { down: true };
  assert.equal(await h.manager.flush(), 0);
  assert.match(h.manager.view().lastError ?? '', /连不上/);
  assert.equal(h.manager.view().pending, 3);
  await h.restart();
  assert.equal(h.manager.view().pending, 3);
  h.hub.mode = {};
  assert.equal(await h.manager.flush(), 0); // backoff: not before 1 minute
  h.clock.now += 61_000;
  assert.equal(await h.manager.flush(), 3);
  assert.equal(h.hub.received.length, 3);
  assert.equal(h.manager.view().pending, 0);
  const posted = h.hub.requests.filter(r => r.method === 'POST');
  assert.ok(posted.every(r => r.auth === `Bearer ${h.hub.token}`));
  const sentLog = (await readFile(join(h.dir, 'flywheel', 'sent.jsonl'), 'utf8')).trim().split('\n');
  assert.equal(sentLog.length, 3);
  assert.equal(h.manager.view().sent, 3);
});

test('concurrent enqueues are all on disk (no older snapshot overwrites a newer one)', async t => {
  const h = await harness(); t.after(() => h.close());
  const { emitReceptionEvent } = await import('./plugin-hooks');
  for (let i = 0; i < 25; i++) emitReceptionEvent({ kind: 'incoming', conversation: `并发${i}`, text: 'hi', first: true, at: new Date(h.clock.now).toISOString() });
  await h.settle(); await tick(); await h.settle();
  assert.equal((await outboxOf(h.dir)).length, 25);
  const again = await h.restart();
  assert.equal(again.view().pending, 25);
});

test('optional live hub (KD_E2E_HUB_URL + KD_E2E_TOKEN)', { skip: !(process.env.KD_E2E_HUB_URL && process.env.KD_E2E_TOKEN) }, async t => {
  const h = await harness({ start: Date.now(), demo: true }); t.after(() => h.close());
  await h.manager.saveSettings({ hubUrl: process.env.KD_E2E_HUB_URL!, apiKey: process.env.KD_E2E_TOKEN!, ...(process.env.KD_E2E_WORKSPACE ? { workspaceId: process.env.KD_E2E_WORKSPACE } : {}) });
  const test1 = await h.manager.testConnection();
  assert.equal(test1.ok, true, test1.message);
  await h.emit({ kind: 'incoming', conversation: 'E2E 测试客户', text: 'hi', first: true });
  const sent = await h.manager.flush();
  assert.equal(h.manager.view().attention, 0, JSON.stringify(h.manager.view().attentionItems));
  assert.ok(sent >= 1);
  await h.manager.sync();
});
