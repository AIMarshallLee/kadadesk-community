import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {createServer,type Server} from 'node:http';
import {cloudApi,driveJson,DriveHttpError,supportedFile,readDriveRef,type RemoteFile,type downloadDriveFile} from './cloud-drive-api';
import {driveKinds,driveKind,driveNames,driveRedirect,type DriveKind,type DrivesView,type DriveRef,type DrivePage} from '../shared/cloud-drives';
import type {ConnectorSecrets} from './knowledge-connectors';

interface Config {clientId:string;clientSecret?:string}
interface Session {access:string;refresh?:string;expires:number;accountId:string}
interface Stored {config:Config;session?:Session}
type Records=Partial<Record<DriveKind,Stored>>;
const authEndpoints={baidu:'https://openapi.baidu.com/oauth/2.0/authorize',alipan:'https://openapi.alipan.com/oauth/authorize',google:'https://accounts.google.com/o/oauth2/v2/auth',onedrive:'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'};
const tokenEndpoints={baidu:'https://openapi.baidu.com/oauth/2.0/token',alipan:'https://openapi.alipan.com/oauth/access_token',google:'https://oauth2.googleapis.com/token',onedrive:'https://login.microsoftonline.com/common/oauth2/v2.0/token'};
const scopes={baidu:'basic,netdisk',alipan:'user:base,file:all:read',google:'https://www.googleapis.com/auth/drive.readonly',onedrive:'offline_access Files.Read'};
const pkce=(kind:DriveKind)=>kind==='google'||kind==='onedrive';
export function readDriveConfig(kind:DriveKind,body:Record<string,unknown>):Config {
  if(typeof body.clientId!=='string'||!body.clientId.trim()||body.clientId.length>500||/[\s\x00-\x1f]/.test(body.clientId))throw Error('请填写网盘开放平台的应用 ID。');
  const secret=body.clientSecret;
  if(secret!==undefined&&(typeof secret!=='string'||secret.length>2000||/[\r\n]/.test(secret)))throw Error('应用密钥格式无效。');
  if((kind==='baidu'||kind==='alipan')&&(typeof secret!=='string'||!secret.trim()))throw Error('此平台还需填写应用密钥。');
  return {clientId:body.clientId.trim(),...(typeof secret==='string'&&secret.trim()?{clientSecret:secret.trim()}:{})};
}
interface Attempt {id:string;kind:DriveKind;state:string;verifier:string;config:Config;until:number;status:'waiting'|'exchanging'|'connected'|'error';message:string;redirect:string}
interface Handle {kind:DriveKind;accountId:string;until:number;file?:RemoteFile;ref?:DriveRef;cursor?:string}
export async function createCloudDrives(options:{secrets?:ConnectorSecrets;fetchImpl?:typeof fetch;download?:typeof downloadDriveFile;callbackPort?:number}={}){
  const fetchImpl=options.fetchImpl??fetch;let memory:Records={};let records:Records=options.secrets?JSON.parse(await options.secrets.get()||'{}'):memory;
  if(!records||typeof records!=='object'||Array.isArray(records))throw Error('网盘连接配置损坏。');
  let tail=Promise.resolve();let listener:Server|undefined,timer:NodeJS.Timeout|undefined,attempt:Attempt|undefined;
  const handles=new Map<string,Handle>();const refreshing=new Map<DriveKind,Promise<Session>>();
  async function mutate(fn:(next:Records)=>void){const operation=tail.then(async()=>{const next=structuredClone(records);fn(next);if(options.secrets)await options.secrets.set(JSON.stringify(next));else memory=next;records=next;});tail=operation.catch(()=>{});await operation;}
  function endListener(){if(timer)clearTimeout(timer);timer=undefined;if(listener){listener.close();listener.closeIdleConnections();listener=undefined;}}
  function cancel(kind?:DriveKind){if(attempt&&(!kind||attempt.kind===kind)){attempt=undefined;endListener();}}
  function invalidate(kind:DriveKind){for(const [id,h] of handles)if(h.kind===kind)handles.delete(id);}
  const view=():DrivesView=>({persistent:!!options.secrets,providers:Object.fromEntries(driveKinds.map(kind=>{
    const record=records[kind],a=attempt?.kind===kind?attempt:undefined;
    return [kind,{configured:!!record?.config,connected:!!record?.session,clientId:record?.config.clientId,hasSecret:!!record?.config.clientSecret,auth:a?.status??(record?.session?'connected':'idle'),message:a?.message??(record?.session?'已保存授权，请读取目录验证。':'尚未授权')}];
  })) as DrivesView['providers']});
  async function exchange(kind:DriveKind,config:Config,fields:Record<string,string>,previous?:Session):Promise<Session>{
    const body={client_id:config.clientId,...(config.clientSecret?{client_secret:config.clientSecret}:{}),...fields};
    const json=kind==='alipan';
    const result=await driveJson(fetchImpl,tokenEndpoints[kind],{method:'POST',headers:{'Content-Type':json?'application/json':'application/x-www-form-urlencoded'},body:json?JSON.stringify(body):new URLSearchParams(body).toString()});
    if(typeof result.access_token!=='string'||!result.access_token||result.access_token.length>16000||/[\r\n]/.test(result.access_token))throw Error('网盘未返回有效授权，请重新连接。');
    const seconds=Number(result.expires_in);if(!Number.isFinite(seconds)||seconds<=0)throw Error('网盘授权有效期无效。');
    const refresh=typeof result.refresh_token==='string'?result.refresh_token:previous?.refresh;
    return {access:result.access_token,refresh,expires:Date.now()+seconds*1000,accountId:previous?.accountId??randomUUID()};
  }
  async function finish(a:Attempt,code:string){
    if(attempt!==a||a.status!=='waiting'||a.until<Date.now())throw Error('授权已过期或已处理，请重新开始。');
    if(!code||code.length>4096||/[\x00-\x1f]/.test(code))throw Error('授权码格式无效。');
    a.status='exchanging';a.message='正在完成授权…';
    try{
      const session=await exchange(a.kind,a.config,{grant_type:'authorization_code',code,redirect_uri:a.redirect,...(pkce(a.kind)?{code_verifier:a.verifier}:{})});
      await mutate(next=>{if(attempt!==a||JSON.stringify(next[a.kind]?.config)!==JSON.stringify(a.config))throw Error('连接配置已改变，请重新授权。');next[a.kind]!.session=session;});
      a.status='connected';a.message='授权成功，可以读取远端目录。';invalidate(a.kind);
    }catch(e){if(attempt===a){a.status='error';a.message=e instanceof Error?e.message:'授权失败，请重试。';}throw e;}finally{if(attempt===a)endListener();}
  }
  let starting=false;
  async function start(kind:DriveKind){
    if(starting)throw Error('授权窗口正在打开，请稍候。');starting=true;
    try{return await beginAuthorization(kind);}finally{starting=false;}
  }
  async function beginAuthorization(kind:DriveKind){
    await tail;const config=records[kind]?.config;if(!config)throw Error('该网盘尚未配置应用。请先完成下方的管理员接入设置。');
    cancel();const a:Attempt={id:randomUUID(),kind,config:structuredClone(config),state:randomBytes(32).toString('hex'),verifier:randomBytes(48).toString('base64url'),until:Date.now()+10*60*1000,status:'waiting',message:'请在浏览器完成网盘授权。',redirect:kind==='baidu'?'oob':driveRedirect};attempt=a;
    if(kind!=='baidu'){
      const server=createServer(async(req,res)=>{
        res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Type','text/plain; charset=utf-8');res.setHeader('Content-Security-Policy',"default-src 'none'");
        const expectedHost='127.0.0.1:'+(server.address() as {port:number})?.port;
        const url=new URL(req.url??'/',a.redirect);
        if(req.method!=='GET'||req.headers.host!==expectedHost||url.pathname!=='/oauth/callback'||url.searchParams.getAll('state').length!==1||url.searchParams.get('state')!==a.state||attempt!==a||a.until<Date.now()) {res.writeHead(400);res.end('授权校验未通过，请返回咔哒重新连接。');return;}
        if(url.searchParams.has('error')){a.status='error';a.message='授权未完成，请重新连接。';res.end(a.message);endListener();return;}
        try{if(url.searchParams.getAll('code').length!==1)throw Error('授权码无效。');await finish(a,url.searchParams.get('code')??'');res.end('咔哒授权成功。请返回咔哒选择要导入的文件，此页面可以关闭。');}
        catch{res.writeHead(400);res.end('授权未完成。请返回咔哒查看原因并重新连接。');}
      });
      server.requestTimeout=10000;server.headersTimeout=10000;listener=server;
      try{await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(options.callbackPort??38467,'127.0.0.1',()=>resolve());});}
      catch{cancel();throw Error('本机授权端口被占用，请关闭其他咔哒实例后重试。');}
      a.redirect=`http://127.0.0.1:${(server.address() as {port:number}).port}/oauth/callback`;
      server.unref();
    }
    timer=setTimeout(()=>{if(attempt===a){a.status='error';a.message='授权等待超过 10 分钟，请重新连接。';endListener();}},10*60*1000);timer.unref();
    const url=new URL(authEndpoints[kind]);url.search=new URLSearchParams({response_type:'code',client_id:config.clientId,redirect_uri:a.redirect,scope:scopes[kind],state:a.state,...(pkce(kind)?{code_challenge:createHash('sha256').update(a.verifier).digest('base64url'),code_challenge_method:'S256'}:{}),...(kind==='google'?{access_type:'offline',prompt:'consent'}:{}),...(kind==='baidu'?{display:'page'}:{})}).toString();
    return {url:url.href,manualCode:kind==='baidu',attemptId:a.id};
  }
  async function session(kind:DriveKind,force=false):Promise<Session>{
    await tail;const stored=records[kind];if(!stored?.session)throw Error('请先授权连接'+driveNames[kind]+'。');
    if(!force&&stored.session.expires>Date.now()+60000)return structuredClone(stored.session);
    const pending=refreshing.get(kind);if(pending)return pending;
    const previous=structuredClone(stored);
    const job=(async()=>{
      if(!previous.session?.refresh)throw Error('授权已到期，请重新连接。');
      const next=await exchange(kind,previous.config,{grant_type:'refresh_token',refresh_token:previous.session.refresh},previous.session);
      await mutate(values=>{if(JSON.stringify(values[kind])!==JSON.stringify(previous))throw Error('连接已改变，请重试。');values[kind]!.session=next;});return next;
    })();refreshing.set(kind,job);try{return await job;}finally{refreshing.delete(kind);}
  }
  async function withApi<T>(kind:DriveKind,accountId:string|undefined,work:(api:ReturnType<typeof cloudApi>)=>Promise<T>):Promise<{value:T;accountId:string}>{
    let current=await session(kind);const expected=accountId??current.accountId;
    if(current.accountId!==expected)throw Error('账号已更换，请重新选择资料源。');
    let value:T;try{value=await work(cloudApi(kind,current.access,fetchImpl));}catch(e){if(!(e instanceof DriveHttpError)||e.status!==401)throw e;current=await session(kind,true);if(current.accountId!==expected)throw Error('账号已更换，请重新选择资料源。');value=await work(cloudApi(kind,current.access,fetchImpl));}
    if(records[kind]?.session?.accountId!==expected)throw Error('读取期间连接已改变，请重试。');return {value,accountId:expected};
  }
  function handle(value:Handle){for(const [id,h] of handles)if(h.until<Date.now())handles.delete(id);if(handles.size>5000)throw Error('已浏览的目录过多，请重新连接后继续。');const id=randomUUID();handles.set(id,value);return id;}
  function selected(kind:DriveKind,id:unknown){const h=typeof id==='string'?handles.get(id):undefined;if(!h||h.kind!==kind||h.until<Date.now()||records[kind]?.session?.accountId!==h.accountId)throw Error('文件列表已过期或账号改变，请刷新目录。');return h;}
  return {
    view,start,
    async configure(kind:DriveKind,body:Record<string,unknown>){const config=readDriveConfig(kind,body);cancel(kind);invalidate(kind);await mutate(next=>{next[kind]={config};});return view();},
    async disconnect(kind:DriveKind){cancel(kind);invalidate(kind);await mutate(next=>{if(next[kind])delete next[kind]!.session;});return view();},
    async forget(kind:DriveKind){cancel(kind);invalidate(kind);await mutate(next=>{delete next[kind];});return view();},
    cancel(){cancel();return view();},
    async submitCode(id:unknown,code:unknown){const a=attempt;if(!a||a.kind!=='baidu'||a.id!==id||typeof code!=='string')throw Error('授权会话已变化，请重新开始。');await finish(a,code.trim());return view();},
    async list(kind:DriveKind,folder?:unknown,page?:unknown):Promise<DrivePage>{
      let ref:DriveRef={id:'root'},cursor:string|undefined,accountId:string|undefined;
      if(page){const h=selected(kind,page);ref=h.ref!;cursor=h.cursor;accountId=h.accountId;if(!cursor||!ref)throw Error('分页无效。');}
      else if(folder){const h=selected(kind,folder);if(!h.file?.folder)throw Error('请选择目录。');ref=h.file.ref;accountId=h.accountId;}
      const result=await withApi(kind,accountId,api=>api.list(ref,cursor)),until=Date.now()+10*60*1000;
      if(result.value.next===cursor&&cursor)throw Error('网盘重复返回同一分页，请稍后重试。');
      return {entries:result.value.files.map(file=>({handle:handle({kind,accountId:result.accountId,until,file}),name:file.name,folder:file.folder,size:file.size,supported:supportedFile(file)})),...(result.value.next?{next:handle({kind,accountId:result.accountId,until,ref,cursor:result.value.next})}:{})};
    },
    references(kind:DriveKind,ids:unknown){
      if(!Array.isArray(ids)||!ids.length||ids.length>30||new Set(ids).size!==ids.length)throw Error('请选择 1–30 份文件。');
      return ids.map(id=>{const h=selected(kind,id);if(!h.file||!supportedFile(h.file))throw Error('请选择支持的文件，单份最大 8MB。');return {name:h.file.name,location:JSON.stringify({accountId:h.accountId,ref:h.file.ref})};});
    },
    async read(kind:DriveKind,location:string){
      let value:{accountId:string;ref:DriveRef};try{value=JSON.parse(location);if(typeof value.accountId!=='string')throw Error();value.ref=readDriveRef(value.ref);}catch{throw Error('资料源信息损坏，请移除后重新选择。');}
      return (await withApi(kind,value.accountId,api=>api.read(value.ref,options.download))).value;
    },
    async close(){cancel();handles.clear();await tail;},
  };
}
