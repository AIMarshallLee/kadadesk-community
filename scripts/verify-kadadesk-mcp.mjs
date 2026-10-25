import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {writeFile} from 'node:fs/promises';
const [script,directory,receipt]=process.argv.slice(2);
if(!script||!directory)throw Error('script and user data directory required');
const child=spawn(process.execPath,[script,'--stdio','--data-dir',directory],{windowsHide:true,stdio:['pipe','pipe','pipe']});
const waiting=new Map();let counter=0;
const lines=createInterface({input:child.stdout});
lines.on('line',line=>{const r=JSON.parse(line);const pair=waiting.get(r.id);if(pair){clearTimeout(pair.timer);waiting.delete(r.id);pair.resolve(r);}});
function ask(method,params={}){return new Promise((resolve,reject)=>{const id=++counter;const timer=setTimeout(()=>reject(Error('MCP timeout')),20000);waiting.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});}
async function call(name,args={}){const r=await ask('tools/call',{name,arguments:args});if(r.error||r.result?.isError)throw Error(r.error?.message??r.result.content?.[0]?.text);return JSON.parse(r.result.content[0].text);}
try{
  const init=await ask('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'kadadesk-verifier',version:'1.0'}});
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  const list=await ask('tools/list');if(list.result.tools.length!==6)throw Error('Expected six tools');
  const status=await call('kadadesk_status');const targets=await call('kadadesk_targets');const stopped=await call('kadadesk_stop');const final=await call('kadadesk_status');
  const result={at:new Date().toISOString(),server:init.result.serverInfo,tools:list.result.tools.map(t=>t.name),initialStatus:status.engineStatus,application:status.application,configuredRecipientCount:status.configuredRecipients.length,windowCount:targets.length,hardwareConnected:final.hardware.connected,hardwareArmed:final.hardware.armed,stopped:stopped.stopped,busy:final.busy,realSendAttempted:false};
  if(result.busy||result.hardwareArmed||!result.stopped)throw Error('Runtime did not become idle');
  if(receipt)await writeFile(receipt,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{for(const p of waiting.values())clearTimeout(p.timer);lines.close();child.stdin.end();child.kill();}
