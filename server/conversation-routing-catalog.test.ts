import test from 'node:test';
import assert from 'node:assert/strict';
import { routeConversationKnowledge } from './conversation-routing';
import type { Knowledge } from '../shared/types';

const day = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 86400000).toISOString();
const fact = (id: string, title: string, content: string, n: number, extra: Partial<Knowledge> = {}): Knowledge => ({ id, title, content, tags: [], enabled: true, reviewStatus: 'approved', createdAt: day(n), updatedAt: day(n), approvedAt: day(n), ...extra });

test('the catalog keeps the newest and the most relevant entries, also for a follow-up message', async () => {
  const old = Array.from({ length: 120 }, (_, i) => fact(`old${i}`, `旧说明${i}`, `第${i}条旧的服务说明。`, i));
  const newest = fact('newest', '新品保温杯 A025', 'A025 保温杯 59元，有黑色和白色。', 400);
  let payload: any;
  await routeConversationKnowledge({ query: '那黑色还有货吗', history: [{ direction: 'incoming', text: 'A025 保温杯多少钱' }], knowledge: [...old, newest],
    classify: async raw => { payload = JSON.parse(raw); return JSON.stringify({ kind: 'social', confidence: .99, topics: [] }); } });
  const ids = payload.catalog.flatMap((g: any) => g.entries.map((e: any) => e.id));
  assert.equal(ids[0], 'newest', 'found through the earlier customer message');
  assert.ok(ids.includes('old119') && !ids.includes('old0'), 'unranked entries are listed newest first');
});

test('untagged knowledge gets a retrieval fallback when the model names the group without entry ids', async () => {
  const shop = [fact('ship', '发货时间', '下单后48小时内发货。', 1, { question: '多久发货' }), fact('ret', '退货政策', '7天无理由退货。', 2, { question: '支持退货吗' })];
  const routed = await routeConversationKnowledge({ query: '几天能发货', knowledge: shop,
    classify: async raw => { const p = JSON.parse(raw); return JSON.stringify({ kind: 'business', confidence: .9, topics: [{ businessId: p.catalog[0].id, query: '几天能发货', entryIds: [] }] }); } });
  assert.deepEqual(routed.knowledge.map(k => k.id), ['ship']);
});

test('more than 64 businesses still route instead of asking every customer to clarify', async () => {
  const many = Array.from({ length: 90 }, (_, i) => fact(`b${i}`, `门店${i}营业时间`, `门店${i}每天9点开门。`, i, { tags: [`业务:门店${i}`], question: `门店${i}几点开门` }));
  const routed = await routeConversationKnowledge({ query: '门店7几点开门', knowledge: many,
    classify: async raw => { const p = JSON.parse(raw); const group = p.catalog.find((g: any) => g.names.includes('门店7')); return JSON.stringify({ kind: 'business', confidence: .9, topics: [{ businessId: group.id, query: '门店7几点开门', entryIds: [group.entries[0].id] }] }); } });
  assert.equal(routed.intent.kind, 'business');
  assert.deepEqual(routed.knowledge.map(k => k.id), ['b7']);
});
