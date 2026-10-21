import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMomentsOperations } from './moments-campaign.ts';
import { isAllowedRequest } from '../desktop/guards.ts';

type T = Awaited<ReturnType<typeof createMomentsOperations>>;
const call = (s: T, method:string,path:string,body:Record<string,unknown>={})=>s.handle(method,path,body) as Promise<any>;
const account = (s:T,name:string,device='phone',deviceLabel='iPhone')=>
  call(s,'POST','/moments/accounts',{name,device,deviceLabel,ownedOrAuthorized:true});
const pic = 'data:image/png;base64,'+Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]).toString('base64');
test('six-plus accounts across Windows, Mac and phones create one isolated, restart-safe job per account',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'moments-six-'));
 try {
  const s=await createMomentsOperations(dir);
  const entries=Array.from({length:8},(_,i)=>({name:'测试账号'+i,platform:i%3===0?'Instagram':i%3===1?'X':'Facebook',device:i%3===0?'windows':i%3===1?'mac':'phone',deviceLabel:'设备'+i}));
  await assert.rejects(call(s,'POST','/moments/accounts/batch',{accounts:entries}),/授权/);
  await assert.rejects(call(s,'POST','/moments/accounts/batch',{accounts:[entries[0],entries[0]],ownedOrAuthorized:true}),/重复/);
  const result=await call(s,'POST','/moments/accounts/batch',{accounts:entries,ownedOrAuthorized:true});
  assert.equal(result.added,8);
  assert.equal(result.accounts[0].platform,'Instagram');
  assert.equal(result.accounts[1].platform,'X');
  assert.equal(result.accounts[2].platform,'Facebook');
  const a=await call(s,'POST','/moments/assets',{name:'测试图.png',dataUrl:pic});
  assert.equal(a.mime,'image/png');
  assert.equal((await call(s,'GET','/moments/assets/'+a.id)).dataUrl,pic);
  const repeat=await call(s,'POST','/moments/assets',{name:'重复.png',dataUrl:pic});
  assert.equal(repeat.id,a.id);
  const c=await call(s,'POST','/moments/content',{title:'图文发布实验',text:'今天分享一个真实进展',assetIds:[a.id]});
  const campaign=await call(s,'POST','/moments/campaigns',{contentId:c.id,accountIds:result.accounts.map((x:any)=>x.id)});
  assert.equal(campaign.accountIds.length,8);
  const v=await call(s,'GET','/moments');
  assert.equal(v.jobs.length,8);
  assert.equal(v.jobs[0].accountPlatform,'Instagram');
  assert.equal(v.jobs[1].accountPlatform,'X');
  assert.equal(v.jobs[2].accountPlatform,'Facebook');
  assert.equal(v.stats.pending,8);
  await assert.rejects(call(s,'POST','/moments/campaigns',{contentId:c.id,accountIds:[result.accounts[0].id]}),/重复/);
  const first=v.jobs[0],second=v.jobs[1];
  await call(s,'PUT','/moments/jobs/'+first.id,{expectedFingerprint:first.fingerprint,text:'只在第一个账号发表',visibility:'仅三天可见'});
  const changed=(await call(s,'GET','/moments')).jobs;
  assert.equal(changed.find((j:any)=>j.id===second.id).text,'今天分享一个真实进展');
  const first2=changed.find((j:any)=>j.id===first.id);
  assert.notEqual(first.fingerprint,first2.fingerprint);
  assert.equal(first2.status,'review');
  await assert.rejects(call(s,'POST','/moments/jobs/'+first.id+'/approve',{confirmed:true,expectedFingerprint:first.fingerprint}),/核对/);
  await call(s,'POST','/moments/jobs/'+first.id+'/approve',{confirmed:true,expectedFingerprint:first2.fingerprint});
  await assert.rejects(call(s,'POST','/moments/jobs/'+first.id+'/handoff',{accountId:second.accountId,identityConfirmed:true,expectedFingerprint:first2.fingerprint}),/目标账号/);
  await call(s,'POST','/moments/jobs/'+first.id+'/handoff',{accountId:first.accountId,identityConfirmed:true,expectedFingerprint:first2.fingerprint});
  await assert.rejects(call(s,'POST','/moments/jobs/'+first.id+'/handoff',{accountId:first.accountId,identityConfirmed:true,expectedFingerprint:first2.fingerprint}),/重复/);
  await assert.rejects(call(s,'POST','/moments/jobs/'+first.id+'/verify',{accountId:first.accountId,timelineConfirmed:true,expectedFingerprint:first2.fingerprint}),/已人工报告/);
  await call(s,'POST','/moments/jobs/'+first.id+'/report',{accountId:first.accountId,operatorConfirmed:true,outcome:'reported'});
  await assert.rejects(call(s,'POST','/moments/jobs/'+first.id+'/verify',{accountId:second.accountId,timelineConfirmed:true,expectedFingerprint:first2.fingerprint}),/核对目标账号/);
  await call(s,'POST','/moments/jobs/'+first.id+'/verify',{accountId:first.accountId,timelineConfirmed:true,expectedFingerprint:first2.fingerprint});
  assert.equal((await call(s,'GET','/moments')).jobs.find((j:any)=>j.id===first.id).status,'verified');
  await call(s,'PUT','/moments/accounts/'+first.accountId,{name:'新备注但历史不应串号',ownedOrAuthorized:true});
  const immutableJob=(await call(s,'GET','/moments')).jobs.find((j:any)=>j.id===first.id);
  assert.equal(immutableJob.accountName,'测试账号0');
  assert.equal(immutableJob.accountPlatform,'Instagram');
  assert.equal(immutableJob.contentTitle,'图文发布实验');
  assert.equal(immutableJob.status,'verified');
  const reopened=await createMomentsOperations(dir);
  const state=await call(reopened,'GET','/moments');
  assert.equal(state.accounts.length,8);
  assert.equal(state.assets.length,1);
  assert.equal(state.jobs.length,8);
  assert.equal(state.jobs.find((j:any)=>j.id===first.id).status,'verified');
  assert.equal(state.provider.autoPublishEnabled,false);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('unknown outcome blocks duplicate send; account/content changes invalidate only pending jobs',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'moments-safe-'));
 try {
  const s=await createMomentsOperations(dir);
  const a=await account(s,'个人号','windows','电脑一');
  const b=await account(s,'业务号','mac','电脑二');
  const c=await call(s,'POST','/moments/content',{title:'产品介绍',text:'介绍已确认的产品事实',assetIds:[]});
  await call(s,'POST','/moments/campaigns',{contentId:c.id,accountIds:[a.id,b.id]});
  const jobs=(await call(s,'GET','/moments')).jobs;
  const j=jobs.find((x:any)=>x.accountId===a.id);
  const other=jobs.find((x:any)=>x.accountId===b.id);
  await call(s,'POST','/moments/jobs/'+j.id+'/approve',{confirmed:true,expectedFingerprint:j.fingerprint});
  await call(s,'POST','/moments/jobs/'+j.id+'/handoff',{accountId:a.id,identityConfirmed:true,expectedFingerprint:j.fingerprint});
  await call(s,'POST','/moments/jobs/'+j.id+'/report',{accountId:a.id,operatorConfirmed:true,outcome:'unknown'});
  await assert.rejects(call(s,'POST','/moments/jobs/'+j.id+'/approve',{confirmed:true,expectedFingerprint:j.fingerprint}),/审核/);
  await assert.rejects(call(s,'POST','/moments/jobs/'+j.id+'/resolve-unknown',{accountId:a.id}),/核实/);
  await assert.rejects(call(s,'POST','/moments/campaigns',{contentId:c.id,accountIds:[a.id]}),/重复/);
  await call(s,'POST','/moments/jobs/'+j.id+'/resolve-unknown',{accountId:a.id,confirmedNotPublished:true});
  assert.equal((await call(s,'GET','/moments')).jobs.find((x:any)=>x.id===j.id).status,'review');
  await call(s,'PUT','/moments/accounts/'+b.id,{enabled:false,ownedOrAuthorized:true});
  assert.equal((await call(s,'GET','/moments')).jobs.find((x:any)=>x.id===other.id).status,'stale');
  await assert.rejects(call(s,'POST','/moments/jobs/'+other.id+'/approve',{confirmed:true,expectedFingerprint:other.fingerprint}),/变化|只能审核/);
  await call(s,'PUT','/moments/content/'+c.id,{expectedVersion:1,title:'更正版本',assetIds:[]});
  assert.equal((await call(s,'GET','/moments')).jobs.find((x:any)=>x.id===j.id).status,'stale');
  await assert.rejects(call(s,'PUT','/moments/content/'+c.id,{expectedVersion:1,title:'旧版本'}),/版本/);
  await call(s,'POST','/moments/campaigns',{contentId:c.id,accountIds:[a.id]});
  assert.equal((await call(s,'GET','/moments')).jobs.filter((x:any)=>x.accountId===a.id).length,2);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('bad images, credentials and unauthorized methods fail closed; desktop allowlist covers only documented methods',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'moments-guards-'));
 try {
  const s=await createMomentsOperations(dir);
  await assert.rejects(account(s,'no-authorization','phone',''),/不能为空/);
  await assert.rejects(call(s,'POST','/moments/accounts',{name:'no-consent',device:'phone',deviceLabel:'phone'}),/授权/);
  await assert.rejects(call(s,'POST','/moments/assets',{name:'bad.svg',dataUrl:'data:image/svg+xml;base64,AA=='}),/仅支持/);
  await assert.rejects(call(s,'POST','/moments/assets',{name:'fake.png',dataUrl:'data:image/png;base64,SGVsbG8='}),/格式/);
  await assert.rejects(call(s,'POST','/moments/assets',{name:'wrong.png',dataUrl:'data:image/png;base64,***'}),/仅支持/);
  await assert.rejects(call(s,'POST','/moments/content',{title:'test',text:'valid',assetIds:['../../etc/passwd']}),/引用/);
  assert.equal(isAllowedRequest({method:'GET',path:'/moments'}),true);
  assert.equal(isAllowedRequest({method:'POST',path:'/moments/accounts/batch'}),true);
  assert.equal(isAllowedRequest({method:'POST',path:'/moments/jobs/x/approve'}),true);
  assert.equal(isAllowedRequest({method:'GET',path:'/moments/assets/1234-aaaa'}),true);
  assert.equal(isAllowedRequest({method:'POST',path:'/moments/publish-all'}),false);
  assert.equal(isAllowedRequest({method:'POST',path:'/moments/send'}),false);
  assert.equal(isAllowedRequest({method:'POST',path:'/moments/accounts/secret/export'}),false);
  assert.equal(isAllowedRequest({method:'GET',path:'/moments/assets/../../etc/passwd'}),false);
  await assert.rejects(call(s,'POST','/moments/publish-all',{}),/接口不存在/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
