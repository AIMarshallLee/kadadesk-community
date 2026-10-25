import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FOLLOWUP_SETTINGS, addFacts, addPurchase, adminSummary, bizField, cleanStore, csvCell, currentFact, currentValue, emptyStore, findHeaderRow, findProfile, followUpCandidates, guessMapping,
  importRecords, leadMatches, matchFilter, mergeImport, mergeProfiles, newProfile, parseCapture, parseDay, parseOwnerNote, parseWhen, profilesCsv, replyContext, seedLines, sendBlocked, zonedTime,
  type BusinessLine, type CaptureMessage, type CustomersStore,
} from './customers';

const T0 = Date.parse('2026-10-26T02:00:00Z'); // Monday 10:00 in Asia/Shanghai
const iso = (ms: number) => new Date(ms).toISOString();
const line = (id: string, name: string, extra: Partial<BusinessLine> = {}): BusinessLine => ({ id, name, products: [], stages: ['新咨询', '问过价', '发过付款方式', '已成交', '售后/复购'], fields: [], ...extra });
const store = (): CustomersStore => ({ ...emptyStore(), lines: [line('soft', '咔哒软件', { products: [{ name: '年卡', renewDays: 365 }] }), line('course', '课程培训')] });

test('business lines come from the 业务 tags of knowledge: the names on one item are one line; a generic line when none', () => {
  const lines = seedLines([['业务:咔哒', '业务:kadadesk', '市场:国内'], ['业务:kadadesk'], ['业务:AI课程'], ['其他']]);
  assert.deepEqual(lines.map(l => [l.name, l.aliases ?? []]), [['咔哒', ['kadadesk']], ['AI课程', []]]);
  assert.deepEqual(lines[0]!.stages, ['新咨询', '问过价', '发过付款方式', '已成交', '售后/复购']);
  assert.deepEqual(seedLines([]).map(l => l.name), ['我的业务']);
  // Existing lines are kept; only new ones are added.
  assert.equal(seedLines([['业务:咔哒'], ['业务:企业服务']], lines).length, 3);
});

test('the store is read field by field: damaged entries go, the rest stays; inferred sensitive facts and secrets are dropped', () => {
  const at = iso(T0);
  const s = cleanStore({ version: 1, lines: [line('soft', '咔哒软件'), { name: '' }], segments: [{ name: '高意向', filter: { intent: '高', bogus: 1 } }], profiles: [
    { id: 'c1', channel: 'desk', name: '王总', aliases: [], facts: [{ field: 'city', value: '杭州', source: 'customer', at }, { field: 'gender', value: '男', source: 'inferred', at }, { field: 'notes', value: 'x', source: 'owner', at }, { field: 'company', value: '密码：abc12345', source: 'owner', at }], tags: ['VIP', 'vip'], notes: [], purchases: [], createdAt: at, updatedAt: at },
    { id: '', name: 'broken' }, null,
  ] });
  assert.equal(s.lines.length, 1);
  assert.equal(s.profiles.length, 1);
  assert.deepEqual(s.profiles[0]!.facts.map(f => f.field), ['city']);
  assert.deepEqual(s.profiles[0]!.tags, ['VIP']);
  assert.deepEqual(s.segments[0]!.filter, { intent: '高' });
  assert.deepEqual(cleanStore({ version: 2 }), emptyStore());
});

test('facts: newest wins, a guess never replaces what somebody said, stage follows the newest judgement; history is bounded', () => {
  const p = newProfile('王总', 'desk', iso(T0));
  addFacts(p, [{ field: 'city', value: '杭州', quote: '我在杭州' }], 'customer', iso(T0));
  addFacts(p, [{ field: 'city', value: '上海' }], 'inferred', iso(T0 + 1000));
  assert.equal(currentValue(p, 'city'), '杭州');
  addFacts(p, [{ field: bizField('soft', 'stage'), value: '问过价' }], 'owner', iso(T0));
  addFacts(p, [{ field: bizField('soft', 'stage'), value: '已成交' }], 'inferred', iso(T0 + 2000));
  assert.equal(currentFact(p, bizField('soft', 'stage'))!.source, 'inferred');
  for (let i = 0; i < 9; i++) addFacts(p, [{ field: 'scale', value: `${i} 家店` }], 'owner', iso(T0 + 10000 + i));
  assert.equal(p.facts.filter(f => f.field === 'scale').length, 5);
  assert.equal(currentValue(p, 'scale'), '8 家店');
  // Sensitive: never from a guess; health words are marked; income/religion/ethnicity never from a chat.
  assert.equal(addFacts(p, [{ field: 'age', value: '35' }], 'inferred', iso(T0)).length, 0);
  assert.equal(addFacts(p, [{ field: 'interests', value: '信佛' }], 'customer', iso(T0)).length, 0);
  assert.equal(addFacts(p, [{ field: 'interests', value: '年薪 50 万' }], 'customer', iso(T0)).length, 0);
  assert.equal(addFacts(p, [{ field: 'interests', value: '有糖尿病', quote: '我有糖尿病' }], 'customer', iso(T0))[0]!.sensitive, true);
  assert.equal(addFacts(p, [{ field: 'company', value: ['s', 'k', '-abcdefghijklmnopqrstuvwx'].join('') }], 'owner', iso(T0)).length, 0);
});

test('the capture answer keeps only real customer quotes; sensitive facts need an explicit statement; stages come from the line list', () => {
  const lines = store().lines;
  const chat: CaptureMessage[] = [{ direction: 'incoming', text: '你好，我们是杭州的一家口腔诊所，三个门店' }, { direction: 'outgoing', text: '您好！请问您是男士吗' }, { direction: 'incoming', text: '我是女的，今年38岁。预算大概2万，老板娘拍板。验证码 482915' }];
  const raw = JSON.stringify({ facts: [
    { field: 'industry', value: '口腔诊所', quote: '我们是杭州的一家口腔诊所' },
    { field: 'city', value: '杭州', quote: '杭州的一家口腔诊所' },
    { field: 'scale', value: '三个门店', quote: '三个门店' },
    { field: 'gender', value: '女', quote: '我是女的' },
    { field: 'age', value: '38', quote: '今年38岁' },
    { field: 'gender', value: '男', quote: '您好！请问您是男士吗' }, // our side, not the customer
    { field: 'phone', value: ['139', '0000', '0000'].join(''), quote: `我的电话${['139', '0000', '0000'].join('')}` }, // not in the chat
    { field: 'biz.soft.budget', value: '2万', quote: '预算大概2万' },
    { field: 'biz.soft.decisionMaker', value: '老板娘', quote: '老板娘拍板' },
    { field: 'biz.nope.budget', value: '1万', quote: '预算大概2万' },
    { field: 'comm.channel', value: '验证码 482915', quote: '验证码 482915' },
    { field: 'biz.soft.purchase', value: '年卡', quote: '老板娘拍板' },
  ], lines: [{ line: 'soft', stage: '问过价', intent: '高' }, { line: 'course', stage: '随便写的', intent: '超高' }, { line: 'zzz', stage: '已成交' }] });
  const patch = parseCapture(`好的，结果如下：${raw}`, chat, lines);
  assert.deepEqual(patch.facts.map(f => f.field), ['industry', 'city', 'scale', 'gender', 'age', 'biz.soft.budget', 'biz.soft.decisionMaker']);
  assert.deepEqual(patch.lines, [{ line: 'soft', stage: '问过价', intent: '高' }]);
  assert.equal(patch.purchases.length, 1);
  assert.equal(patch.dropped, 4);
  // A gender the customer did not say in so many words is dropped even with a real quote.
  assert.equal(parseCapture(JSON.stringify({ facts: [{ field: 'gender', value: '女', quote: '老板娘拍板' }] }), chat, lines).facts.length, 0);
  assert.deepEqual(parseCapture('不是 JSON', chat, lines), { facts: [], purchases: [], lines: [], dropped: 0 });
});

test('reply context: what the customer and the owner said plus stages, never sensitive, guessed or phone values, bounded', () => {
  const dummyPhone = ['139', '0000', '0000'].join('');
  const s = store(); const p = newProfile('王总', 'desk', iso(T0)); s.profiles.push(p);
  addFacts(p, [{ field: 'industry', value: '口腔诊所', quote: 'x' }, { field: 'gender', value: '女', quote: '我是女的' }, { field: 'phone', value: dummyPhone }], 'customer', iso(T0));
  addFacts(p, [{ field: 'city', value: '杭州' }], 'inferred', iso(T0));
  addFacts(p, [{ field: bizField('soft', 'stage'), value: '问过价' }, { field: bizField('soft', 'needs'), value: '晚上自动回客户' }], 'inferred', iso(T0));
  addFacts(p, [{ field: bizField('soft', 'budget'), value: '2万' }], 'owner', iso(T0));
  const text = replyContext(p, s.lines);
  assert.match(text, /行业：口腔诊所/); assert.match(text, /【咔哒软件】阶段问过价，预算2万/);
  assert.doesNotMatch(text, new RegExp(['女|', dummyPhone, '|杭州|晚上自动回客户'].join('')));
  assert.equal(replyContext(undefined, s.lines), '');
  addFacts(p, [{ field: 'interests', value: '很长'.repeat(200) }], 'owner', iso(T0 + 1));
  assert.ok(replyContext(p, s.lines, 120).length < 220);
});

test('admin summary hides phone numbers and sensitive fields; filters and CSV export work; formulas are neutralised', () => {
  const dummyPhone = ['139', '0000', '0000'].join('');
  const s = store(); const p = newProfile('王总', 'desk', iso(T0)); s.profiles.push(p);
  addFacts(p, [{ field: 'industry', value: '口腔诊所' }, { field: 'gender', value: '女' }, { field: bizField('soft', 'stage'), value: '问过价' }, { field: bizField('soft', 'intent'), value: '高' }], 'owner', iso(T0));
  addNote(p, `电话${dummyPhone}，周末再联系`);
  const summary = adminSummary(p, s.lines);
  assert.match(summary, /咔哒软件：问过价·意向高/);
  assert.doesNotMatch(summary, new RegExp(['女|', dummyPhone].join('')));
  assert.ok(matchFilter(p, { line: 'soft', stage: '问过价', intent: '高' }, s.lines, T0));
  assert.ok(!matchFilter(p, { line: 'course' }, s.lines, T0));
  assert.ok(matchFilter(p, { q: '口腔' }, s.lines, T0));
  assert.ok(!matchFilter(p, { due: true }, s.lines, T0));
  p.name = '=HYPERLINK("x")';
  const csv = profilesCsv(s.profiles, s.lines);
  assert.ok(csv.startsWith('﻿名字,'));
  assert.match(csv, /"'=HYPERLINK\(""x""\)"/);
  assert.equal(csvCell('+1'), "'+1");
  function addNote(profile: typeof p, text: string) { profile.notes.push({ text, at: iso(T0), source: 'owner' }); }
});

test('merging keeps both histories and the second name as an alias; lookups ignore spacing, width and emoji', () => {
  const a = newProfile('王总', 'desk', iso(T0)), b = newProfile('王总🌸（手机）', 'phone', iso(T0));
  addFacts(b, [{ field: 'city', value: '杭州' }], 'owner', iso(T0));
  addPurchase(b, { line: 'soft', product: '年卡', source: 'owner' });
  mergeProfiles(a, b, iso(T0));
  assert.deepEqual(a.aliases, ['王总🌸（手机）']); assert.equal(currentValue(a, 'city'), '杭州'); assert.equal(a.purchases.length, 1);
  const s = { profiles: [a] };
  assert.equal(findProfile(s, ' 王 总 '), a); assert.equal(findProfile(s, '王总（手机）'), a); assert.equal(findProfile(s, '王总', 'phone'), undefined);
});

test('owner notes: obvious labelled values become facts, the rest one note', () => {
  const dummyPhone = ['138', '0013', '8000'].join('');
  const lines = store().lines;
  const r = parseOwnerNote(`城市:杭州 行业：口腔 预算5万 电话${dummyPhone} 咔哒软件 问过价 老板娘拍板，周末再聊`, lines);
  assert.deepEqual(r.facts.map(f => `${f.field}=${f.value}`), [`phone=${dummyPhone}`, 'city=杭州', 'industry=口腔', 'biz.soft.budget=5万', 'biz.soft.stage=问过价']);
  assert.equal(r.note, '咔哒软件 问过价 老板娘拍板，周末再聊');
  assert.deepEqual(parseOwnerNote('人很好，下次带样品', lines).facts, []);
});

test('time words: 明天, 后天下午3点, 3天后, 下周一, 周五, 10月30日, 2026-11-02 15:30; nonsense is refused', () => {
  const at = (s: string) => { const v = parseWhen(s, T0, 'Asia/Shanghai'); return v === undefined ? undefined : new Date(v + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' '); };
  assert.equal(at('明天'), '2026-10-27 10:00');
  assert.equal(at('后天下午3点'), '2026-10-28 15:00');
  assert.equal(at('明晚8点半'), '2026-10-27 20:30');
  assert.equal(at('3天后'), '2026-10-29 10:00');
  assert.equal(at('三天后'), '2026-10-29 10:00');
  assert.equal(at('下周一'), '2026-11-02 10:00');
  assert.equal(at('周五'), '2026-10-30 10:00');
  assert.equal(at('周一'), '2026-10-26 10:00');
  assert.equal(at('10月30日'), '2026-10-30 10:00');
  assert.equal(at('10-20'), '2027-10-20 10:00');
  assert.equal(at('2026-11-02 15:30'), '2026-11-02 15:30');
  assert.equal(at('问试用感受'), undefined);
  assert.equal(at('13月40日'), undefined);
  assert.equal(zonedTime(2026, 10, 26, 10, 0, 'Asia/Shanghai'), T0);
});

test('the follow-up list: an owner date first, expiry at 30/7/1 days once each, 问过价 without buying, quiet high intent; gaps and 不合适 respected', () => {
  const s = store(); const DAY = 86400000;
  const mk = (name: string) => { const p = newProfile(name, 'desk', iso(T0 - 30 * DAY)); p.updatedAt = iso(T0 - 30 * DAY); s.profiles.push(p); return p; };
  const due = mk('约好的'); due.nextFollowUp = { at: iso(T0 + 3600000), reason: '问试用感受', source: 'owner' }; due.lastFollowUpAt = iso(T0 - DAY);
  const exp = mk('快到期'); addPurchase(exp, { line: 'soft', product: '年卡', at: iso(T0 - 360 * DAY), expiresAt: iso(T0 + 5 * DAY), source: 'import' });
  const price = mk('问过价'); addFacts(price, [{ field: bizField('soft', 'stage'), value: '问过价' }], 'inferred', iso(T0 - 4 * DAY));
  const fresh = mk('刚问价'); addFacts(fresh, [{ field: bizField('soft', 'stage'), value: '问过价' }], 'inferred', iso(T0 - DAY));
  const quiet = mk('意向高'); addFacts(quiet, [{ field: bizField('course', 'intent'), value: '高' }], 'inferred', iso(T0 - 20 * DAY)); quiet.lastContactAt = iso(T0 - 6 * DAY);
  const recent = mk('刚跟进过'); addFacts(recent, [{ field: bizField('soft', 'stage'), value: '问过价' }], 'inferred', iso(T0 - 9 * DAY)); recent.lastFollowUpAt = iso(T0 - 2 * DAY);
  const unfit = mk('不合适'); addFacts(unfit, [{ field: bizField('soft', 'stage'), value: '不合适' }], 'owner', iso(T0 - 9 * DAY)); unfit.lastContactAt = iso(T0 - 9 * DAY);
  const list = followUpCandidates(s, DEFAULT_FOLLOWUP_SETTINGS, T0, 'Asia/Shanghai');
  assert.deepEqual(list.map(c => [c.name, c.reason]), [['约好的', 'due'], ['快到期', 'expiring'], ['问过价', 'price'], ['意向高', 'quiet']]);
  assert.equal(list[1]!.threshold, 7); assert.match(list[1]!.why, /还有 5 天到期/);
  exp.purchases[0]!.reminded = [7];
  assert.ok(!followUpCandidates(s, DEFAULT_FOLLOWUP_SETTINGS, T0, 'Asia/Shanghai').some(c => c.name === '快到期'));
  assert.equal(followUpCandidates(s, DEFAULT_FOLLOWUP_SETTINGS, T0 + 4.5 * DAY, 'Asia/Shanghai').find(c => c.name === '快到期')?.threshold, 1);
});

test('send caps: daytime only, customers first, a daily cap, one follow-up per customer per N days unless the owner set the date', () => {
  const p = newProfile('王总', 'desk', iso(T0)); const log = Array.from({ length: 3 }, () => ({ at: iso(T0 - 60000), profileId: 'x', kind: 'followup' as const }));
  assert.equal(sendBlocked({ now: T0, timezone: 'Asia/Shanghai', log: [], kind: 'followup', dailyCap: 3 }), undefined);
  assert.match(sendBlocked({ now: Date.parse('2026-10-26T13:00:00Z'), timezone: 'Asia/Shanghai', log: [], kind: 'followup', dailyCap: 3 })!, /9:30–20:30/);
  assert.match(sendBlocked({ now: T0, timezone: 'Asia/Shanghai', log: [], kind: 'followup', dailyCap: 3, customerWaiting: true })!, /先回客户/);
  assert.match(sendBlocked({ now: T0, timezone: 'Asia/Shanghai', log, kind: 'followup', dailyCap: 3 })!, /上限/);
  assert.equal(sendBlocked({ now: T0, timezone: 'Asia/Shanghai', log, kind: 'broadcast', dailyCap: 3 }), undefined);
  p.lastFollowUpAt = iso(T0 - 86400000);
  assert.match(sendBlocked({ now: T0, timezone: 'Asia/Shanghai', log: [], kind: 'followup', dailyCap: 3, profile: p, gapDays: 7 })!, /7 天内/);
  assert.equal(sendBlocked({ now: T0, timezone: 'Asia/Shanghai', log: [], kind: 'followup', dailyCap: 3, profile: p, gapDays: 7, ownerSetDate: true }), undefined);
});

test('import: the header is found under a title row, columns are guessed, rows merge by phone or name, renewals give an expiry', () => {
  const grid = [['2026 客户订单'], ['客户名', '手机号', '行业', '标签', '产品', '金额', '下单时间', '到期'], ['王总', '139 0000 0000', '口腔', 'VIP、老客户', '年卡', '2198', '2026-01-02', ''], ['李姐', '', '美业', '', '训练营', '999', '2026/10/1', '2027.10.01'], ['', '', '', '', '', '', '', ''], ['', '', '只有行业', '', '', '', '', '']];
  const header = findHeaderRow(grid); assert.equal(header, 1);
  const mapping = guessMapping(grid[header]!);
  assert.deepEqual(mapping, ['name', 'phone', 'industry', 'tags', 'product', 'amount', 'purchasedAt', 'expiresAt']);
  const { records, skipped } = importRecords(grid, header, mapping);
  assert.equal(records.length, 2); assert.equal(skipped, 1);
  const s = store(); const old = newProfile('王总改名了', 'desk', iso(T0)); addFacts(old, [{ field: 'phone', value: ['139', '0000', '0000'].join('') }], 'owner', iso(T0)); s.profiles.push(old);
  const r = mergeImport(s, records, 'course', iso(T0));
  assert.deepEqual(r, { added: 1, updated: 1, purchases: 2, full: 0 });
  assert.equal(s.profiles.length, 2);
  assert.deepEqual(old.tags, ['VIP', '老客户']);
  assert.equal(old.purchases[0]!.line, 'soft'); // 年卡 is a product of 咔哒软件
  assert.equal(old.purchases[0]!.expiresAt!.slice(0, 10), '2027-01-02');
  assert.equal(currentValue(old, bizField('soft', 'stage')), '已成交');
  assert.equal(s.profiles[1]!.purchases[0]!.line, 'course');
  assert.equal(s.profiles[1]!.purchases[0]!.expiresAt!.slice(0, 10), '2027-10-01');
  assert.equal(parseDay('45658')!.slice(0, 10), '2025-01-01');
  assert.equal(parseDay('不是日期'), undefined);
});

test('门店线索: the 加聊天软件 remark or the same shop name matches; short or different names do not', () => {
  assert.ok(leadMatches('线索-口腔-德美口腔', '德美口腔（万达店）'));
  assert.ok(leadMatches('德美口腔门诊部', '德美口腔门诊部'));
  assert.ok(leadMatches('德美口腔诊所', '德美口腔诊所店'));
  assert.ok(!leadMatches('王总', '王总口腔'));
  assert.ok(!leadMatches('美丽口腔诊所', '德美皮肤管理中心'));
});
