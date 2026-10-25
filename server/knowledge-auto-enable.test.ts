import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { Knowledge } from '../shared/types';
import { autoEnableEligible, autoEnableKnowledge } from './knowledge';
import { createService } from './service';

const at = '2026-10-01T00:00:00.000Z';
const k = (id: string, extra: Partial<Knowledge> = {}): Knowledge => ({ id, title: id, question: `${id}的问题`, content: `${id}的答案`, tags: [], enabled: false, reviewStatus: 'pending', importId: 'import_a', source: '价目表.csv', createdAt: at, updatedAt: at, ...extra });

test('only what 咔哒 organized is eligible: samples, templates, owner edits, typed entries and old versions are not', () => {
  assert.equal(autoEnableEligible(k('a')), true);
  assert.equal(autoEnableEligible(k('pack', { importId: undefined, source: '知识包导入' })), true);
  assert.equal(autoEnableEligible(k('chat', { importId: undefined, source: '本地聊天记录' })), true);
  assert.equal(autoEnableEligible(k('typed', { importId: undefined, source: undefined })), false, 'the editor has its own 保存并启用');
  assert.equal(autoEnableEligible(k('sample', { tags: ['行业样板'] })), false);
  assert.equal(autoEnableEligible(k('sample2', { source: '行业样板-通用小店.json' })), false);
  assert.equal(autoEnableEligible(k('demo', { importId: undefined, source: '示例模板：门店' })), false);
  assert.equal(autoEnableEligible(k('held', { heldForReview: true })), false);
  assert.equal(autoEnableEligible(k('old', { tags: ['资料版本:已替换'] })), false);
  assert.equal(autoEnableEligible(k('live', { enabled: true, reviewStatus: 'approved' })), false);
});

test('auto-enable goes through partial review: conflicts, 【】, unverified sources and 内部资料 stay pending with a reason', () => {
  const live = k('live', { question: '保温杯多少钱', content: '59元', enabled: true, reviewStatus: 'approved', importId: 'import_old' });
  const items = [live,
    k('ok', { question: '几天发货', content: '48小时内' }),
    k('price', { question: '保温杯多少钱', content: '69元' }),
    k('blank', { question: '营业时间', content: '每天【填写时间】营业' }),
    k('unread', { question: '退货', content: '7天', tags: ['资料状态:待核对'] }),
    k('internal', { title: '内部：成本价', question: '成本价', content: '20元' }),
    k('typed', { importId: undefined, source: undefined, question: '能开票吗', content: '能' })];
  const result = autoEnableKnowledge(items);
  assert.deepEqual(result.approved, ['ok']);
  const reasons = Object.fromEntries(result.conflicts.map(c => [c.id, c.reason]));
  assert.deepEqual(Object.keys(reasons).sort(), ['blank', 'internal', 'price', 'unread']);
  assert.match(reasons.price, /已在用的“live”/); assert.match(reasons.blank, /【填写时间】/); assert.match(reasons.internal, /内部资料/);
  assert.equal(items.find(i => i.id === 'ok')!.enabled, true);
  assert.equal(items.find(i => i.id === 'typed')!.reviewStatus, 'pending');
  assert.ok(items.filter(i => i.id !== 'ok' && i.id !== 'live').every(i => !i.enabled && i.reviewStatus === 'pending'));
  // Limited to the ids just created.
  const more = [k('x'), k('y', { question: 'y2', content: 'y2' })];
  assert.deepEqual(autoEnableKnowledge(more, ['y']).approved, ['y']); assert.equal(more[0].reviewStatus, 'pending');
});

async function fixture(t: any, dataDir?: string) {
  const directory = dataDir ?? await mkdtemp(join(tmpdir(), 'kada-auto-enable-'));
  const service = await createService({ dataDir: directory });
  t.after(async () => { await service.close(); if (!dataDir) await rm(directory, { recursive: true, force: true }); });
  const call = (method: string, path: string, body?: unknown) => service.request({ method, path, body }) as Promise<any>;
  return { call, service, directory };
}
const file = (name: string, text: string) => { const bytes = Buffer.from(text); return { name, size: bytes.length, base64: bytes.toString('base64') }; };
const rows = (p: any) => p.rows.map(({ rowId, title, content, tags, question = '', aliases = [], scenario = 'all' }: any) => ({ rowId, title, content, tags, question, aliases, scenario }));
async function importCsv(call: (m: string, p: string, b?: unknown) => Promise<any>, name: string, csv: string) {
  const p = await call('POST', '/knowledge/import/preview', { files: [file(name, csv)] });
  return call('POST', '/knowledge/import/commit', { previewId: p.previewId, rows: rows(p), confirm: true });
}

test('with 自主进化 on (the default) an import answers right away and the audit log says so', async t => {
  const { call } = await fixture(t);
  const state = await call('GET', '/state');
  assert.equal(state.preferences.autoEnableKnowledge, undefined, 'undefined means on');
  const committed = await importCsv(call, '价目表.csv', '问题,答案\n保温杯多少钱,59元\n几天发货,48小时内\n营业时间,每天【填写时间】');
  assert.equal(committed.autoEnabled.approved.length, 2);
  assert.equal(committed.autoEnabled.conflicts.length, 1); assert.match(committed.autoEnabled.conflicts[0].reason, /【填写时间】/);
  assert.equal(committed.created.filter((c: any) => c.enabled && c.reviewStatus === 'approved').length, 2, 'the commit result shows the entries as they are now');
  assert.equal((await call('POST', '/knowledge/search', { query: '几天发货' })).hits.length, 1);
  const after = await call('GET', '/state');
  assert.match(after.events.find((e: any) => e.action === 'knowledge_auto_enabled').detail, /自动启用 2 条咔哒整理的知识；1 条等你处理/);
  // A later file with a different answer to a live question waits for the owner.
  const second = await importCsv(call, '新价目表.csv', '问题,答案\n保温杯多少钱,69元');
  assert.equal(second.autoEnabled.approved.length, 0); assert.match(second.autoEnabled.conflicts[0].reason, /同一个问题、答案不同/);
});

test('turned off, imports wait for review; turning it back on enables what waited; PUT /settings keeps the choice', async t => {
  const { call } = await fixture(t);
  const off = await call('PUT', '/knowledge/settings', { autoEnableKnowledge: false });
  assert.equal(off.preferences.autoEnableKnowledge, false);
  await assert.rejects(call('PUT', '/knowledge/settings', { autoEnableKnowledge: 'yes' }), /设置无效/);
  const committed = await importCsv(call, '价目表.csv', '问题,答案\n几天发货,48小时内');
  assert.equal(committed.autoEnabled, undefined); assert.equal(committed.created[0].reviewStatus, 'pending');
  await call('PUT', '/settings', { preferences: { workspaceName: '王总的店', operatorName: '小美' } });
  assert.equal((await call('GET', '/state')).preferences.autoEnableKnowledge, false, 'saving other settings does not turn it back on');
  const on = await call('PUT', '/knowledge/settings', { autoEnableKnowledge: true });
  assert.deepEqual(on.autoEnabled.approved, [committed.created[0].id]);
  assert.equal(on.knowledge.find((item: any) => item.id === committed.created[0].id).enabled, true);
});

test('the owner\'s own edits and typed entries are never enabled automatically; 保存并启用 still works', async t => {
  const { call } = await fixture(t);
  const committed = await importCsv(call, '价目表.csv', '问题,答案\n几天发货,48小时内');
  const id = committed.created[0].id;
  const edited = await call('PUT', `/knowledge/${id}`, { content: '24小时内' });
  assert.equal(edited.reviewStatus, 'pending'); assert.equal(edited.heldForReview, true);
  const typed = await call('POST', '/knowledge', { title: '开票', question: '能开票吗', content: '能开普通发票', tags: [] });
  await call('PUT', '/knowledge/settings', { autoEnableKnowledge: true });
  let state = await call('GET', '/state');
  for (const item of [id, typed.id]) assert.equal(state.knowledge.find((x: any) => x.id === item).reviewStatus, 'pending');
  await call('POST', '/knowledge/review', { ids: [id], approved: true, partial: true });
  state = await call('GET', '/state');
  const approved = state.knowledge.find((x: any) => x.id === id);
  assert.equal(approved.enabled, true); assert.equal(approved.heldForReview, undefined);
});

test('knowledge packs and chat extracts are enabled too; preset demo playbooks are not', async t => {
  const { call } = await fixture(t);
  const pack = await call('POST', '/knowledge/pack', { confirm: true, pack: { kind: 'kadadesk-knowledge-pack', version: 1, items: [{ title: '发货', question: '几天发货', content: '48小时内', tags: [], aliases: [], scenario: 'all' }] } });
  assert.equal(pack.created, 1); assert.equal(pack.enabled, 1);
  const presets = await call('GET', '/playbooks/presets');
  await call('POST', '/playbooks/install', { packId: presets.playbooks[0].id });
  const state = await call('GET', '/state');
  assert.ok(state.knowledge.filter((x: any) => x.source?.startsWith('示例模板')).every((x: any) => x.reviewStatus === 'pending'));
});

test('folder sources are enabled after reading, and pending entries from before are enabled once at startup', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'kada-auto-enable-start-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const docs = join(directory, 'docs'); await mkdir(docs); await writeFile(join(docs, '说明.md'), '产品A价格为298元。');
  {
    const { call, service } = await fixture(t, join(directory, 'state'));
    const source = (await service.addKnowledgeFolder(docs)).sources[0];
    const view = await call('POST', '/knowledge/sources/sync', { ids: [source.id], confirm: true });
    const state = await call('GET', '/state');
    const fact = state.knowledge.find((x: any) => x.importId === source.id);
    assert.equal(fact.enabled, true); assert.equal(fact.reviewStatus, 'approved');
    assert.match(view.sources[0].detail ?? JSON.stringify(view), /自动启用 1 条/);
    await service.close();
  }
  // An install upgraded from a version without 自主进化: its waiting imports are enabled at the next start.
  const stateFile = join(directory, 'state', 'flowdesk-state.json');
  const saved = JSON.parse(await readFile(stateFile, 'utf8'));
  saved.knowledge.push({ id: 'knowledge_waiting', title: '发货', question: '几天发货', content: '48小时内', tags: [], enabled: false, reviewStatus: 'pending', importId: 'import_earlier', source: '旧资料.csv', createdAt: at, updatedAt: at });
  await writeFile(stateFile, JSON.stringify(saved), 'utf8');
  const { call } = await fixture(t, join(directory, 'state'));
  const state = await call('GET', '/state');
  assert.equal(state.knowledge.find((x: any) => x.id === 'knowledge_waiting').enabled, true);
  assert.ok(state.events.some((e: any) => e.action === 'knowledge_auto_enabled'));
});
