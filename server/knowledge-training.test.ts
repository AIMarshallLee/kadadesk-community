import { routingFixture } from './conversation-routing-fixture';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createService } from './service';
import { isAllowedRequest } from '../desktop/guards';
import { validateTraining } from './knowledge-training';

async function fixture() {
  const root = resolve(tmpdir()), dir = await mkdtemp(join(root, 'kada-training-'));
  let calls=0, fail=false, onFetch: (()=>Promise<void>)|undefined;
  const fetchImpl = (async(_u,init)=>{calls++;if(fail)throw Error('offline');const routed=routingFixture(JSON.parse(String(init?.body)),'产品A价格');if(routed)return routed;await onFetch?.();return new Response(JSON.stringify({choices:[{message:{content:'产品A年度费用为100元。'}}]}));}) as typeof fetch;
  let service = await createService({dataDir:dir,fetchImpl});
  await service.request({method:'PUT',path:'/settings',body:{provider:{baseUrl:'http://127.0.0.1:9000',model:'fixture',temperature:0}}});
  const k = await service.request({method:'POST',path:'/knowledge',body:{title:'产品A价格',content:'产品A年度100元。',question:'产品A价格',tags:['业务:产品A'],scenario:'service'}});
  await service.request({method:'POST',path:'/knowledge/review',body:{ids:[k.id],approved:true}});
  return {get service(){return service;},k,calls:()=>calls,fail:()=>{fail=true;},onFetch:(fn:()=>Promise<void>)=>{onFetch=fn;},
    restart:async()=>{await service.close();service=await createService({dataDir:dir,fetchImpl});},
    close:async()=>{await service.close();assert.equal(dirname(resolve(dir)),root);await rm(dir,{recursive:true,force:true});}};
}
const answer = {method:'POST',path:'/knowledge/training/answer',body:{question:'产品A价格？',customerMarket:'domestic',allowModel:true}};
test('客户试答保留真实返回、审核结果与来源，重启保留，知识变化自动失效',async t=>{
  const f=await fixture();t.after(f.close);
  let view=await f.service.request(answer);assert.equal(view.records[0].answer,'产品A年度费用为100元。');assert.deepEqual(view.records[0].knowledgeIds,[f.k.id]);
  const id=view.records[0].id;assert.equal(view.correct,0);
  view=await f.service.request({method:'POST',path:'/knowledge/training/review',body:{id,verdict:'correct'}});assert.equal(view.correct,1);
  await f.restart();view=await f.service.request({method:'GET',path:'/knowledge/training'});assert.equal(view.correct,1);
  await f.service.request({method:'PUT',path:`/knowledge/${f.k.id}`,body:{content:'年度120元。'}});
  view=await f.service.request({method:'GET',path:'/knowledge/training'});assert.equal(view.correct,0);assert.equal(view.records[0].current,false);
  await assert.rejects(()=>f.service.request({method:'POST',path:'/knowledge/training/review',body:{id,verdict:'correct'}}),/旧试答/);
});
test('试答无授权不调用模型，失败不保存成功记录',async t=>{
  const f=await fixture();t.after(f.close);
  await assert.rejects(()=>f.service.request({...answer,body:{question:'产品A价格'}}),/确认/);assert.equal(f.calls(),0);
  f.fail();await assert.rejects(()=>f.service.request(answer),/话题判断暂未完成/);assert.equal(f.calls(),1);
  assert.equal((await f.service.request({method:'GET',path:'/knowledge/training'})).records.length,0);
});
test('试答生成期间知识变化拒绝结果，不能标成通过',async t=>{
  const f=await fixture();t.after(f.close);f.onFetch(async()=>{await f.service.request({method:'PUT',path:`/knowledge/${f.k.id}`,body:{enabled:false}});});
  await assert.rejects(()=>f.service.request(answer),/知识已变化|资料.*已变化/);
  assert.equal((await f.service.request({method:'GET',path:'/knowledge/training'})).records.length,0);
});
test('试答桌面桥路由可用，导入记录严格验证，不接受伪造标记',()=>{
  for(const [method,path] of [['GET','/knowledge/training'],['POST','/knowledge/training/answer'],['POST','/knowledge/training/review']])assert.equal(isAllowedRequest({method,path}),true);
  assert.throws(()=>validateTraining([{id:'forged',verdict:'correct'}]),/无效/);
});
