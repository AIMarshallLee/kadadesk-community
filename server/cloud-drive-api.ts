import {extname} from 'node:path';
import {lookup} from 'node:dns/promises';
import {request} from 'node:https';
import {publicV4} from './knowledge-web';
import type {DriveKind,DriveRef} from '../shared/cloud-drives';
import type {KnowledgeImportFile} from '../shared/knowledge';

export const fileLimit=8*1024*1024;
const formats=new Set(['.pdf','.docx','.xlsx','.csv','.json','.txt','.md','.html','.htm']);
const exportsByMime:Record<string,{mime:string;ext:string}>={
  'application/vnd.google-apps.document':{mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',ext:'.docx'},
  'application/vnd.google-apps.spreadsheet':{mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',ext:'.xlsx'},
  'application/vnd.google-apps.presentation':{mime:'application/pdf',ext:'.pdf'},
};
export interface RemoteFile {ref:DriveRef;name:string;folder:boolean;size?:number;mime?:string}
export function supportedFile(file:RemoteFile){return !file.folder&&(file.size===undefined||file.size<=fileLimit)&&(formats.has(extname(file.name).toLowerCase())||!!exportsByMime[file.mime??'']);}
export class DriveHttpError extends Error {constructor(public status:number){super(status===401?'网盘授权已失效，请重新授权。':status===403?'没有读取权限，请检查应用权限或账号套餐。':status===404?'文件不存在或已移走，请刷新目录。':status===429?'网盘请求过于频繁，请稍后重试。':`网盘请求失败（HTTP ${status}）。`);}}
export async function responseBytes(response:Response,limit:number){
  if(!response.ok)throw new DriveHttpError(response.status);
  if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();throw Error('文件或响应超过大小限制。');}
  const reader=response.body?.getReader();if(!reader)throw Error('网盘返回空响应。');
  const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw Error('文件或响应超过大小限制。');chunks.push(value);}}
  finally{await reader.cancel().catch(()=>{});}return Buffer.concat(chunks);
}
export async function driveJson(fetchImpl:typeof fetch,url:string,init:RequestInit={}){
  let response:Response;try{response=await fetchImpl(url,{...init,redirect:'error',signal:AbortSignal.timeout(30000)});}catch{throw Error('网盘连接超时或网络不可用，请重试。');}
  const bytes=await responseBytes(response,2*1024*1024);let result:any;
  try{result=JSON.parse(bytes.toString('utf8'));}catch{throw Error('网盘返回无法识别的响应。');}
  if(!result||typeof result!=='object'||Array.isArray(result))throw Error('网盘响应格式异常。');
  if(result.error||result.code||result.errno){
    if([110,111,-6].includes(Number(result.errno))||['AccessTokenExpired','AccessTokenInvalid'].includes(result.code))throw new DriveHttpError(401);
    throw Error('网盘拒绝请求，请检查应用权限、授权状态及文件是否可用。');
  }return result;
}
const apiHosts={baidu:'https://pan.baidu.com',alipan:'https://openapi.alipan.com',google:'https://www.googleapis.com',onedrive:'https://graph.microsoft.com'};
function checkedId(value:unknown){if(typeof value!=='string'||!value||value.length>1500||/[\x00-\x1f]/.test(value))throw Error('文件标识无效，请刷新列表。');return value;}
export function readDriveRef(input:unknown):DriveRef {const r=input as DriveRef;if(!r||typeof r!=='object')throw Error('文件标识无效。');return {id:checkedId(r.id),...(r.driveId?{driveId:checkedId(r.driveId)}:{})};}
function fileName(value:unknown){if(typeof value!=='string'||!value.trim()||value.length>240||/[\\/\x00-\x1f]/.test(value)||value==='.'||value==='..')throw Error('网盘文件名无效或过长。');return value;}
function remote(kind:DriveKind,item:any,driveId?:string):RemoteFile {
  const folder=kind==='baidu'?item.isdir===1:kind==='alipan'?item.type==='folder':kind==='google'?item.mimeType==='application/vnd.google-apps.folder':!!item.folder;
  const id=kind==='baidu'?(folder?item.path:String(item.fs_id)):kind==='alipan'?item.file_id:item.id;
  const size=item.size===undefined?undefined:Number(item.size);if(size!==undefined&&(!Number.isFinite(size)||size<0))throw Error('网盘返回无效文件大小。');
  return {ref:readDriveRef({id,driveId}),name:fileName(kind==='baidu'?(item.server_filename||item.filename||item.path?.split('/').at(-1)):item.name),folder,size,mime:item.mimeType};
}
/** All API requests use fixed official origins. Pagination URLs are never accepted from the renderer. */
export function cloudApi(kind:DriveKind,token:string,fetchImpl:typeof fetch=fetch){
  const headers={Authorization:`Bearer ${token}`};
  const get=(path:string,params:Record<string,string>={})=>driveJson(fetchImpl,apiHosts[kind]+path+'?'+new URLSearchParams({...params,...(kind==='baidu'?{access_token:token}:{})}),kind==='baidu'?{}:{headers});
  const post=(path:string,body:unknown)=>driveJson(fetchImpl,apiHosts[kind]+path,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body)});
  return {
    async list(ref:DriveRef={id:'root'},cursor?:string):Promise<{files:RemoteFile[];next?:string}>{
      ref=readDriveRef(ref);if(cursor&&cursor.length>6000)throw Error('目录游标无效。');
      if(kind==='baidu'){
        const page=cursor?Number(cursor):1;if(!Number.isSafeInteger(page)||page<1||page>1000)throw Error('目录页码无效。');
        const data=await get('/rest/2.0/xpan/file',{method:'list',dir:ref.id==='root'?'/':ref.id,start:String((page-1)*100),limit:'100',order:'name',desc:'0'});
        if(!Array.isArray(data.list))throw Error('网盘目录格式异常。');return {files:data.list.map((v:any)=>remote(kind,v)),next:data.list.length===100?String(page+1):undefined};
      }
      if(kind==='alipan'){
        if(!ref.driveId){
          const info=await post('/adrive/v1.0/user/getDriveInfo',{});
          const seen=new Set<string>();const files:RemoteFile[]=[];
          for(const [id,name] of [[info.backup_drive_id,'备份盘'],[info.resource_drive_id,'资源库'],[info.default_drive_id,'默认网盘']])if(typeof id==='string'&&id&&!seen.has(id)){seen.add(id);files.push({ref:{id:'root',driveId:id},name,folder:true});}
          if(!files.length)throw Error('账号未返回可用网盘。');return {files};
        }
        const data=await post('/adrive/v1.0/openFile/list',{drive_id:ref.driveId,parent_file_id:ref.id,limit:100,marker:cursor??'',order_by:'name',order_direction:'ASC'});
        if(!Array.isArray(data.items))throw Error('网盘目录格式异常。');return {files:data.items.map((v:any)=>remote(kind,v,ref.driveId)),next:data.next_marker||undefined};
      }
      if(kind==='google'){
        if(!/^[\w-]+$/.test(ref.id))throw Error('目录标识无效。');
        const data=await get('/drive/v3/files',{q:`'${ref.id}' in parents and trashed = false`,pageSize:'100',fields:'nextPageToken,files(id,name,mimeType,size)',supportsAllDrives:'true',includeItemsFromAllDrives:'true',...(cursor?{pageToken:cursor}:{})});
        if(!Array.isArray(data.files))throw Error('网盘目录格式异常。');return {files:data.files.map((v:any)=>remote(kind,v)),next:data.nextPageToken};
      }
      const path='/v1.0/me/drive/'+(ref.id==='root'?'root':'items/'+encodeURIComponent(ref.id))+'/children';
      const data=cursor?await (async()=>{const url=new URL(cursor);if(url.origin!==apiHosts.onedrive||url.pathname!==path)throw Error('网盘分页地址无效。');return driveJson(fetchImpl,url.href,{headers});})():await get(path,{'$top':'100','$select':'id,name,size,folder,file'});
      if(!Array.isArray(data.value))throw Error('网盘目录格式异常。');return {files:data.value.map((v:any)=>remote(kind,v)),next:data['@odata.nextLink']};
    },
    async read(ref:DriveRef,download:typeof downloadDriveFile=downloadDriveFile):Promise<KnowledgeImportFile>{
      ref=readDriveRef(ref);let item:RemoteFile;let url:string|undefined;
      if(kind==='baidu'){
        if(!/^\d+$/.test(ref.id))throw Error('文件标识无效。');
        const data=await get('/rest/2.0/xpan/multimedia',{method:'filemetas',fsids:'['+ref.id+']',dlink:'1'});if(!data.list?.[0])throw Error('未找到所选文件。');
        item=remote(kind,data.list[0]);url=data.list[0].dlink;
      }else if(kind==='alipan'){
        if(!ref.driveId)throw Error('请先选择备份盘或资源库。');
        const data=await post('/adrive/v1.0/openFile/get',{drive_id:ref.driveId,file_id:ref.id});item=remote(kind,data,ref.driveId);
        if(!supportedFile(item))throw Error('此文件格式不支持，或超过 8MB。');
        url=(await post('/adrive/v1.0/openFile/getDownloadUrl',{drive_id:ref.driveId,file_id:ref.id})).url;
      }else if(kind==='google'){
        const path='/drive/v3/files/'+encodeURIComponent(ref.id);
        item=remote(kind,await get(path,{fields:'id,name,mimeType,size',supportsAllDrives:'true'}));
        if(item.ref.id!==ref.id)throw Error('网盘返回的文件与所选资料不一致，请刷新。');
        if(!supportedFile(item))throw Error('此文件格式不支持，或超过 8MB。');
        const exp=exportsByMime[item.mime??''];if(exp)item.name+=exp.ext;
        const mediaUrl=apiHosts.google+path+(exp?'/export?'+new URLSearchParams({mimeType:exp.mime}):'?alt=media&supportsAllDrives=true');
        let response:Response;try{response=await fetchImpl(mediaUrl,{headers,redirect:'error',signal:AbortSignal.timeout(45000)});}catch{throw Error('文件读取超时，请重试。');}
        const bytes=await responseBytes(response,fileLimit);return {name:item.name,size:bytes.length,base64:bytes.toString('base64')};
      }else{
        const data=await get('/v1.0/me/drive/items/'+encodeURIComponent(ref.id));item=remote(kind,data);url=data['@microsoft.graph.downloadUrl'];
      }
      if(item.ref.id!==ref.id)throw Error('网盘返回的文件与所选资料不一致，请刷新。');
      if(!supportedFile(item))throw Error('此文件格式不支持，或超过 8MB。');
      if(typeof url!=='string')throw Error('网盘未返回下载地址，请检查下载权限。');
      const target=driveDownloadUrl(kind,url);
      if(kind==='baidu')target.searchParams.set('access_token',token);
      const bytes=await download(kind,target.href);return {name:item.name,size:bytes.length,base64:bytes.toString('base64')};
    },
  };
}
/** Pre-authorized download links stay in the backend; bearer headers never go to a CDN. */
export function driveDownloadUrl(kind:DriveKind,raw:string){
  let url:URL;try{url=new URL(raw);}catch{throw Error('网盘下载地址无效。');}
  const suffixes=kind==='baidu'?['baidupcs.com','baidu.com']:kind==='alipan'?['aliyuncs.com','alipan.com','aliyundrive.com']:kind==='onedrive'?['sharepoint.com','1drv.com','storage.live.com','files.1drv.com']:['googleusercontent.com','googleapis.com'];
  if(raw.length>12000||url.protocol!=='https:'||url.username||url.password||url.port||!suffixes.some(s=>url.hostname===s||url.hostname.endsWith('.'+s)))throw Error('网盘返回的下载域名不受支持。');return url;
}
export async function downloadDriveFile(kind:DriveKind,raw:string):Promise<Buffer>{
  let url=driveDownloadUrl(kind,raw);const signal=AbortSignal.timeout(45000);
  for(let hop=0;hop<4;hop++){
    const addresses=await lookup(url.hostname,{all:true,family:4});signal.throwIfAborted();
    if(!addresses.length||addresses.some(a=>!publicV4(a.address)))throw Error('网盘下载地址没有解析到公网。');
    const result=await new Promise<{location?:string;bytes?:Buffer}>((resolve,reject)=>{
      const req=request(url,{signal,headers:{'User-Agent':kind==='baidu'?'pan.baidu.com':'kadadesk/1.0','Accept-Encoding':'identity'},lookup:((_h:unknown,opts:any,cb:any)=>opts?.all?cb(null,[addresses[0]]):cb(null,addresses[0].address,4)) as any},res=>{
        if([301,302,303,307,308].includes(res.statusCode??0)){res.destroy();resolve({location:res.headers.location});return;}
        if(res.statusCode!==200){res.destroy();reject(new DriveHttpError(res.statusCode??500));return;}
        if(Number(res.headers['content-length'])>fileLimit){res.destroy();reject(Error('文件超过 8MB。'));return;}
        const chunks:Buffer[]=[];let size=0;res.on('data',(b:Buffer)=>{size+=b.length;if(size>fileLimit)res.destroy(Error('文件超过 8MB。'));else chunks.push(b);});res.on('error',()=>reject(Error('文件下载中断或超过大小限制。')));res.on('end',()=>resolve({bytes:Buffer.concat(chunks)}));
      });req.on('error',()=>reject(Error('网盘下载失败或超时，请重试。')));req.end();
    });
    if(result.location){url=driveDownloadUrl(kind,new URL(result.location,url).href);continue;}
    if(!result.bytes?.length)throw Error('下载文件为空。');return result.bytes;
  }throw Error('网盘下载跳转过多。');
}
