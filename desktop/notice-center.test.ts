import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNoticeCenter } from './notice-center';

test('提醒：卡片优先、同类 10 分钟内不重复、「不再提醒」永久静音且重启后还在、能恢复', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'kada-notice-')); t.after(() => rm(dir, { recursive: true, force: true }));
  let clock = 0; const cards: string[] = [], system: string[] = [];
  const c = createNoticeCenter({ file: join(dir, 'notices.json'), now: () => clock });
  c.setSinks({ card: card => { cards.push(card.key); return true; }, system: title => system.push(title) });
  assert.equal(await c.show({ key: 'owner-busy', title: '等你停手', body: 'x', pause: true }), 'card');
  assert.equal(await c.show({ key: 'owner-busy', title: '等你停手', body: 'x' }), 'cooldown');
  clock += 600_001;
  assert.equal(await c.show({ key: 'owner-busy', title: '等你停手', body: 'x' }), 'card');
  await c.mute('owner-busy');
  clock += 10_000_000;
  assert.equal(await c.show({ key: 'owner-busy', title: '等你停手', body: 'x' }), 'muted');
  const again = createNoticeCenter({ file: join(dir, 'notices.json'), now: () => clock });
  assert.equal(again.isMuted('owner-busy'), true, 'muting survives a restart');
  await again.unmute('owner-busy'); assert.equal(again.isMuted('owner-busy'), false);
  c.setSinks({ card: () => false, system: title => system.push(title) });
  assert.equal(await c.show({ key: 'resource-tight', title: '吃紧', body: 'y' }), 'system', 'no room for the card: system notification');
  assert.equal(await c.show({ key: 'made-up', title: 'z', body: 'z', cooldownMs: 0 }), 'system');
  await c.mute('made-up'); assert.equal(c.isMuted('other'), true, 'unknown keys mute as 其他提醒');
});

test('提醒卡片的额外按钮：点一次只执行一次', async () => {
  const center = createNoticeCenter();
  const cards: any[] = []; let runs = 0;
  center.setSinks({ card: c => { cards.push(c); return true; } });
  assert.equal(await center.show({ key: 'group-mingle', title: '咔哒 · 混群', body: '认出一个群', cooldownMs: 0, extra: { label: '这个群别管', run: () => { runs++; } } }), 'card');
  assert.equal(cards[0].extra, '这个群别管');
  await center.runExtra(cards[0].id); await center.runExtra(cards[0].id);
  assert.equal(runs, 1);
  await center.runExtra('nope');
});
