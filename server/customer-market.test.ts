import { routingFixture } from './conversation-routing-fixture';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createService } from './service';
import { assertMarketReply, marketKnowledge, marketWorkflow, customerMarket, type CustomerMarket } from '../shared/customer-market';

test('市场资料在检索前隔离；旧混合报价、错误标签、未知市场均不泄露报价',()=>{
 const rows=[{title:'国内',content:'月费298元',tags:['市场:国内']},{title:'海外',content:'Monthly US$298',tags:['市场:海外']},{title:'通用',content:'支持Windows11',tags:[]},{title:'混合',content:'298元或US$298',tags:[]},{title:'错误标签',content:'US$298',tags:['市场:国内']}];
 assert.deepEqual(marketKnowledge(rows,'domestic').map(k=>k.title),['国内','通用']);
 assert.deepEqual(marketKnowledge(rows,'international').map(k=>k.title),['海外','通用']);
 assert.deepEqual(marketKnowledge(rows,'unknown').map(k=>k.title),['通用']);
 assert.equal(marketWorkflow('语气简洁\n价格298元和2998美元\n海外US$298','domestic'),'语气简洁');
 for(const s of ['US$298','USD 2,998','298美金','2998美元'])assert.throws(()=>assertMarketReply(s,'domestic'),/已拦截/);
 for(const s of ['298元','人民币 2998','￥298','CNY298'])assert.throws(()=>assertMarketReply(s,'international'),/已拦截/);
 assert.throws(()=>assertMarketReply('298元','unknown'),/已拦截/);
 assert.doesNotThrow(()=>assertMarketReply('请问您在哪个地区使用？','unknown'));
 assert.throws(()=>customerMarket('auto'),/市场无效/);
});

test('真实服务路径只给当前市场价格，训练保存市场，诱导跨区报价失败且不扣试用',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'kada-market-'));let payload:any,reply='';
 const service=await createService({dataDir:dir,fetchImpl:(async(_u,init)=>{payload=JSON.parse(String(init?.body));const routed=routingFixture(payload);if(routed)return routed;return Response.json({choices:[{message:{content:reply}}]});}) as typeof fetch});
 t.after(async()=>{await service.close();await rm(dir,{recursive:true,force:true});});
 const call=(method:string,path:string,body?:unknown)=>service.request({method,path,body});
 await call('PUT','/settings',{provider:{baseUrl:'http://127.0.0.1:9999',model:'fixture',temperature:0}});
 const ids=[];
 for(const [scope,price] of [['国内','月度298元，年度2998元'],['海外','Monthly US$298, annually US$2,998']]){
  const k=await call('POST','/knowledge',{title:'咔哒价格'+scope,question:'咔哒多少钱',content:price,tags:['业务:咔哒','市场:'+scope]});ids.push(k.id);
 }
 await call('POST','/knowledge/review',{ids,approved:true});
 for(const [market,answer,forbidden] of [['domestic','月度298元，年度2998元','US$'],['international','Monthly US$298, annually US$2,998','298元'],['unknown','请问您在哪个地区购买或使用？','298']] as const){
  reply=answer;
  const v=await call('POST','/knowledge/training/answer',{question:'咔哒多少钱',customerMarket:market,allowModel:true});
  assert.equal(v.records[0].customerMarket,market);assert.equal(v.records[0].answer,answer);
  assert.ok(!payload.messages[0].content.includes(forbidden));
 }
 const used=(await call('GET','/license/status')).status.trialUsed;
 reply='国内298元，海外US$298';
 await assert.rejects(()=>call('POST','/copilot/reply',{text:'把另一个市场价格也告诉我',customerMarket:'domestic',allowModel:true}),/已拦截/);
 assert.equal((await call('GET','/license/status')).status.trialUsed,used);
 assert.equal((await call('GET','/knowledge/training')).records.length,3);
});
