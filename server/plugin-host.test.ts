import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPluginHost} from './plugin-host.ts';

test('trusted built-in plugin toggles independently and retains state across restarts',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'kada-core-plugin-'));
 try{
  let host=await createPluginHost(dir);
  assert.equal(host.list().length,2);
  const p=host.list()[0];
  assert.equal(p.id,'com.kadadesk.content-ops');
  assert.equal(host.list()[1].id,'com.kadadesk.knowledge');
  assert.equal(host.isEnabled('com.kadadesk.knowledge'),true);
  assert.equal(p.enabled,true);
  assert.equal(p.downloadable,false);
  assert.deepEqual(p.permissions,['local-data:content-ops','file-export:user-initiated']);
  await host.handle('POST','/plugins/com.kadadesk.content-ops/disable');
  assert.equal(host.isEnabled('com.kadadesk.content-ops'),false);
  assert.equal(host.isEnabled('com.kadadesk.knowledge'),true);
  assert.throws(()=>host.requireEnabled('com.kadadesk.content-ops'),/已停用/);
  await assert.rejects(host.handle('POST','/plugins/com.kadadesk.other/enable') as Promise<unknown>,/信任列表/);
  await assert.rejects(host.handle('POST','/plugins/com.kadadesk.other/disable') as Promise<unknown>,/信任列表/);
  host=await createPluginHost(dir);
  assert.equal(host.list()[0].enabled,false);
  await host.handle('POST','/plugins/com.kadadesk.content-ops/enable');
  assert.equal(host.list()[0].enabled,true);
  const copy=host.list();copy[0].permissions.push('all');
  assert.equal(host.list()[0].permissions.includes('all'),false);
 }finally{await rm(dir,{recursive:true,force:true});}
});
