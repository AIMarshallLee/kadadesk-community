import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,rm,unlink,realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve,dirname } from 'node:path';
import { createService } from './service';
import { folderDocuments,createKnowledgeSources } from './knowledge-sources';
async function temporary(t:any){const parent=resolve(tmpdir()),dir=await mkdtemp(join(parent,'kada-sources-'));t.after(async()=>{assert.equal(dirname(resolve(dir)),parent);await rm(dir,{recursive:true,force:true});});return dir;}
test('identical documents in separate sources retain independent approval and update history',async t=>{
  const dir=await temporary(t),a=join(dir,'a'),b=join(dir,'b');await mkdir(a);await mkdir(b);
  for(const folder of [a,b])await writeFile(join(folder,'price.md'),'产品A价格为298元。');
  const service=await createService({dataDir:join(dir,'state')});t.after(()=>service.close());
  await service.addKnowledgeFolder(a);const sources=(await service.addKnowledgeFolder(b)).sources;
  const sync=(ids:string[])=>service.request({method:'POST',path:'/knowledge/sources/sync',body:{ids,confirm:true}});
  await sync(sources.map(s=>s.id));let state=await service.request({method:'GET',path:'/state'});
  const own=state.knowledge.filter((k:any)=>sources.some(s=>s.id===k.importId));assert.equal(own.length,2);
  await service.request({method:'POST',path:'/knowledge/review',body:{ids:own.map((k:any)=>k.id),approved:true}});
  await writeFile(join(a,'price.md'),'产品A价格调整为399元。');await sync([sources[0].id]);
  state=await service.request({method:'GET',path:'/state'});
  assert.equal(state.knowledge.find((k:any)=>k.id===own.find((k:any)=>k.importId===sources[1].id).id).enabled,true);
  assert.equal(state.knowledge.find((k:any)=>k.id===own.find((k:any)=>k.importId===sources[0].id).id).enabled,false);
  const again=await sync([sources[1].id]);assert.match(again.sources[1].detail,/没有变化/);
});
test('empty previously imported folder retires old facts; unreadable file does not masquerade as deletion',async t=>{
  const dir=await temporary(t),docs=join(dir,'docs');await mkdir(docs);const file=join(docs,'price.md');await writeFile(file,'产品A价格为298元。');
  const service=await createService({dataDir:join(dir,'state')});t.after(()=>service.close());
  const source=(await service.addKnowledgeFolder(docs)).sources[0];
  const sync=()=>service.request({method:'POST',path:'/knowledge/sources/sync',body:{ids:[source.id],confirm:true}});
  const first=await sync();const ids=first.sources[0].knowledgeIds;
  await service.request({method:'POST',path:'/knowledge/review',body:{ids,approved:true}});
  await writeFile(file,'');const blank=await sync();assert.equal(blank.sources[0].status,'ready');assert.match(blank.sources[0].detail,/继续/);
  const unreadable=(await service.request({method:'GET',path:'/state'})).knowledge.find((k:any)=>k.id===ids[0]);assert.equal(unreadable.enabled,true);assert.ok(!unreadable.tags.includes('资料状态:待核对'));assert.ok(!unreadable.tags.includes('资料版本:已替换'));
  await unlink(file);const empty=await sync();assert.equal(empty.sources[0].status,'ready');assert.deepEqual(empty.sources[0].knowledgeIds,[]);
  assert.match(empty.sources[0].detail,/旧版本|旧知识/);
  const retired=(await service.request({method:'GET',path:'/state'})).knowledge.find((k:any)=>k.id===ids[0]);assert.equal(retired.enabled,false);assert.ok(retired.tags.includes('资料版本:已替换'));
});
test('folder source reads nested supported files while excluding hidden folders and detects limits',async t=>{
  const dir=await temporary(t);await mkdir(join(dir,'business'));await mkdir(join(dir,'.secrets'));
  await writeFile(join(dir,'business','service.md'),'产品A客服时间为工作日。');await writeFile(join(dir,'.secrets','private.txt'),'must-not-import');await writeFile(join(dir,'program.exe'),'not-doc');
  const result=await folderDocuments(dir);assert.equal(result.documents.length,1);assert.equal(result.documents[0].locator,'business/service.md');assert.ok(!JSON.stringify(result).includes('must-not-import'));
});
test('Word lock files, temp files and thumbnails are skipped without a warning',async t=>{
  const dir=await temporary(t);await writeFile(join(dir,'价格表.md'),'产品A价格为298元。');
  for(const name of ['~$价格表.docx','~WRL0001.tmp','下载中.xlsx.crdownload','Thumbs.db','desktop.ini','.DS_Store'])await writeFile(join(dir,name),'x');
  const result=await folderDocuments(dir);assert.deepEqual(result.documents.map(d=>d.locator),['价格表.md']);assert.deepEqual(result.failed,[]);assert.deepEqual(result.warnings,[]);assert.equal(result.complete,true);
});
test('an oversized or unparsable file only waits for the next round: its earlier facts stay in use, other files update',async t=>{
  const dir=await temporary(t),docs=join(dir,'docs');await mkdir(docs);
  const price=join(docs,'price.md'),hours=join(docs,'hours.md');await writeFile(price,'产品A月费为298元。');await writeFile(hours,'产品A客服工作日在线。');
  let service=await createService({dataDir:join(dir,'state')});t.after(()=>service.close());
  const source=(await service.addKnowledgeFolder(docs)).sources[0];
  const sync=()=>service.request({method:'POST',path:'/knowledge/sources/sync',body:{ids:[source.id],confirm:true}});
  const first=await sync(),ids=first.sources[0].knowledgeIds;
  await service.request({method:'POST',path:'/knowledge/review',body:{ids,approved:true}});
  await writeFile(price,Buffer.alloc(8*1024*1024+1,65));await writeFile(hours,'产品A客服周末也在线。');
  const partial=await sync();assert.equal(partial.sources[0].status,'ready');assert.match(partial.sources[0].detail,/8MB/);
  let state=await service.request({method:'GET',path:'/state'});
  const priceFact=state.knowledge.find((k:any)=>k.content==='产品A月费为298元。'),oldHours=state.knowledge.find((k:any)=>k.content==='产品A客服工作日在线。');
  assert.equal(priceFact.enabled,true);assert.equal(priceFact.reviewStatus,'approved');assert.ok(!priceFact.tags.some((t:string)=>/资料状态|资料版本/.test(t)));
  assert.equal(oldHours.enabled,false);assert.ok(oldHours.tags.includes('资料版本:已替换'),'the file that was read and changed is replaced');
  assert.ok(partial.sources[0].knowledgeIds.includes(priceFact.id));
  // Restarting the app must not pause a folder source either.
  await service.close();service=await createService({dataDir:join(dir,'state')});
  state=await service.request({method:'GET',path:'/state'});assert.equal(state.knowledge.find((k:any)=>k.id===priceFact.id).enabled,true);
  await writeFile(price,'产品A月费为298元。');const restored=await sync();assert.equal(restored.sources[0].status,'ready');
  state=await service.request({method:'GET',path:'/state'});assert.equal(state.knowledge.find((k:any)=>k.id===priceFact.id).enabled,true);
});
test('a missing folder keeps its facts in use instead of pausing the whole source',async t=>{
  const dir=await temporary(t),docs=join(dir,'docs');await mkdir(docs);await writeFile(join(docs,'price.md'),'产品A月费为298元。');
  const service=await createService({dataDir:join(dir,'state')});t.after(()=>service.close());
  const source=(await service.addKnowledgeFolder(docs)).sources[0],sync=()=>service.request({method:'POST',path:'/knowledge/sources/sync',body:{ids:[source.id],confirm:true}});
  const ids=(await sync()).sources[0].knowledgeIds;await service.request({method:'POST',path:'/knowledge/review',body:{ids,approved:true}});
  await rm(docs,{recursive:true,force:true});const failed=await sync();assert.equal(failed.sources[0].status,'error');assert.match(failed.sources[0].detail,/继续使用/);
  assert.equal((await service.request({method:'GET',path:'/state'})).knowledge.find((k:any)=>k.id===ids[0]).enabled,true);
});
test('a blank document alongside a readable one cannot silently retire old facts',async t=>{
  const dir=await temporary(t),docs=join(dir,'docs');await mkdir(docs);
  const price=join(docs,'price.md');await writeFile(price,'产品A月费为298元。');await writeFile(join(docs,'hours.md'),'产品A客服工作日在线。');
  const service=await createService({dataDir:join(dir,'state')});t.after(()=>service.close());
  const source=(await service.addKnowledgeFolder(docs)).sources[0],sync=()=>service.request({method:'POST',path:'/knowledge/sources/sync',body:{ids:[source.id],confirm:true}});
  const before=await sync();await writeFile(price,'');const partial=await sync();assert.equal(partial.sources[0].status,'ready');assert.deepEqual([...partial.sources[0].knowledgeIds].sort(),[...before.sources[0].knowledgeIds].sort());
  const state=await service.request({method:'GET',path:'/state'});assert.ok(state.knowledge.filter((k:any)=>k.importId===source.id).every((k:any)=>!k.tags.includes('资料版本:已替换')));
});
test('inserting a paragraph keeps every unchanged fact approved; only the edited paragraph waits for review',async t=>{
  const dir=await temporary(t),docs=join(dir,'docs');await mkdir(docs);const file=join(docs,'说明.md');
  await writeFile(file,'产品A价格为298元。\n\n周末不发货。\n\n支持开发票。');
  const service=await createService({dataDir:join(dir,'state')});t.after(()=>service.close());
  // 自主进化 off: this test is about the manual review gate.
  await service.request({method:'PUT',path:'/knowledge/settings',body:{autoEnableKnowledge:false}});
  const source=(await service.addKnowledgeFolder(docs)).sources[0],sync=()=>service.request({method:'POST',path:'/knowledge/sources/sync',body:{ids:[source.id],confirm:true}});
  const ids=(await sync()).sources[0].knowledgeIds;await service.request({method:'POST',path:'/knowledge/review',body:{ids,approved:true}});
  await writeFile(file,'新品B上架了。\n\n产品A价格为298元。\n\n周末不发货。\n\n支持开发普通发票和专用发票。');
  const view=await sync();const state=await service.request({method:'GET',path:'/state'});
  const by=(content:string)=>state.knowledge.find((k:any)=>k.importId===source.id&&k.content===content);
  for(const fact of ['产品A价格为298元。','周末不发货。']){const k=by(fact);assert.equal(k.enabled,true,fact);assert.equal(k.reviewStatus,'approved',fact);}
  assert.equal(by('周末不发货。').sourceLocator,'说明.md · 段落 3');
  assert.equal(by('支持开发票。').enabled,false);assert.ok(by('支持开发票。').tags.includes('资料版本:已替换'));
  assert.equal(by('新品B上架了。').reviewStatus,'pending');assert.equal(by('支持开发普通发票和专用发票。').reviewStatus,'pending');
  assert.match(view.sources[0].detail,/新增 2 条/);
});
test('source import is durable, pending, deduplicated and supersedes old facts without enabling new facts',async t=>{
  const dir=await temporary(t),docs=join(dir,'documents');await mkdir(docs);await writeFile(join(docs,'service.md'),'产品A服务时间为星期一。');
  let service=await createService({dataDir:join(dir,'state')});t.after(()=>service.close());
  // 自主进化 off: this test is about the manual review gate.
  await service.request({method:'PUT',path:'/knowledge/settings',body:{autoEnableKnowledge:false}});
  const added=await service.addKnowledgeFolder(docs),sourceId=added.sources[0].id;
  const sync=()=>service.request({method:'POST',path:'/knowledge/sources/sync',body:{ids:[sourceId],confirm:true}});
  await assert.rejects(()=>service.request({method:'POST',path:'/knowledge/sources/sync',body:{ids:[sourceId]}}),/确认/);
  let view=await sync();assert.equal(view.sources[0].status,'ready');let state=await service.request({method:'GET',path:'/state'});
  const first=state.knowledge.find((k:any)=>k.importId===sourceId);assert.equal(first.enabled,false);assert.equal(first.reviewStatus,'pending');
  await service.request({method:'POST',path:'/knowledge/review',body:{ids:[first.id],approved:true}});
  view=await sync();assert.match(view.sources[0].detail,/没有变化/);
  await writeFile(join(docs,'service.md'),'产品A服务时间改为星期二。');view=await sync();state=await service.request({method:'GET',path:'/state'});
  assert.equal(state.knowledge.find((k:any)=>k.id===first.id).enabled,false);
  assert.ok(state.knowledge.find((k:any)=>k.id===first.id).tags.includes('资料版本:已替换'));
  assert.ok(view.sources[0].knowledgeIds.every((id:string)=>state.knowledge.some((k:any)=>k.id===id&&!k.enabled&&k.reviewStatus==='pending')));
  await assert.rejects(()=>service.request({method:'PUT',path:'/knowledge/'+first.id,body:{enabled:true}}),/旧版本/);
  await service.close();service=await createService({dataDir:join(dir,'state')});
  assert.equal((await service.request({method:'GET',path:'/knowledge/sources'})).sources[0].location,await realpath(docs));
  for(const id of view.sources[0].knowledgeIds)await service.request({method:'DELETE',path:'/knowledge/'+id});
  view=await sync();assert.match(view.sources[0].detail,/新增 1/);
});
test('batch source failure does not hide other successes and stop prevents the next source',async t=>{
  const dir=await temporary(t);let calls=0,release:()=>void=()=>{};let wait=false;
  const manager=await createKnowledgeSources({dataDir:dir,read:async(source)=>{calls++;if(wait)await new Promise<void>(r=>release=r);if(source.location.includes('Bad'))throw Error('没有阅读权限');return {documents:[{input:{text:'正文'},locator:source.location}],warnings:[]};},ingest:async()=>({ids:['one'],created:1,skipped:0,warnings:[]})});
  await manager.handle('POST','/knowledge/sources',{kind:'feishu',urls:['https://a.feishu.cn/docx/Bad','https://a.feishu.cn/docx/Good']});
  const ids=manager.view().sources.map(s=>s.id);await manager.handle('POST','/knowledge/sources/sync',{ids,confirm:true});
  assert.deepEqual(manager.view().sources.map(s=>s.status),['error','ready']);
  wait=true;const running=manager.handle('POST','/knowledge/sources/sync',{ids,confirm:true});
  while(calls<3)await new Promise(r=>setTimeout(r,5));
  await assert.rejects(()=>manager.handle('POST','/knowledge/sources/sync',{ids,confirm:true}),/运行中/);
  await manager.handle('POST','/knowledge/sources/stop',{});release();await running;assert.equal(calls,3);assert.equal(manager.view().busy,false);
});
test('stop during parsing blocks the pending source commit and allows a later retry',async t=>{
  const dir=await temporary(t);let release!:()=>void,entered!:()=>void,commits=0;
  const parsing=new Promise<void>(r=>entered=r),wait=new Promise<void>(r=>release=r);
  const manager=await createKnowledgeSources({dataDir:dir,read:async()=>({documents:[{input:{text:'产品说明'},locator:'doc'}],warnings:[]}),ingest:async(_source,_docs,assertActive)=>{entered();await wait;assertActive();commits++;return {ids:['new'],created:1,skipped:0,warnings:[]};}});
  await manager.handle('POST','/knowledge/sources',{kind:'feishu',urls:['https://a.feishu.cn/docx/Good']});
  const ids=manager.view().sources.map(s=>s.id),task=manager.handle('POST','/knowledge/sources/sync',{ids,confirm:true});
  await parsing;await manager.handle('POST','/knowledge/sources/stop',{});release();await task;
  assert.equal(commits,0);assert.equal(manager.view().busy,false);assert.equal(manager.view().sources[0].status,'idle');assert.deepEqual(manager.view().sources[0].knowledgeIds,[]);
  await manager.handle('POST','/knowledge/sources/sync',{ids,confirm:true});assert.equal(commits,1);assert.equal(manager.view().sources[0].status,'ready');
});
