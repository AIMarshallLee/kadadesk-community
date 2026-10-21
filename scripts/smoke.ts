import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMomentsOperations } from '../server/moments-campaign.ts';
import { handoffZip, textBytes } from '../src/moments-export.ts';
import assert from 'node:assert/strict';

const tmp=await mkdtemp(join(tmpdir(),'kadadesk-community-'));
try {
 const app=await createMomentsOperations(tmp);
 const call=(method:string,path:string,body:Record<string,unknown>={})=>app.handle(method,path,body) as Promise<any>;
 const accounts=Array.from({length:8},(_,i)=>({name:'模拟账号-'+i,device:i%3===0?'windows':i%3===1?'mac':'phone',deviceLabel:'模拟设备-'+i}));
 const added=await call('POST','/moments/accounts/batch',{accounts,ownedOrAuthorized:true});
 const content=await call('POST','/moments/content',{title:'离线演示',text:'仅测试，不连接微信',assetIds:[]});
 await call('POST','/moments/campaigns',{contentId:content.id,accountIds:added.accounts.map((a:{id:string})=>a.id)});
 const state=await call('GET','/moments');
 assert.equal(state.jobs.length,8);
 assert.equal(state.provider.autoPublishEnabled,false);
 const zip=handoffZip([{name:'朋友圈文案.txt',bytes:textBytes(content.text)}]);
 assert.ok(zip.size>0);
 console.log(JSON.stringify({accounts:8,independentJobs:8,archiveBytes:zip.size,status:'PASS',actualWechatPublishing:'NOT IMPLEMENTED'},null,2));
}finally{await rm(tmp,{recursive:true,force:true});}
