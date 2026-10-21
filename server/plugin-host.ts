import {randomUUID} from 'node:crypto';
import {mkdir,readFile,rename,unlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {ApiError} from './autopilot.ts';

/**
 * Trusted, bundled plugin registry V0.1.
 * The allowlist is defined by source code. This is NOT a dynamic installer
 * or a sandbox for arbitrary third-party JavaScript.
 */
export type PluginDescriptor = {
  id: string; name: string; version: string; description: string;
  bundled: boolean; downloadable: boolean; permissions: string[];
  enabled: boolean; apiPrefix: string;
};
type State = { schema: 1; enabled: Record<string,boolean> };
const catalog = [{
  id:'com.kadadesk.content-ops', name:'内容运营', version:'0.1.0',
  description:'图文素材、独立账号任务、人工发布与结果核实',
  bundled:true, downloadable:false, permissions:['local-data:content-ops','file-export:user-initiated'], apiPrefix:'/moments',
}] as const;
const getDescriptor = (id:string) => catalog.find(x=>x.id===id);
export async function createPluginHost(dataDir:string) {
  await mkdir(dataDir,{recursive:true,mode:0o700});
  const path=join(dataDir,'installed-plugins-v1.json');
  let state:State;
  try {state=JSON.parse(await readFile(path,'utf8'));}
  catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;state={schema:1,enabled:{}};}
  if(!state || state.schema!==1 || typeof state.enabled!=='object' || Array.isArray(state.enabled) || state.enabled===null)
    throw new Error('工作台插件状态数据异常，已保留原文件');
  let queue:Promise<unknown>=Promise.resolve();
  const isEnabled=(id:string) => Boolean(getDescriptor(id)) && (state.enabled[id]??true)===true;
  const list=():PluginDescriptor[]=>catalog.map(v=>({...v,permissions:[...v.permissions],enabled:isEnabled(v.id)}));
  const update=(id:string,enabled:boolean)=> {
    const task=queue.then(async()=>{
      if(!getDescriptor(id))throw new ApiError(404,'插件不在工作台信任列表中');
      const next:State={schema:1,enabled:{...state.enabled,[id]:enabled}};
      const temp=path+'.'+randomUUID()+'.tmp';
      try{
        await writeFile(temp,JSON.stringify(next),{mode:0o600});
        await rename(temp,path);
        state=next;
        return list();
      }catch(e){await unlink(temp).catch(()=>{});throw e;}
    });
    queue=task.catch(()=>{});
    return task;
  };
  function handle(method:string,route:string){
    if(method==='GET'&&route==='/plugins')return list();
    const m=/^\/plugins\/(com\.kadadesk\.[a-z0-9-]+)\/(enable|disable)$/.exec(route);
    if(method==='POST'&&m)return update(m[1],m[2]==='enable');
    throw new ApiError(404,'插件管理接口不存在');
  }
  function requireEnabled(id:string){
    if(!isEnabled(id))throw new ApiError(409,'对应插件已停用。请在工作台插件管理中启用后使用');
  }
  return {list,isEnabled,requireEnabled,handle};
}
