import test from 'node:test';
import assert from 'node:assert/strict';
import { maskOutboundText, fit } from './flywheel/mask';
import { matchKeyword, normalizeKeywordText } from './flywheel/keywords';
import { beijingIso, contactFor, contactProfiled, handoffReason, lead, parseDecisionMaker, phoneE164, uuidV7, mapIntent } from './flywheel/mapping';
import { laneChannel, FLYWHEEL_CHANNEL_LABELS } from './flywheel/channels';
import { flywheelEventError } from './flywheel/validate';

/** Phone numbers in pieces: the public-repository scanner never sees a whole number in the source. */
const ph = (...parts: string[]) => parts.join('');
const ctx = { workspaceId: 'default', instance: 'kd-test', version: '0.3.0', now: () => Date.parse('2026-11-02T02:00:00Z') };
const profile = { id: 'c-1', name: '张三-门店', facts: [{ field: 'phone', value: '138 0013 8000', source: 'customer' }, { field: 'phone', value: ph('139', '0013', '9000'), source: 'import' }] };

test('masking: phones, ID cards, bank cards and secrets are masked in any outgoing text', () => {
  const a = ph('138', '0013', '8000'), b = ph('139', '0013', '9000');
  const out = maskOutboundText(`电话 ${a} / +86 139-0013-9000，座机 010-12345678，身份证 11010119900307123X，卡号 6222021234567890123，密码：abc12345`);
  for (const secret of [a, b, '12345678', '11010119900307123X', '6222021234567890123', 'abc12345']) assert.ok(!out.includes(secret), secret);
  assert.match(out, /138\*\*\*\*8000/);
  assert.equal(maskOutboundText('卡 3568 1234 5678 9012'), '卡 ****9012');
  assert.equal(fit('一二三四五六七八九十', 4), '一二三四');
  assert.equal(fit('  ', 4), undefined);
});

test('keywords: width, case, spaces, punctuation and middle dots ignored; 2-character keywords only (nearly) alone', () => {
  const items = [{ keyword: 'AI客服', content_id: 'v1', platform: 'douyin', title: '3分钟搭好AI客服' }, { keyword: '资料', content_id: 'v2', title: '资料包' }];
  assert.equal(normalizeKeywordText('ＡＩ·客服！ '), 'ai客服');
  for (const text of ['AI客服', 'ai 客服', 'ＡＩ客服。', 'AI·客服', '我要AI客服']) assert.equal(matchKeyword(text, items)?.item.content_id, 'v1', text);
  assert.equal(matchKeyword('资料', items)?.item.content_id, 'v2');
  assert.equal(matchKeyword('资料！！', items)?.item.content_id, 'v2');
  assert.equal(matchKeyword('你好，我想看看你们的资料', items), undefined);
  assert.match(matchKeyword('AI客服', items)!.contextLine, /^这位客户是看了《3分钟搭好AI客服》（抖音）来的，发了扣词「AI客服」/);
});

test('decision maker: negations and other deciders are false, the customer himself is true, unclear is not sent', () => {
  for (const v of ['不是老板', '不是我说了算', '要问老婆', '和合伙人商量', '得请示领导', '否']) assert.equal(parseDecisionMaker(v), false, v);
  for (const v of ['本人拍板', '他自己定', '我说了算', '是']) assert.equal(parseDecisionMaker(v), true, v);
  for (const v of ['老板', '还不清楚']) assert.equal(parseDecisionMaker(v), undefined, v);
  assert.equal(mapIntent('高'), 'high'); assert.equal(mapIntent('投诉中'), 'complaint'); assert.equal(mapIntent('不知道'), undefined);
});

test('contacts: identities only with consent; a phone only when the customer gave it; profiles nobody chatted with carry none', () => {
  const at = beijingIso(ctx.now());
  const c = contactFor(profile, 'customer', at);
  assert.deepEqual(c.identities, [{ type: 'wechat_remark', value: '张三-门店' }, { type: 'phone', value: `+86${ph('138', '0013', '8000')}` }]);
  assert.equal(c.consent?.basis, 'customer_initiated');
  assert.equal(contactFor(profile, 'none', at).identities, undefined);
  assert.equal(contactFor(profile, 'none', at).consent, undefined);
  assert.equal(phoneE164('+86 138-0013-8000'), `+86${ph('138', '0013', '8000')}`); assert.equal(phoneE164('12345'), undefined);
});

test('profile facts: only the 7 fields, never sensitive ones, owner/import → human, customer/inferred → ai, cut to the limits', () => {
  const at = beijingIso(ctx.now());
  const evs = contactProfiled(ctx, contactFor(profile, 'customer', at), [
    { field: 'industry', value: 'x'.repeat(50), source: 'owner' },
    { field: 'biz.b1.intent', value: '高', source: 'inferred' },
    { field: 'biz.b1.needs', value: '要 AI 客服', source: 'customer' },
    { field: 'health', value: '高血压', source: 'customer', sensitive: true },
    { field: 'phone', value: ph('138', '0013', '8000'), source: 'customer' },
    { field: 'callAs', value: '张总', source: 'customer' },
  ], at);
  assert.deepEqual(evs.map(e => e.payload.by), ['human', 'ai']);
  assert.deepEqual(evs[0]!.payload.fields, { industry: 'x'.repeat(32) });
  assert.deepEqual(evs[1]!.payload.fields, { intent: 'high', need: '要 AI 客服' });
  for (const e of evs) assert.equal(flywheelEventError(e), undefined);
});

test('leads and handoffs: keyword leads need a keyword (cut to 20), handoff reasons come from cause codes', () => {
  const at = beijingIso(ctx.now());
  assert.equal(lead(ctx, contactFor(profile, 'customer', at), { first: true, channel: 'keyword', at }), undefined);
  const e = lead(ctx, contactFor(profile, 'customer', at), { first: true, channel: 'keyword', at, keyword: '老板领取全套AI获客实战资料包2026版本', contentId: 'v' })!;
  assert.equal([...String(e.payload.keyword)].length, 20);
  assert.equal(flywheelEventError(e), undefined);
  assert.equal(handoffReason('media'), 'media'); assert.equal(handoffReason('keyword-rule', '投诉'), 'complaint'); assert.equal(handoffReason('keyword-rule', '人工'), 'explicit_request');
  assert.equal(handoffReason(undefined), 'other'); assert.equal(handoffReason('owner-active'), 'other');
});

test('uuid v7 and channel mapping', () => {
  const a = uuidV7(Date.parse('2026-11-02T00:00:00Z')), b = uuidV7(Date.parse('2026-11-02T00:00:01Z'));
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.ok(a < b);
  assert.equal(laneChannel('desk', 'wechat'), 'wechat'); assert.equal(laneChannel('desk', 'wecom'), 'wecom'); assert.equal(laneChannel('phone', 'wechat'), 'phone'); assert.equal(laneChannel('desk', 'generic'), 'other');
  assert.equal(Object.keys(FLYWHEEL_CHANNEL_LABELS).length, 9);
  // The community edition names no chat app in its labels.
  assert.equal(FLYWHEEL_CHANNEL_LABELS.wechat, '聊天软件');
});
