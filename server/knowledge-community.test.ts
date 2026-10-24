import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCommunityKnowledge} from './knowledge-community.ts';
import {waitForAbortOrTimeout} from '../sdk/abortable-delay.ts';

test('local community knowledge stores reviewed data and never searches unapproved material',async()=>{
 const aDir=await mkdtemp(join(tmpdir(),'kada-knowledge-A-'));
 const bDir=await mkdtemp(join(tmpdir(),'kada-knowledge-B-'));
 try{
  let a=await createCommunityKnowledge(aDir), b=await createCommunityKnowledge(bDir);
  const draft=await a.handle('POST','/knowledge',{title:'退换货政策',content:'七天内申请，先人工核查订单',tags:['售后']}) as {id:string};
  const search=(store:typeof a,query:string)=>store.handle('POST','/knowledge/search',{query}) as Promise<{hits:any[]}>;
  assert.equal((await search(a,'退换货')).hits.length,0);
  await assert.rejects(a.handle('POST','/knowledge/'+draft.id+'/enable'),/未审核/);
  await a.handle('POST','/knowledge/'+draft.id+'/approve');
  assert.equal((await search(a,'退换货')).hits.length,1);
  assert.equal((await search(b,'退换货')).hits.length,0);
  a=await createCommunityKnowledge(aDir);
  assert.equal((await search(a,'七天内')).hits.length,1);
  await a.handle('POST','/knowledge/'+draft.id+'/disable');
  assert.equal((await search(a,'七天内')).hits.length,0);
  await a.handle('POST','/knowledge/'+draft.id+'/enable');
  await assert.rejects(a.handle('POST','/knowledge/'+draft.id+'/delete'),/确认/);
  await a.handle('POST','/knowledge/'+draft.id+'/delete',{confirm:true});
  assert.equal((await search(a,'七天内')).hits.length,0);
  assert.equal(a.snapshot().automaticExternalSend,false);
  assert.equal(b.snapshot().count,0);
  const ctrl=new AbortController();ctrl.abort();
  await waitForAbortOrTimeout(300,ctrl.signal);
 }finally{await rm(aDir,{recursive:true,force:true});await rm(bDir,{recursive:true,force:true});}
});
