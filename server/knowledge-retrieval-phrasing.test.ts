import assert from 'node:assert/strict';
import test from 'node:test';
import type { Knowledge } from '../shared/types';
import { retrieveKnowledge } from './knowledge';

const k = (id: string, title: string, content: string, question = '', aliases: string[] = []): Knowledge => ({ id, title, content, question, aliases, tags: [], enabled: true, reviewStatus: 'approved', scenario: 'all', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' });
const shop = [
  k('a025', 'A025 保温杯', 'A025 不锈钢保温杯，售价59元，颜色有白色和黑色。'),
  k('b026', 'B026 保温杯', 'B026 陶瓷内胆保温杯，售价89元。', 'B026价格是多少'),
  k('ship', '发货时间', '下单后48小时内发货，节假日顺延。', '多久发货'),
  k('return', '退货政策', '签收后7天内可以无理由退货，商品需不影响二次销售。', '支持退货吗'),
  k('freight', '退货运费说明', '质量问题运费由我们承担；非质量问题退货运费由买家承担。'),
  k('invoice', '发票', '可以开电子普通发票，下单时备注抬头和税号。', '能开发票吗'),
];
const top = (query: string) => retrieveKnowledge(shop, { query }).hits.map(h => h.id);

test('日常中文问法能找到对应资料', () => {
  assert.equal(top('A025的价格是多少？')[0], 'a025');
  assert.equal(top('请问A025这款保温杯现在卖多少钱呀')[0], 'a025');
  assert.equal(top('几天能发货')[0], 'ship');
  assert.equal(top('我买的东西不想要了能退吗')[0], 'return');
  const both = top('你们支持退货吗？运费谁出？');
  assert.ok(both.includes('return'), JSON.stringify(both));
  assert.ok(both.includes('freight'), JSON.stringify(both));
});

test('问 A025 不会拿别的型号的价格回答；无关问题仍然无命中', () => {
  assert.ok(!top('A025的价格是多少？').includes('b026'));
  assert.ok(!top('请问A025这款保温杯现在卖多少钱呀').includes('b026'));
  assert.equal(retrieveKnowledge(shop, { query: '你们老板是哪里人' }).status, 'no_match');
  assert.equal(retrieveKnowledge(shop, { query: '海外仓库地址在哪里' }).status, 'no_match');
});
