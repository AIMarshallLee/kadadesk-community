import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { organizeKnowledge, parseKnowledgeOrganization, type OrganizeSource } from './knowledge-organize';
import { createService } from './service';
const sources: OrganizeSource[] = [{ rowId: '1', title: '服务说明', content: '按需求安排培训；不承诺具体收益。', tags: [], source: '业务说明.txt', sourceLocator: '段落 1' }];
const answer = (rows = sources) => ({ summary: '企业培训业务，关注需求确认。', missing: ['价格需要业务负责人提供。'], workflow: { name: '培训咨询回复', scenario: 'service', description: '培训咨询', instructions: '先确认培训需求，只依据知识回答。不承诺收益，价格未知时转人工。', greeting: '' }, rows: rows.map(r => ({ rowId: r.rowId, title: '培训服务范围', question: '培训怎么安排？', aliases: ['内训怎么做'], tags: ['培训'], scenario: 'service', content: '恶意替换原文', source: '伪造来源' })) });

test('智能整理不能替换事实与来源，补充问法后仍保留原文', () => {
 const r = parseKnowledgeOrganization(JSON.stringify(answer()), sources);
 assert.equal(r.rows[0].content, sources[0].content); assert.equal(r.rows[0].source, sources[0].source);
 assert.deepEqual(r.rows[0].aliases, ['内训怎么做']);
 const wrong = answer(); wrong.rows[0].rowId = 'fake'; assert.throws(()=>parseKnowledgeOrganization(JSON.stringify(wrong), sources), /来源/);
 assert.throws(()=>parseKnowledgeOrganization(JSON.stringify({...answer(),rows:[]}),sources),/不完整/);
});

test('模型错误、截断和过大资料均保留原文，超限不请求模型', async () => {
 let requests=0;
 const fetcher = (async()=>{requests++;return Response.json({choices:[{finish_reason:'length',message:{content:JSON.stringify(answer())}}]});}) as typeof fetch;
 const credentials={baseUrl:'https://example.com/v1',model:'test',apiKey:'test-only'};
 await assert.rejects(organizeKnowledge(sources,credentials,fetcher),/不完整/);
 await assert.rejects(organizeKnowledge(Array.from({length:21},()=>sources[0]),credentials,fetcher),/最多20条/);assert.equal(requests,1);
 await assert.rejects(organizeKnowledge(sources,credentials,(async()=>new Response('',{status:403})) as typeof fetch),/HTTP 403/);
});

test('完整资料预览、明确授权整理、提交审核、同义检索及规则保存',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'kada-knowledge-organize-'));let requests=0;
 const service=await createService({dataDir:directory,fetchImpl:(async(_url,init)=>{
   requests++;const input=JSON.parse(String(init?.body));const material=JSON.parse(input.messages[1].content);
   return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(answer(material))}}]});
 }) as typeof fetch});
 const call=(method:string,path:string,body?:unknown)=>service.request({method,path,body});
 try{
  await call('PUT','/settings',{provider:{baseUrl:'https://example.com/v1',model:'test',temperature:0,apiKey:'test-only'}});
  // 自主进化 off: this test is about the manual review gate.
  await call('PUT','/knowledge/settings',{autoEnableKnowledge:false});
  const original=await call('POST','/knowledge/import/preview',{text:sources[0].content,sourceName:'业务说明.txt'});
  await assert.rejects(call('POST','/knowledge/import/organize',{previewId:original.previewId,rowIds:['1']}),/确认/);assert.equal(requests,0);
  const p=await call('POST','/knowledge/import/organize',{previewId:original.previewId,rowIds:['1'],allowModel:true});assert.equal(requests,1);
  assert.equal(p.rows[0].content,sources[0].content);
  const rows=p.rows.map(({rowId,title,content,question,aliases,tags,scenario}:any)=>({rowId,title,content,question,aliases,tags,scenario}));
  const committed=await call('POST','/knowledge/import/commit',{previewId:p.previewId,rows,confirm:true});
  assert.equal(committed.created[0].enabled,false);
  await call('POST','/knowledge/review',{ids:committed.created.map((k:any)=>k.id),approved:true});
  const retrieved=await call('POST','/knowledge/search',{query:'内训怎么做',scenario:'service'});assert.equal(retrieved.hits[0].content,sources[0].content);
  const rule=await call('POST','/workflows',{...p.organization.workflow,enabled:true});assert.match(rule.instructions,/不承诺收益/);
 }finally{await service.close();await rm(directory,{recursive:true,force:true});}
});

test('分段长文提交后不会因重复标题被误判为答案冲突',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'kada-knowledge-chunks-'));const service=await createService({dataDir:directory});
 try{
  const p=await service.request({method:'POST',path:'/knowledge/import/preview',body:{text:'# 培训范围\n'+'培训内容。'.repeat(400)+'\n\n不承诺收益。'}});
  const rows=p.rows.map(({rowId,title,content,question,aliases,tags,scenario}:any)=>({rowId,title,content,question,aliases,tags,scenario}));
  const committed=await service.request({method:'POST',path:'/knowledge/import/commit',body:{previewId:p.previewId,rows,confirm:true}});
  const state=await service.request({method:'POST',path:'/knowledge/review',body:{ids:committed.created.map((k:any)=>k.id),approved:true}});
  assert.ok(committed.created.length>1);assert.ok(committed.created.every((k:any)=>state.knowledge.find((n:any)=>n.id===k.id).enabled));
 }finally{await service.close();await rm(directory,{recursive:true,force:true});}
});
