import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createService } from './service';

async function fixture(t: any) {
  const directory = await mkdtemp(join(tmpdir(), 'kada-review-')); const service = await createService({ dataDir: directory });
  t.after(async () => { await service.close(); await rm(directory, { recursive: true, force: true }); });
  return (method: string, path: string, body?: unknown) => service.request({ method, path, body }) as Promise<any>;
}
const file = (name: string, text: string) => { const bytes = Buffer.from(text); return { name, size: bytes.length, base64: bytes.toString('base64') }; };
const rows = (p: any) => p.rows.map(({ rowId, title, content, tags, question = '', aliases = [], scenario = 'all' }: any) => ({ rowId, title, content, tags, question, aliases, scenario }));
async function importCsv(call: Awaited<ReturnType<typeof fixture>>, name: string, csv: string, replacePrevious?: boolean) {
  const p = await call('POST', '/knowledge/import/preview', { files: [file(name, csv)] });
  const committed = await call('POST', '/knowledge/import/commit', { previewId: p.previewId, rows: rows(p), confirm: true, ...(replacePrevious === undefined ? {} : { replacePrevious }) });
  return { preview: p, committed };
}

test('partial review approves what it can and returns each conflict with a plain reason; the owner can replace the old entry', async t => {
  const call = await fixture(t);
  const first = await importCsv(call, '价目表.csv', '问题,答案\n保温杯多少钱,59元\n几天发货,48小时内');
  await call('POST', '/knowledge/review', { ids: first.committed.created.map((k: any) => k.id), approved: true });
  const second = await importCsv(call, '新价目表.csv', '问题,答案\n保温杯多少钱,69元\n支持退货吗,7天无理由');
  const ids = second.committed.created.map((k: any) => k.id);
  await assert.rejects(call('POST', '/knowledge/review', { ids, approved: true }), /同问题不同答案/, 'strict review keeps the old all-or-nothing contract');
  const result = await call('POST', '/knowledge/review', { ids, approved: true, partial: true });
  assert.equal(result.review.approved.length, 1);
  assert.equal(result.review.conflicts.length, 1);
  const conflict = result.review.conflicts[0];
  assert.match(conflict.reason, /同一个问题、答案不同/);
  const old = first.committed.created.find((k: any) => k.content === '59元');
  assert.deepEqual(conflict.conflictIds, [old.id]);
  const replaced = await call('POST', '/knowledge/review', { ids: [conflict.id], approved: true, partial: true, retireIds: conflict.conflictIds });
  assert.deepEqual(replaced.review.approved, [conflict.id]); assert.deepEqual(replaced.review.retired, [old.id]);
  const state = await call('GET', '/state');
  assert.equal(state.knowledge.find((k: any) => k.id === old.id).enabled, false);
  assert.equal(state.knowledge.find((k: any) => k.id === conflict.id).enabled, true);
});

test('entries with unfilled 【…】 cannot be approved and say why', async t => {
  const call = await fixture(t);
  const { committed } = await importCsv(call, '模板.csv', '问题,答案\n营业时间,每天【开门时间】到【关门时间】\n地址,北京市朝阳区1号');
  const ids = committed.created.map((k: any) => k.id);
  await assert.rejects(call('POST', '/knowledge/review', { ids, approved: true }), /【开门时间】没填/);
  const result = await call('POST', '/knowledge/review', { ids, approved: true, partial: true });
  assert.equal(result.review.approved.length, 1);
  assert.match(result.review.conflicts[0].reason, /【开门时间】没填/);
  const state = await call('GET', '/state');
  assert.equal(state.knowledge.find((k: any) => k.content.includes('【')).enabled, false);
});

test('re-importing the same file: unchanged facts are skipped, the old version retires once the new content is approved', async t => {
  const call = await fixture(t);
  // 自主进化 off: this test is about the manual review gate.
  await call('PUT', '/knowledge/settings', { autoEnableKnowledge: false });
  const first = await importCsv(call, '价目表.csv', '问题,答案\n保温杯多少钱,59元\n几天发货,48小时内');
  await call('POST', '/knowledge/review', { ids: first.committed.created.map((k: any) => k.id), approved: true });
  const p = await call('POST', '/knowledge/import/preview', { files: [file('价目表.csv', '问题,答案\n保温杯多少钱,69元\n几天发货,48小时内')] });
  assert.equal(p.replaces[0].source, '价目表.csv');
  assert.match(p.warnings[0], /这份资料之前导入过，新内容审核后旧版本会停用/);
  const committed = await call('POST', '/knowledge/import/commit', { previewId: p.previewId, rows: rows(p), confirm: true, replacePrevious: true });
  assert.equal(committed.created.length, 1); assert.equal(committed.skipped, 1);
  let state = await call('GET', '/state');
  const oldPrice = first.committed.created.find((k: any) => k.content === '59元'), shipping = first.committed.created.find((k: any) => k.content === '48小时内');
  assert.equal(state.knowledge.find((k: any) => k.id === oldPrice.id).enabled, true, 'old price answers until the new one is approved');
  const reviewed = await call('POST', '/knowledge/review', { ids: [committed.created[0].id], approved: true, partial: true });
  assert.deepEqual(reviewed.review.conflicts, []);
  state = await call('GET', '/state');
  assert.equal(state.knowledge.find((k: any) => k.id === oldPrice.id).enabled, false);
  assert.ok(state.knowledge.find((k: any) => k.id === oldPrice.id).tags.includes('资料版本:已替换'));
  assert.equal(state.knowledge.find((k: any) => k.id === shipping.id).enabled, true, 'the unchanged fact keeps answering');
  const live = state.knowledge.filter((k: any) => k.enabled && /保温杯/.test(k.question ?? ''));
  assert.deepEqual(live.map((k: any) => k.content), ['69元']);
});

test('re-importing a file that only dropped a line retires that line at once', async t => {
  const call = await fixture(t);
  const first = await importCsv(call, '价目表.csv', '问题,答案\n保温杯多少钱,59元\n水杯多少钱,19元');
  await call('POST', '/knowledge/review', { ids: first.committed.created.map((k: any) => k.id), approved: true });
  const again = await importCsv(call, '价目表.csv', '问题,答案\n保温杯多少钱,59元', true);
  assert.equal(again.committed.created.length, 0);
  const state = await call('GET', '/state');
  assert.deepEqual(state.knowledge.filter((k: any) => k.source === '价目表.csv' && k.enabled).map((k: any) => k.content), ['59元']);
});

test('saving an approved entry without changes keeps it on; a changed save goes back to review and can be enabled right away', async t => {
  const call = await fixture(t);
  const k = await call('POST', '/knowledge', { title: '营业时间', content: '每天9点到21点', tags: [] });
  await call('POST', '/knowledge/review', { ids: [k.id], approved: true });
  const same = await call('PUT', `/knowledge/${k.id}`, { title: '营业时间', content: '每天9点到21点', tags: [], question: '', aliases: [], scenario: 'all' });
  assert.equal(same.enabled, true); assert.equal(same.reviewStatus, 'approved');
  const changed = await call('PUT', `/knowledge/${k.id}`, { title: '营业时间', content: '每天10点到22点', tags: [], question: '', aliases: [], scenario: 'all' });
  assert.equal(changed.enabled, false); assert.equal(changed.reviewStatus, 'pending');
  const enabled = await call('POST', '/knowledge/review', { ids: [k.id], approved: true, partial: true });
  assert.deepEqual(enabled.review.approved, [k.id]);
});

test('a file with more than 300 entries is committed in batches and nothing is dropped', async t => {
  const call = await fixture(t);
  const csv = '问题,答案\n' + Array.from({ length: 650 }, (_, i) => `型号S${i + 100}多少钱,${i + 10}元`).join('\n');
  const p = await call('POST', '/knowledge/import/preview', { files: [file('大价目表.csv', csv)] });
  assert.equal(p.rows.length, 650); assert.ok(p.warnings.some((w: string) => /分几批保存/.test(w)));
  const all = rows(p); let created = 0;
  for (let i = 0; i < all.length; i += 300) created += (await call('POST', '/knowledge/import/commit', { previewId: p.previewId, rows: all.slice(i, i + 300), confirm: true })).created.length;
  assert.equal(created, 650);
  await assert.rejects(call('POST', '/knowledge/import/commit', { previewId: p.previewId, rows: all.slice(0, 1), confirm: true }), /已经提交/);
  const again = await call('POST', '/knowledge/import/commit', { previewId: p.previewId, rows: all.slice(0, 300), confirm: true });
  assert.equal(again.created.length, 300, 'the same batch is idempotent');
  assert.equal((await call('GET', '/state')).knowledge.filter((k: any) => k.source === '大价目表.csv').length, 650);
});
