import test from 'node:test';
import assert from 'node:assert/strict';
import type { Knowledge } from '../shared/types';
import { retrieveKnowledge, knowledgeFingerprint } from './knowledge';
const k=(id:string, title:string,content:string,tags:string[],aliases:string[]=[]):Knowledge=>({id,title,content,tags,aliases,enabled:true,reviewStatus:'approved',scenario:'all',createdAt:'2026-09-26',updatedAt:'2026-09-26'});
const knowledge=[
 k('training','多少钱？','培训报价按人数确认。',['业务:企业培训'],['多少钱','价格']),
 k('price','青禾套餐价格','年度100元，月度10元。',['业务:青禾','业务:greenleaf'],['青禾多少钱','青禾英文年费']),
 k('os','青禾支持电脑','仅Windows，不支持Mac。',['业务:青禾','业务:greenleaf'],['苹果电脑能用吗','mac是否支持','手机是否支持']),
];
test('显式业务名称隔离报价，英文别名同属一业务；仅产品名不触发未知政策',()=>{
 assert.equal(retrieveKnowledge(knowledge,{query:'青禾多少钱？'}).hits[0]?.id,'price');
 assert.equal(retrieveKnowledge(knowledge,{query:'How much is greenleaf per year?'}).hits[0]?.id,'price');
 assert.equal(retrieveKnowledge(knowledge,{query:'青禾火星部署政策'}).status,'no_match');
});
test('复合问题分别检索且维持业务隔离，口语兼容问法可找到依据',()=>{
 assert.equal(retrieveKnowledge(knowledge,{query:'苹果电脑能用吗？'}).hits[0]?.id,'os');
 const ids=retrieveKnowledge(knowledge,{query:'青禾多少钱，支持苹果电脑吗？'}).hits.map(h=>h.id);
 assert.ok(ids.includes('price'));assert.ok(ids.includes('os'));assert.ok(!ids.includes('training'));
});
test('不同业务相同问答不会精确去重为一个产品',()=>{
 assert.notEqual(knowledgeFingerprint(k('a','价格','100元',['业务:A'])),knowledgeFingerprint(k('b','价格','100元',['业务:B'])));
});
test('口语月付年付复合问法同时找到价格与兼容性，不借用其他业务报价',()=>{
 const ids=retrieveKnowledge(knowledge,{query:'青禾月付和年付分别多少钱？苹果电脑可以用吗？'}).hits.map(h=>h.id);
 assert.ok(ids.includes('price'));assert.ok(ids.includes('os'));assert.ok(!ids.includes('training'));
 assert.equal(retrieveKnowledge(knowledge,{query:'青禾月付合同退款违约条款'}).status,'no_match');
});

test('按月付/按年付与各是多少钱不会丢失复合问题里的价格依据',()=>{
 for (const q of ['青禾按月付和按年付各是多少钱？苹果笔记本能用吗？','青禾按月付款多少钱，按年支付呢？']) {
  const ids=retrieveKnowledge(knowledge,{query:q}).hits.map(h=>h.id);
  assert.ok(ids.includes('price'),q);assert.ok(!ids.includes('training'));
 }
});
