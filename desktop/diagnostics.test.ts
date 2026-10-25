import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDiagnosticReport, diagnosticCode, diagnosticScope } from '../shared/diagnostics';
import { createDiagnosticLog } from './diagnostics';

test('diagnostic export allowlist excludes secrets in every untrusted field',()=>{
  const secret='PRIVATE-CANARY-DO-NOT-EXPORT';
  const report=buildDiagnosticReport({version:secret,build:secret,platform:secret,storageOk:true,entries:[{at:'2026-09-27T10:00:00Z',scope:'model',code:'AUTH',raw:secret} as never],workspace:{provider:{hasKey:true,apiKey:secret,baseUrl:secret,model:secret},knowledge:[{content:secret}],tasks:[{input:secret}]},replies:{status:secret,message:'401 '+secret,config:{inputBackend:secret,mode:secret,conversations:[{name:secret}]},events:[{at:secret,type:secret,detail:'失焦 '+secret}],jobs:[{id:secret,status:secret,detail:'超时 '+secret,reply:secret,createdAt:secret}]}});
  assert(!report.includes(secret));assert(report.includes('AUTH'));assert(report.includes('FOCUS'));assert(report.includes('TIMEOUT'));assert(report.includes('"knowledgeItems": 1'));assert(report.includes('"modelConfigured": true'));
});
test('unavailable services still produce a useful bounded report',()=>{
  const report=buildDiagnosticReport({version:'0.8.0',build:'20260927-trial.95',platform:'win32',entries:[],storageOk:false});assert(report.includes('trial.95'));assert(report.includes('"workspaceAvailable": false'));assert(report.includes('"logStorage": "unavailable"'));assert(report.length<20000);
});
test('report bounds recent histories and never exports raw error strings',()=>{
  const e={at:'2026-09-27T10:00:00Z',scope:'input' as const,code:'FOCUS' as const};const report=buildDiagnosticReport({version:'0.8.0',build:'20260927-trial.95',platform:'win32',entries:Array(500).fill(e),storageOk:true,replies:{events:Array(500).fill({at:e.at,type:'handoff',detail:'FOCUS secret'}),jobs:Array(500).fill({status:'uncertain',detail:'401 secret'})}});assert(report.length<20000);assert(!report.includes('secret'));const data=JSON.parse(report.slice(report.indexOf('{')));assert.equal(data.recentErrors.length,50);assert.equal(data.events.length,30);assert.equal(data.jobs.length,15);
});
test('error categories distinguish common customer troubleshooting failures',()=>{
  for(const [input,code] of [['HTTP 401','AUTH'],['HTTP 402','BALANCE'],['429 too many','RATE_LIMIT'],['selected window lost focus','FOCUS'],['画面未通过识别','VISION'],['USB disconnected','HARDWARE'],['保存失败','STORAGE'],['random confidential value','UNKNOWN']])assert.equal(diagnosticCode(Error(input)),code);
  assert.equal(diagnosticScope('/provider/test'),'model');assert.equal(diagnosticScope('/knowledge/import'),'knowledge');
});
test('log persists sanitized categories across restarts and drops injected extra fields',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'kada-diagnostics-'));const file=join(dir,'events.json');await writeFile(file,JSON.stringify([{at:'2026-09-27T10:00:00Z',scope:'model',code:'AUTH',secret:'NEVER'},{at:'secret',scope:'model',code:'AUTH'}]));const log=await createDiagnosticLog(file);await log.record('input','FOCUS');await log.record('bad' as never,'PRIVATE' as never);const stored=await readFile(file,'utf8');assert(!stored.includes('NEVER'));assert(!stored.includes('PRIVATE'));assert.equal((await createDiagnosticLog(file)).read().entries.length,2);
});
test('disk failures do not throw or stop reception and remain visible in report',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'kada-diagnostics-'));const blocker=join(dir,'file');await writeFile(blocker,'x');const log=await createDiagnosticLog(join(blocker,'events.json'));await log.record('model','AUTH');assert.equal(log.read().storageOk,false);assert.equal(log.read().entries.length,1);
});

test('Mac native failures retain distinct fixed categories without exporting native detail',()=>{
  const codes=['MAC_SCREEN_PERMISSION','MAC_ACCESSIBILITY_PERMISSION','MAC_SESSION_UNAVAILABLE','MAC_WINDOW_UNAVAILABLE','MAC_WINDOW_AMBIGUOUS','MAC_CAPTURE_EMPTY','MAC_ACTIVATE_FAILED','MAC_UNSUPPORTED_OPERATION','MAC_NATIVE_FAILED'];
  for(const code of codes){
    assert.equal(diagnosticCode(Error(`Error invoking remote method: ${code}: PRIVATE-MAC-DETAIL`)),code);
    assert.notEqual(diagnosticCode(`prefix_${code}: PRIVATE-MAC-DETAIL`),code);
    assert.notEqual(diagnosticCode(`${code}_SUFFIX: PRIVATE-MAC-DETAIL`),code);
  }
  assert.equal(diagnosticCode('MAC_PRIVATE_CUSTOM_CODE: PRIVATE-MAC-DETAIL'),'UNKNOWN');
  const report=buildDiagnosticReport({version:'0.8.0',build:'20260927-trial.105',platform:'darwin',storageOk:true,entries:[],replies:{events:codes.map(code=>({at:'2026-09-27T14:00:00Z',type:'handoff',detail:`${code}: PRIVATE-MAC-DETAIL`}))}});
  const parsed=JSON.parse(report.slice(report.indexOf('{')));
  assert.deepEqual(parsed.events.map((event:{code:string})=>event.code),codes);
  assert(!report.includes('PRIVATE-MAC-DETAIL'));
});

test('Mac categories persist in copyable diagnostics across restart with no raw fields',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'kada-mac-diagnostics-'));const file=join(dir,'events.json');
  const log=await createDiagnosticLog(file);
  await log.record('input',diagnosticCode('MAC_SCREEN_PERMISSION: PRIVATE-PATH'));
  await log.record('input',diagnosticCode('MAC_ACCESSIBILITY_PERMISSION: PRIVATE-PATH'));
  const restored=(await createDiagnosticLog(file)).read();
  assert.deepEqual(restored.entries.map(e=>e.code),['MAC_SCREEN_PERMISSION','MAC_ACCESSIBILITY_PERMISSION']);
  assert(!(await readFile(file,'utf8')).includes('PRIVATE-PATH'));
});

test('copyable report includes bounded current-process timings without private model fields',()=>{
 const secret='PRIVATE-TIMING-CANARY';
 const entry={at:'2026-09-27T14:40:00Z',stage:'CHAT_REPLY',elapsedMs:1234,result:'response',httpStatus:200,model:secret,prompt:secret};
 const report=buildDiagnosticReport({version:'0.8.0',build:'20260927-trial.110',platform:'win32',storageOk:true,entries:[],modelTiming:{startedAt:'2026-09-27T14:00:00Z',completedRequests:61,samples:[{...entry,stage:secret,result:secret,httpStatus:secret,elapsedMs:secret},...Array(60).fill(entry)],endpoint:secret}} as never);
 const parsed=JSON.parse(report.slice(report.indexOf('{')));
 assert.equal(parsed.modelTiming.completedRequests,61);assert.equal(parsed.modelTiming.samples.length,30);assert.equal(parsed.modelTiming.samples[0].elapsedMs,1234);
 assert.equal(parsed.modelTiming.scope,'current-process-openai-compatible-reception');assert(!report.includes(secret));assert(report.length<12000);
});

test('generic scan failure is not misreported as an explicit cancellation',()=>{
 const text='会话扫描未完成，已停止操作。请检查窗口、会话名称和校准区域后重试。';
 const report=buildDiagnosticReport({version:'0.8.0',build:'20260927-trial.113',platform:'win32',storageOk:true,entries:[],replies:{message:text,events:[{at:'2026-09-27T15:32:15.657Z',type:'handoff',detail:'PRIVATE-CONVERSATION: '+text}]}});
 const parsed=JSON.parse(report.slice(report.indexOf('{')));
 assert.equal(parsed.reception.reason,'SCAN_FAILED');assert.equal(parsed.events[0].code,'SCAN_FAILED');assert(!report.includes('PRIVATE-CONVERSATION'));
});
test('stopped outcome alone does not assert cancellation while explicit cancellation survives',()=>{
 for(const message of ['操作失败，已停止。','unknown failed operation 已停止'])assert.equal(diagnosticCode(message),'UNKNOWN');
 for(const message of ['operation cancelled','The operation was aborted','操作已取消'])assert.equal(diagnosticCode(message),'CANCELLED');
 assert.equal(diagnosticCode('selected window lost focus; action cancelled'),'FOCUS');
 assert.equal(diagnosticCode('请求超时，已停止'),'TIMEOUT');
});

test('the report carries the computer facts and a 24-hour summary, never names or message text', async () => {
  const { buildDiagnosticReport } = await import('../shared/diagnostics');
  const now = new Date('2026-10-19T04:00:00Z');
  const text = buildDiagnosticReport({ version: '0.8.14', build: '20261019-trial.139', platform: 'darwin', storageOk: true, entries: [], now,
    environment: { os: 'macOS 15.1', arch: 'arm64', locale: 'zh-CN', darkMode: true, displays: [{ width: 1512, height: 982, scale: 2, primary: true }], chatWindow: {} },
    replies: { status: 'running', config: { receptionMode: 'inbox', inputMode: 'pico-paste' }, usage: { '2026-10-19': { replies: 6, reads: 709 } },
      jobs: [{ status: 'visually_confirmed', createdAt: '2026-10-19T03:27:01.712Z', conversationName: '客户甲', input: '私密内容' }, { status: 'failed', createdAt: '2026-10-19T00:53:00.000Z', detail: '聊天窗口暂时不在前台（可能你正在用电脑），还没开始输入；稍后自动重试。' }, { status: 'failed', createdAt: '2026-10-10T00:00:00.000Z' }],
      events: [] } });
  const report = JSON.parse(text.slice(text.indexOf('{')));
  assert.deepEqual(report.environment.displays, [{ width: 1512, height: 982, scale: 2, primary: true }]);
  assert.equal(report.environment.darkMode, true); assert.equal(report.environment.os, 'macOS 15.1');
  assert.deepEqual(report.summary.last24h, { visually_confirmed: 1, failed: 1 });
  assert.equal(report.summary.today.replies, 6); assert.equal(report.summary.receptionMode, 'inbox');
  assert.ok(!text.includes('客户甲') && !text.includes('私密内容'));
});
