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
  const h={'x-kadadesk-token':app.token};
  const plugins=await fetch(app.url+'/api/plugins',{headers:h});
  assert.equal(plugins.status,200);
  const pluginList=await plugins.json();
  assert.equal(pluginList[0].id,'com.kadadesk.content-ops');
  assert.equal(pluginList[1].id,'com.kadadesk.knowledge');
  const h1=await fetch(app.url+'/api/knowledge',{headers:h});
  assert.equal(h1.status,200);
  assert.equal((await h1.json()).count,0);
  const off=await fetch(app.url+'/api/plugins/com.kadadesk.knowledge/disable',{method:'POST',headers:{...h,'content-type':'application/json'},body:'{}'});
  assert.equal(off.status,200);
  assert.equal((await fetch(app.url+'/api/knowledge',{headers:h})).status,409);
  assert.equal((await fetch(app.url+'/api/moments',{headers:h})).status,200);
  await fetch(app.url+'/api/plugins/com.kadadesk.knowledge/enable',{method:'POST',headers:{...h,'content-type':'application/json'},body:'{}'});
  assert.equal((await fetch(app.url+'/api/knowledge',{headers:h})).status,200);
  const disabled=await fetch(app.url+'/api/plugins/com.kadadesk.content-ops/disable',{method:'POST',headers:{...h,'content-type':'application/json'},body:'{}'});
  assert.equal(disabled.status,200);
  assert.equal((await fetch(app.url+'/api/moments',{headers:h})).status,409);
  assert.equal((await fetch(app.url+'/api/moments',{method:'POST',headers:{...h,'content-type':'application/json'},body:'{}'})).status,404);
  const enabled=await fetch(app.url+'/api/plugins/com.kadadesk.content-ops/enable',{method:'POST',headers:{...h,'content-type':'application/json'},body:'{}'});
  assert.equal(enabled.status,200);
  assert.equal((await fetch(app.url+'/api/moments',{headers:h})).status,200);
  assert.equal((await fetch(app.url+'/api/plugins/com.kadadesk.other/enable',{method:'POST',headers:{...h,'content-type':'application/json'},body:'{}'})).status,404);
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
