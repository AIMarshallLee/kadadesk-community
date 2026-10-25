import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {createCloudDrives} from './cloud-drives';
import {cloudApi,driveDownloadUrl,responseBytes,fileLimit} from './cloud-drive-api';
import {driveKinds,type DriveKind} from '../shared/cloud-drives';
import {createService} from './service';
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status});
const token={access_token:'fixture-access',refresh_token:'fixture-refresh',expires_in:3600};
const config={clientId:'fixture-client',clientSecret:'fixture-secret'};
function store(initial?:string){let value=initial;return {get:async()=>value,set:async(s:string)=>{value=s;},delete:async()=>{value=undefined;}};}

test('all four providers construct official OAuth flows; PKCE, state and single-use callbacks protect native auth',async t=>{
  const calls:Array<{url:string;body:any}>=[];
  const manager=await createCloudDrives({secrets:store(),callbackPort:0,fetchImpl:(async(url,init)=>{
    const text=String(init?.body),body=text.startsWith('{')?JSON.parse(text):Object.fromEntries(new URLSearchParams(text));calls.push({url:String(url),body});return json(token);
  }) as typeof fetch});t.after(()=>manager.close());
  for(const kind of driveKinds){
    await manager.configure(kind,config);const start=await manager.start(kind),url=new URL(start.url);
    assert.equal(url.protocol,'https:');assert.equal(url.searchParams.get('client_id'),config.clientId);assert.ok(url.searchParams.get('state')!.length>=32);
    assert.ok(!url.href.includes(config.clientSecret));
    if(kind==='baidu'){assert.equal(start.manualCode,true);await manager.submitCode(start.attemptId,'fixture-code');await assert.rejects(()=>manager.submitCode(start.attemptId,'again'));}
    else{
      const redirect=url.searchParams.get('redirect_uri')!;
      const bad=await fetch(redirect+'?code=fixture-code&state=wrong');assert.equal(bad.status,400);assert.equal(manager.view().providers[kind].connected,false);
      const response=await fetch(redirect+'?'+new URLSearchParams({state:url.searchParams.get('state')!,code:'fixture-code'}));assert.equal(response.status,200);
      const fields=calls.at(-1)!.body;
      if(kind==='google'||kind==='onedrive'){assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.ok(fields.code_verifier);}
      else assert.equal(fields.code_verifier,undefined);
    }
    assert.equal(manager.view().providers[kind].connected,true);
    assert.ok(!JSON.stringify(manager.view()).includes('fixture-access'));assert.ok(!JSON.stringify(manager.view()).includes('fixture-secret'));
    await manager.disconnect(kind);assert.equal(manager.view().providers[kind].connected,false);
  }
  assert.equal(calls.length,4);
});

test('denial, cancellation and changed configuration never restore old authorization',async t=>{
  let release:((value:Response)=>void)|undefined;
  const manager=await createCloudDrives({callbackPort:0,fetchImpl:(async()=>await new Promise<Response>(r=>release=r)) as typeof fetch});t.after(()=>manager.close());
  await manager.configure('google',config);const first=await manager.start('google'),url=new URL(first.url);
  const denied=await fetch(url.searchParams.get('redirect_uri')!+'?'+new URLSearchParams({state:url.searchParams.get('state')!,error:'access_denied'}));assert.equal(denied.status,200);assert.equal(manager.view().providers.google.auth,'error');
  await manager.configure('baidu',config);const start=await manager.start('baidu');
  const pending=manager.submitCode(start.attemptId,'fixture-code');await new Promise(r=>setTimeout(r,0));
  await manager.disconnect('baidu');release!(json(token));await assert.rejects(()=>pending,/改变/);assert.equal(manager.view().providers.baidu.connected,false);
});

test('four adapters list directories and obtain only selected document bytes, including Google export',async()=>{
  for(const kind of driveKinds){
    const calls:string[]=[];const api=cloudApi(kind,'fixture-access',(async(url,init)=>{
      const u=new URL(String(url));calls.push(u.href);assert.ok(!u.hostname.includes('evil'));
      if(kind==='baidu')return json(u.searchParams.get('method')==='list'?{errno:0,list:[{fs_id:7,server_filename:'FAQ.txt',size:30,isdir:0}]}:{errno:0,list:[{fs_id:7,filename:'FAQ.txt',size:30,isdir:0,dlink:'https://d.pcs.baidu.com/file?sign=fixture'}]});
      if(kind==='alipan'){
        const body=JSON.parse(String(init?.body));if(u.pathname.endsWith('getDriveInfo'))return json({backup_drive_id:'drive1'});
        assert.equal(body.drive_id,'drive1');
        if(u.pathname.endsWith('/list'))return json({items:[{file_id:'id1',name:'FAQ.txt',size:30,type:'file'}]});
        return json(u.pathname.endsWith('/get')?{file_id:'id1',name:'FAQ.txt',size:30,type:'file'}:{url:'https://file.oss-cn-beijing.aliyuncs.com/faq?sign=fixture'});
      }
      if(kind==='google'){
        if(u.pathname.endsWith('/export')){assert.match(u.searchParams.get('mimeType')!,/wordprocessingml/);assert.equal(init?.redirect,'error');return new Response('fixture office bytes');}
        const item={id:'id1',name:'FAQ',mimeType:'application/vnd.google-apps.document'};return json(u.pathname.endsWith('/files')?{files:[item]}:item);
      }
      const item={id:'id1',name:'FAQ.txt',size:30,file:{},'@microsoft.graph.downloadUrl':'https://files.1drv.com/file?auth=fixture'};
      return json(u.pathname.endsWith('/children')?{value:[item]}:item);
    }) as typeof fetch);
    const roots=await api.list();const page=kind==='alipan'?await api.list(roots.files[0].ref):roots;
    let downloads=0;const file=await api.read(page.files[0].ref,async(k,url)=>{downloads++;assert.equal(k,kind);if(kind==='baidu')assert.match(url,/access_token=fixture-access/);return Buffer.from('产品服务说明');});
    assert.ok(file.base64);assert.equal(file.name,kind==='google'?'FAQ.docx':'FAQ.txt');assert.equal(downloads,kind==='google'?0:1);assert.ok(calls.length>=2);
  }
});

test('download destinations, size limits, unsupported files and unsafe pagination fail closed',async()=>{
  for(const kind of driveKinds)for(const url of ['http://pan.baidu.com/file','https://127.0.0.1/file','https://user:pass@pan.baidu.com/a','https://alipan.com.evil.test/file'])assert.throws(()=>driveDownloadUrl(kind,url));
  await assert.rejects(()=>responseBytes(new Response('abc',{headers:{'content-length':String(fileLimit+1)}}),fileLimit),/大小/);
  const denied=cloudApi('google','fixture',(async()=>json({error:{message:'private-token-should-not-echo'}},403)) as typeof fetch);
  await assert.rejects(()=>denied.list(),e=>e instanceof Error&&!e.message.includes('private-token')&&e.message.includes('权限'));
  const one=cloudApi('onedrive','fixture',(async()=>json({value:[]})) as typeof fetch);
  await assert.rejects(()=>one.list({id:'root'},'https://evil.test/next'),/分页/);
  await assert.rejects(()=>one.list({id:'root'},'https://graph.microsoft.com/v1.0/me/messages'),/分页/);
  const unsupported=cloudApi('google','fixture',(async()=>json({id:'file',name:'large.pdf',size:fileLimit+1})) as typeof fetch);
  await assert.rejects(()=>unsupported.read({id:'file'}),/8MB/);
});

test('refresh is serialized and file selections cannot cross accounts or survive disconnect',async t=>{
  const data=store(JSON.stringify({google:{config,session:{access:'old-access',refresh:'fixture-refresh',expires:0,accountId:'account-a'}}}));let refreshes=0;
  const manager=await createCloudDrives({secrets:data,fetchImpl:(async(url)=>{
    if(String(url).includes('/token')){refreshes++;await new Promise(r=>setTimeout(r,5));return json(token);}
    return json({files:[{id:'f',name:'FAQ.txt',size:50}]});
  }) as typeof fetch});t.after(()=>manager.close());
  const pages=await Promise.all([manager.list('google'),manager.list('google')]);assert.equal(refreshes,1);
  const refs=manager.references('google',[pages[0].entries[0].handle]);assert.ok(refs[0].location.includes('account-a'));
  assert.throws(()=>manager.references('baidu',[pages[0].entries[0].handle]),/过期/);
  await manager.disconnect('google');assert.throws(()=>manager.references('google',[pages[0].entries[0].handle]),/过期/);
  await assert.rejects(()=>manager.read('google',refs[0].location),/授权/);
});

test('service imports selected remote file as pending knowledge, persists sources, deduplicates and excludes tokens from export',async t=>{
  const root=resolve(tmpdir()),dir=await mkdtemp(join(root,'kada-drive-test-'));
  const secrets=store(JSON.stringify({google:{config,session:{access:'private-fixture-access',refresh:'private-fixture-refresh',expires:Date.now()+3600000,accountId:'account-a'}}}));
  const fetchImpl=(async(url)=>{
    const u=new URL(String(url));if(u.searchParams.get('alt')==='media')return new Response('产品甲服务时间：周一至周五。\n客服电话：由企业管理员提供。');
    return json(u.pathname.endsWith('/files')?{files:[{id:'f1',name:'FAQ.txt',size:80},{id:'f2',name:'not-selected.txt',size:80}]}:{id:'f1',name:'FAQ.txt',size:80});
  }) as typeof fetch;
  const service=await createService({dataDir:dir,driveSecrets:secrets,fetchImpl});t.after(async()=>{await service.close();assert.equal(dirname(dir),root);await rm(dir,{recursive:true,force:true});});
  // 自主进化 off: this test is about the manual review gate.
  await service.request({method:'PUT',path:'/knowledge/settings',body:{autoEnableKnowledge:false}});
  const page=await service.request({method:'POST',path:'/knowledge/drives/list',body:{kind:'google'}});
  const added=await service.request({method:'POST',path:'/knowledge/drives/sources',body:{kind:'google',handles:[page.entries[0].handle]}});assert.equal(added.ids.length,1);
  const synced=await service.request({method:'POST',path:'/knowledge/sources/sync',body:{ids:added.ids,confirm:true}});assert.equal(synced.sources[0].status,'ready');
  const state=await service.request({method:'GET',path:'/state'}),imported=state.knowledge.filter((k:any)=>k.importId===added.ids[0]);assert.ok(imported.length);assert.ok(imported.every((k:any)=>k.enabled===false&&k.reviewStatus==='pending'));
  const repeat=await service.request({method:'POST',path:'/knowledge/sources/sync',body:{ids:added.ids,confirm:true}});assert.match(repeat.sources[0].detail,/没有变化/);
  for(const output of [JSON.stringify(await service.request({method:'GET',path:'/export'})),await readFile(join(dir,'flowdesk-state.json'),'utf8'),await readFile(join(dir,'knowledge-sources.json'),'utf8')])assert.ok(!output.includes('private-fixture'));
  await service.request({method:'DELETE',path:'/knowledge/drives',body:{kind:'google'}});
  const disconnected=await service.request({method:'POST',path:'/knowledge/sources/sync',body:{ids:added.ids,confirm:true}});assert.equal(disconnected.sources[0].status,'error');
});
