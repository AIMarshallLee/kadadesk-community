import { routingFixture } from './conversation-routing-fixture';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createService } from './service';
import { marketPriceFacts } from '../shared/customer-market';

test('practice without a chosen market answers like a domestic live reply and keeps the ¥ price facts', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'kada-practice-')); let sent = '';
  const fetchImpl = (async (_u, init) => { const body = JSON.parse(String(init?.body)); const routed = routingFixture(body, '保温杯价格'); if (routed) return routed; sent = JSON.stringify(body.messages); return new Response(JSON.stringify({ choices: [{ message: { content: '保温杯59元。' } }] })); }) as typeof fetch;
  const service = await createService({ dataDir: dir, fetchImpl });
  t.after(async () => { await service.close(); await rm(dir, { recursive: true, force: true }); });
  await service.request({ method: 'PUT', path: '/settings', body: { provider: { baseUrl: 'http://127.0.0.1:9000', model: 'fixture', temperature: 0 } } });
  const k = await service.request({ method: 'POST', path: '/knowledge', body: { title: '保温杯价格', content: '保温杯59元。', question: '保温杯价格', tags: [] } });
  await service.request({ method: 'POST', path: '/knowledge/review', body: { ids: [k.id], approved: true } });
  const view = await service.request({ method: 'POST', path: '/knowledge/training/answer', body: { question: '保温杯价格？', allowModel: true } });
  assert.equal(view.records[0].customerMarket, 'domestic');
  assert.deepEqual(view.records[0].knowledgeIds, [k.id]);
  assert.match(sent, /保温杯59元/);
});

test('price facts for a market are ordered newest approval first', () => {
  const at = (iso: string) => ({ updatedAt: iso, approvedAt: iso });
  const facts = [
    { id: 'old', title: '价目表', content: '保温杯59元', tags: [], ...at('2026-09-01T00:00:00Z') },
    { id: 'usd', title: 'Price', content: 'Cup US$9', tags: [], ...at('2026-10-20T00:00:00Z') },
    { id: 'new', title: '新价目表', content: '保温杯69元', tags: [], ...at('2026-10-10T00:00:00Z') },
    { id: 'none', title: '发货', content: '48小时内发货', tags: [], ...at('2026-10-21T00:00:00Z') },
  ];
  assert.deepEqual(marketPriceFacts(facts, 'domestic').map(f => f.id), ['new', 'old']);
  assert.deepEqual(marketPriceFacts(facts, 'international').map(f => f.id), ['usd']);
  assert.deepEqual(marketPriceFacts(facts, 'unknown'), []);
});
