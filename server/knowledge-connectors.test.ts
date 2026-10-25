import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,dirname,resolve } from 'node:path';
import { readConnectedDocument,documentReference } from './knowledge-connectors';
import { createService } from './service';
const notion='https://www.notion.so/Service-0123456789abcdef0123456789abcdef';
const response=(value:unknown)=>new Response(JSON.stringify(value));
test('Notion follows pagination and nested text/table blocks without reading child pages',async()=>{
  const calls:string[]=[];
  const result=await readConnectedDocument('notion',{token:'fixture-token'},notion,(async(url,init)=>{
    calls.push(String(url));assert.equal(init?.redirect,'error');assert.equal((init?.headers as any).Authorization,'Bearer fixture-token');
    if(String(url).includes('/nested/'))return response({results:[{type:'table_row',table_row:{cells:[[{plain_text:'套餐'}],[{plain_text:'100元'}]]}}]});
    if(String(url).includes('start_cursor'))return response({results:[{type:'paragraph',paragraph:{rich_text:[{plain_text:'第二页'}]}},{type:'child_page',id:'private-child',has_children:true}]});
    return response({results:[{id:'nested',type:'toggle',has_children:true,toggle:{rich_text:[{plain_text:'介绍'}]}}],has_more:true,next_cursor:'next'});
  }) as typeof fetch);
  assert.equal(calls.length,3);assert.match(result.text,/介绍[\s\S]*套餐 \| 100元[\s\S]*第二页/);assert.ok(result.warnings.some(w=>w.includes('子页面')));
});
test('Feishu exchanges credentials, resolves wiki node and only reads the selected document',async()=>{
  const calls:string[]=[];
  const result=await readConnectedDocument('feishu',{appId:'fixture-app',appSecret:'fixture-secret'},'https://example.feishu.cn/wiki/Wiki123',(async(url,init)=>{
    calls.push(String(url));assert.equal(init?.redirect,'error');
    if(calls.length===1){assert.deepEqual(JSON.parse(String(init?.body)),{app_id:'fixture-app',app_secret:'fixture-secret'});return response({code:0,tenant_access_token:'fixture-tenant'});}
    assert.equal((init?.headers as any).Authorization,'Bearer fixture-tenant');
    return calls.length===2?response({code:0,data:{node:{obj_type:'docx',obj_token:'Doc123'}}}):response({code:0,data:{content:'产品A提供培训服务。'}});
  }) as typeof fetch);
  assert.match(calls[2],/Doc123\/raw_content$/);assert.equal(result.text,'产品A提供培训服务。');
});
test('private connectors reject arbitrary destinations, unknown formats and permission failures',async()=>{
  for(const url of ['https://evil.example/wiki/abc','https://a.feishu.cn.evil.example/wiki/abc','http://a.feishu.cn/wiki/abc','https://name:pass@a.feishu.cn/wiki/abc'])assert.throws(()=>documentReference('feishu',url));
  assert.throws(()=>documentReference('feishu','https://a.feishu.cn/sheets/abc'));
  await assert.rejects(()=>readConnectedDocument('notion',{token:'fixture'},notion,(async()=>new Response('do-not-echo-sensitive-error',{status:403})) as typeof fetch),/无权读取/);
  await assert.rejects(()=>readConnectedDocument('notion',{token:'fixture'},notion,(async()=>response({results:[],has_more:true,next_cursor:'same'})) as typeof fetch),/分页异常/);
});
test('connection routes protect secrets, import pending candidates, support disconnect and persist guide preference',async t=>{
  const root=resolve(tmpdir()),dir=await mkdtemp(join(root,'kada-connections-'));let encrypted:string|undefined;
  const store={get:async()=>encrypted,set:async(v:string)=>{encrypted=v;},delete:async()=>{encrypted=undefined;}};
  const service=await createService({dataDir:dir,connectorSecrets:store,fetchImpl:(async()=>response({results:[{type:'paragraph',paragraph:{rich_text:[{plain_text:'产品A服务时间为每周一至周五。'}]}}]})) as typeof fetch});
  t.after(async()=>{await service.close();assert.equal(dirname(resolve(dir)),root);await rm(dir,{recursive:true,force:true});});
  await service.request({method:'PUT',path:'/knowledge/connections',body:{kind:'notion',token:'fixture-only-secret'}});
  const status=await service.request({method:'GET',path:'/knowledge/connections'});assert.equal(status.notion,true);assert.ok(!JSON.stringify(status).includes('fixture-only-secret'));
  const preview=await service.request({method:'POST',path:'/knowledge/connections/preview',body:{kind:'notion',url:notion}});assert.ok(preview.rows.length);assert.match(preview.rows[0].content,/服务时间/);
  assert.ok(!JSON.stringify(await service.request({method:'GET',path:'/export'})).includes('fixture-only-secret'));
  assert.ok(!(await readFile(join(dir,'flowdesk-state.json'),'utf8')).includes('fixture-only-secret'));
  await service.request({method:'PUT',path:'/onboarding',body:{detailedGuide:false}});
  assert.equal(JSON.parse(await readFile(join(dir,'flowdesk-state.json'),'utf8')).preferences.detailedGuide,false);
  await service.request({method:'DELETE',path:'/knowledge/connections',body:{kind:'notion'}});
  await assert.rejects(()=>service.request({method:'POST',path:'/knowledge/connections/preview',body:{kind:'notion',url:notion}}),/保存/);
});
