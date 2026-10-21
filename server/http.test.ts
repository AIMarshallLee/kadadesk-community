import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalServer } from './index.ts';
import { request } from 'node:http';

test('local-only web server serves UI and rejects unauthorized or foreign-origin requests',async()=>{
 const dataDir=await mkdtemp(join(tmpdir(),'kadadesk-web-'));
 const app=await createLocalServer({dataDir});
 try {
  const root=await fetch(app.url+'/');
  assert.equal(root.status,200);
  const page=await root.text();
  assert.match(page,/api-token/);
  const script=page.match(/src="(\/assets\/[a-zA-Z0-9_.-]+\.js)"/);
  assert.ok(script,'compiled UI script is referenced');
  const js=await fetch(app.url+script[1]);
  assert.equal(js.status,200);
  assert.match(js.headers.get('content-type')??'',/javascript/);
  const without=await fetch(app.url+'/api/moments');
  assert.equal(without.status,403);
  const wrongOrigin=await fetch(app.url+'/api/moments',{headers:{'x-kadadesk-token':app.token,Origin:'https://example.com'}});
  assert.equal(wrongOrigin.status,403);
  const withToken=await fetch(app.url+'/api/moments',{headers:{'x-kadadesk-token':app.token}});
  assert.equal(withToken.status,200);
  assert.equal((await withToken.json()).provider.autoPublishEnabled,false);
  const exploit=await fetch(app.url+'/api/moments/publish-all',{method:'POST',headers:{'x-kadadesk-token':app.token,'content-type':'application/json'},body:'{}'});
  assert.equal(exploit.status,404);
  const foreign=await fetch(app.url+'/private/read',{headers:{'x-kadadesk-token':app.token}});
  assert.equal(foreign.status,404);
  const hostStatus=await new Promise<number>((ok,bad)=>{
    const req=request({host:'127.0.0.1',port:app.port,path:'/api/moments',headers:{host:'evil.example:123','x-kadadesk-token':app.token}},res=>{
      res.resume();res.on('end',()=>ok(res.statusCode??0));
    });req.on('error',bad);req.end();
  });
  assert.equal(hostStatus,403);
 } finally{await app.close();await rm(dataDir,{recursive:true,force:true});}
});
