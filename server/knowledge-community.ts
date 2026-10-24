import {randomUUID} from 'node:crypto';
import {mkdir,readFile,rename,unlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {ApiError} from './autopilot.ts';
import {normalizeKnowledgeQuery} from './knowledge-query.ts';

type Approval='pending'|'approved';
export type KnowledgeEntry={
  id:string;title:string;content:string;tags:string[];
  reviewStatus:Approval;enabled:boolean;createdAt:string;updatedAt:string;
};
type State={schema:1;entries:KnowledgeEntry[]};
const isRecord=(v:unknown):v is Record<string,unknown>=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v);
const timestamp=()=>new Date().toISOString();
const clean=(v:unknown,label:string,max:number)=>{
 if(typeof v!=='string'||!v.trim()||v.length>max)throw new ApiError(400,label+'不能为空或超过长度限制');
 return v.trim();
};
function validateState(x:unknown):asserts x is State{
 if(!isRecord(x)||x.schema!==1||!Array.isArray(x.entries)||x.entries.length>5000)throw Error('知识库数据损坏：请备份后修复，未覆盖原始文件');
 for(const d of x.entries)if(!isRecord(d)||typeof d.id!=='string'||typeof d.title!=='string'||
   typeof d.content!=='string'||!Array.isArray(d.tags)||!['pending','approved'].includes(String(d.reviewStatus))||
   typeof d.enabled!=='boolean')throw Error('知识库条目存在不合法字段，未覆盖原文件');
}
export async function createCommunityKnowledge(dataDir:string){
 await mkdir(dataDir,{recursive:true,mode:0o700});
 const filename=join(dataDir,'knowledge-community-v1.json');
 let state:State;
 try{state=JSON.parse(await readFile(filename,'utf8')) as State;}
 catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;state={schema:1,entries:[]};}
 validateState(state);
 let serial:Promise<unknown>=Promise.resolve();
 function mutate<T>(fn:(next:State)=>T):Promise<T>{
  const job=serial.then(async()=>{
    const next=structuredClone(state);
    const output=fn(next);
    const temp=filename+'.'+randomUUID()+'.tmp';
    try{
      await writeFile(temp,JSON.stringify(next,null,2),{mode:0o600,flag:'wx'});
      await rename(temp,filename);
      state=next;
      return output;
    }catch(e){await unlink(temp).catch(()=>{});throw e;}
  });
  serial=job.catch(()=>{});
  return job;
 }
 function snapshot(){return {entries:structuredClone(state.entries),count:state.entries.length,approved:state.entries.filter(x=>x.reviewStatus==='approved'&&x.enabled).length,automaticExternalSend:false};}
 function search(query:string,limit=12){
  const q=normalizeKnowledgeQuery(query).slice(0,500);
  if(!q)return [];
  const terms=q.split(/\s+/).filter(Boolean);
  return state.entries.filter(x=>x.enabled&&x.reviewStatus==='approved').map(entry=>{
    const title=normalizeKnowledgeQuery(entry.title);
    const content=normalizeKnowledgeQuery(entry.content);
    const tags=normalizeKnowledgeQuery(entry.tags.join(' '));
    const score=(title.includes(q)?10:0)+(content.includes(q)?5:0)+(tags.includes(q)?3:0)+
      terms.reduce((sum,t)=>sum+(title.includes(t)?3:0)+(content.includes(t)?1:0),0);
    return {id:entry.id,title:entry.title,tags:entry.tags,excerpt:entry.content.slice(0,300),score};
  }).filter(v=>v.score>0).sort((a,b)=>b.score-a.score).slice(0,limit);
 }
 async function handle(method:string,route:string,body:Record<string,unknown>={}):Promise<unknown>{
  if(method==='GET'&&route==='/knowledge')return snapshot();
  if(method==='POST'&&route==='/knowledge'){
    const title=clean(body.title,'标题',200),content=clean(body.content,'正文',20000);
    if(body.tags!==undefined&&(!Array.isArray(body.tags)||body.tags.length>20||body.tags.some(t=>typeof t!=='string'||t.length>60)))
      throw new ApiError(400,'标签无效');
    const tags=[...new Set(((body.tags??[]) as string[]).map(t=>t.trim()).filter(Boolean))];
    return mutate(next=>{
      const t=timestamp();const entry:KnowledgeEntry={id:randomUUID(),title,content,tags,reviewStatus:'pending',enabled:false,createdAt:t,updatedAt:t};
      next.entries.unshift(entry);return structuredClone(entry);
    });
  }
  if(method==='POST'&&route==='/knowledge/search'){
    const query=clean(body.query,'查询',500);
    const limit=body.limit===undefined?12:body.limit;
    if(!Number.isInteger(limit)||Number(limit)<1||Number(limit)>30)throw new ApiError(400,'查询条数必须为1至30');
    return {query,hits:search(query,Number(limit)),verifiedSourcesOnly:true};
  }
  const matched=/^\/knowledge\/([a-f0-9-]{36})\/(approve|disable|enable|delete)$/.exec(route);
  if(method==='POST'&&matched){
    const [,id,action]=matched;
    if(action==='delete'&&body.confirm!==true)throw new ApiError(400,'删除知识需要明确确认');
    return mutate(next=>{
      const idx=next.entries.findIndex(x=>x.id===id);
      if(idx<0)throw new ApiError(404,'知识条目不存在');
      if(action==='delete'){const [deleted]=next.entries.splice(idx,1);return {deletedId:deleted.id};}
      const d=next.entries[idx];
      if(action==='approve'){d.reviewStatus='approved';d.enabled=true;}
      if(action==='disable')d.enabled=false;
      if(action==='enable'){
        if(d.reviewStatus!=='approved')throw new ApiError(409,'未审核知识不得启用');
        d.enabled=true;
      }
      d.updatedAt=timestamp();
      return structuredClone(d);
    });
  }
  throw new ApiError(404,'知识库接口不存在');
 }
 return {handle,search,snapshot};
}
