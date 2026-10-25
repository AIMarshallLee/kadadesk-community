import { randomUUID,createHash } from 'node:crypto';
import { readFile,writeFile,rename,readdir,lstat,realpath } from 'node:fs/promises';
import { join,resolve,relative,isAbsolute,parse,extname,basename } from 'node:path';
import { documentReference,connectorKind } from './knowledge-connectors';
import type { KnowledgeSource,KnowledgeSourceView } from '../shared/knowledge-sources';
import type { KnowledgeImportInput } from '../shared/knowledge';
import {driveKinds,type DriveKind} from '../shared/cloud-drives';
import { KNOWLEDGE_FILE_EXTENSIONS, ignoredDocumentName } from '../shared/knowledge-files';
export interface SourceDocument { input:KnowledgeImportInput; locator:string }
/** A file the folder listing found but could not read this time: the facts it gave before stay in use. */
export interface SourceFailure { locator:string; reason:string }
export interface SourceRead { documents:SourceDocument[]; warnings:string[]; failed?:SourceFailure[]; complete?:boolean }
const extensions=new Set<string>(KNOWLEDGE_FILE_EXTENSIONS);
/** Office lock files (~$价格表.docx), temporary downloads and OS thumbnails are never business documents. */
export { ignoredDocumentName };
/** Read only within a folder explicitly picked in the native directory dialog. */
export async function folderDocuments(root:string,allowEmpty=false):Promise<Required<SourceRead>> {
  const actual=await realpath(root);if(actual===parse(actual).root)throw Error('请选择具体业务资料文件夹，不要选择整个磁盘。');
  const documents:SourceDocument[]=[],warnings:string[]=[],failed:SourceFailure[]=[];let examined=0,total=0,complete=true;
  const skip=(locator:string,reason:string)=>{failed.push({locator,reason});warnings.push(reason+'：'+locator);};
  async function walk(directory:string,depth:number){
    // A partial listing cannot prove that previously imported facts were deleted.
    if(depth>10){complete=false;warnings.push('超过 10 层的子目录未读取。');return;}
    for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
      if(++examined>2000)throw Error('文件夹超过 2000 个项目，请选择更具体的业务子目录。');
      if(ignoredDocumentName(entry.name)||['node_modules','release','artifacts'].includes(entry.name))continue;
      const file=join(directory,entry.name),locator=relative(actual,file).replaceAll('\\','/');
      try{
        const stat=await lstat(file);if(stat.isSymbolicLink()){skip(locator,'跳过链接文件');continue;}
        const resolved=await realpath(file),rel=relative(actual,resolved);if(rel.startsWith('..')||isAbsolute(rel)){skip(locator,'跳过资料夹以外的文件');continue;}
        if(stat.isDirectory()){await walk(resolved,depth+1);continue;}
        if(!stat.isFile()||!extensions.has(extname(entry.name).toLowerCase()))continue;
        if(stat.size>8*1024*1024){skip(locator,'超过 8MB，未读取');continue;}
        if(documents.length>=100)throw Error('此文件夹有超过 100 份支持的资料，请拆成业务子目录后分别添加。');
        total+=stat.size;if(total>32*1024*1024)throw Error('单个资料源超过 32MB，请选择较小的业务子目录。');
        // Resolve and stat again around the read to reject moved/changed files.
        const bytes=await readFile(resolved),after=await lstat(resolved);
        if(after.isSymbolicLink()||after.size!==stat.size||after.mtimeMs!==stat.mtimeMs||await realpath(resolved)!==resolved){skip(locator,'文件正在被修改，下次再读');continue;}
        documents.push({input:{files:[{name:entry.name,size:bytes.length,base64:bytes.toString('base64')}]},locator});
      }catch(e){
        if(e instanceof Error&&/超过 (100|2000) |32MB/.test(e.message))throw e;
        // Locked by Word/Excel, no permission, vanished mid-read: only this file waits for the next round.
        if((e as NodeJS.ErrnoException).code==='ENOENT'){complete=false;continue;}
        if(entry.isDirectory()){complete=false;warnings.push('子文件夹暂时打不开：'+locator);continue;}
        skip(locator,'暂时打不开（可能正被其他软件占用）');
      }
    }
  }
  await walk(actual,0);
  if(!documents.length&&!failed.length&&!allowEmpty)throw Error('文件夹中没有可读取的文档；请选择含 PDF、DOCX、表格或 Markdown 的资料目录。');
  return {documents,warnings:[...new Set(warnings)].slice(0,20),failed,complete};
}
export async function createKnowledgeSources(options:{dataDir:string;canSkip?(source:KnowledgeSource):boolean;invalidate?(source:KnowledgeSource):Promise<void>;read(source:KnowledgeSource):Promise<SourceRead>;ingest(source:KnowledgeSource,documents:SourceDocument[],assertActive:()=>void,read?:{failed:SourceFailure[];complete:boolean}):Promise<{ids:string[];created:number;skipped:number;warnings:string[];kept?:number}>}) {
  const file=join(options.dataDir,'knowledge-sources.json');let sources:KnowledgeSource[]=[];let busy=false,changing=false,current:string|undefined,stopRequested=false;
  try{sources=JSON.parse(await readFile(file,'utf8'));if(!Array.isArray(sources)||sources.length>100||sources.some(s=>!s||!['folder','feishu','notion',...driveKinds].includes(s.kind)||typeof s.id!=='string'||typeof s.location!=='string'||!Array.isArray(s.knowledgeIds)))throw Error('资料源配置损坏，请恢复备份。');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  for(const source of sources)if(source.status==='reading'){source.status='error';source.detail='上次整理中断，尚未确认完成；可重新整理，重复知识会跳过。';}
  // A folder that could not be read (disk unplugged, file locked) keeps its facts in use; online documents pause until read again.
  for(const source of sources)if(source.status==='error'&&source.kind!=='folder')await options.invalidate?.(structuredClone(source));
  async function persist(){await writeFile(file+'.tmp',JSON.stringify(sources,null,2),'utf8');await rename(file+'.tmp',file);}
  const view=():KnowledgeSourceView=>({sources:structuredClone(sources),busy,current,stopRequested});
  async function change(work:()=>Promise<KnowledgeSourceView>){if(busy||changing)throw Error('资料源正在更新，请稍后再试。');changing=true;const before=structuredClone(sources);try{return await work();}catch(e){sources=before;throw e;}finally{changing=false;}}
  async function add(kind:KnowledgeSource['kind'],location:string,name:string){
    if(busy)throw Error('正在整理资料，请完成或停止后再修改资料源。');if(sources.some(s=>s.kind===kind&&s.location===location))return view();if(sources.length>=100)throw Error('最多保存 100 个资料源。');
    sources.push({id:randomUUID(),kind,location,name:name.slice(0,120),status:'idle',detail:'尚未读取',knowledgeIds:[]});await persist();return view();
  }
  return {
    view,
    addCloud:async(kind:DriveKind,files:Array<{name:string;location:string}>)=>change(async()=>{
      const unique=[...new Map(files.map(f=>[f.location,f])).values()].filter(f=>!sources.some(s=>s.kind===kind&&s.location===f.location));
      if(sources.length+unique.length>100)throw Error('最多保存 100 个资料源。');
      for(const f of unique)sources.push({id:randomUUID(),kind,location:f.location,name:f.name,status:'idle',detail:'尚未读取',knowledgeIds:[]});
      await persist();return view();
    }),
    addFolder:async(path:string)=>change(async()=>{const root=await realpath(path);if(root===parse(root).root)throw Error('请选择具体业务资料文件夹。');return add('folder',root,basename(root));}),
    async handle(method:string,path:string,body:Record<string,unknown>){
      if(path==='/knowledge/sources'&&method==='GET')return view();
      if(path==='/knowledge/sources'&&method==='POST'){
        const kind=connectorKind(body.kind);if(!Array.isArray(body.urls)||!body.urls.length||body.urls.length>30)throw Error('一次添加 1–30 个文档链接，每行一个。');
        const refs=body.urls.map(u=>documentReference(kind,u));if(busy)throw Error('正在整理，请完成后再添加。');
        return change(async()=>{if(sources.length+refs.filter(r=>!sources.some(s=>s.kind===kind&&s.location===r.url)).length>100)throw Error('最多保存 100 个资料源。');for(const ref of refs)await add(kind,ref.url,(kind==='feishu'?'飞书文档':'Notion 页面')+' · '+ref.id.slice(-8));return view();});
      }
      if(path==='/knowledge/sources'&&method==='DELETE'){
        return change(async()=>{sources=sources.filter(s=>s.id!==body.id);await persist();return view();});
      }
      if(path==='/knowledge/sources/stop'&&method==='POST'){stopRequested=true;return view();}
      if(path==='/knowledge/sources/sync'&&method==='POST'){
        if(busy||changing)throw Error('已有整理任务或资料源更新运行中。');if(body.confirm!==true)throw Error('请确认读取所选资料源并创建待审核知识。');
        if(!Array.isArray(body.ids)||!body.ids.length||body.ids.length>30||new Set(body.ids).size!==body.ids.length)throw Error('请选择 1–30 个资料源。');
        const selected=body.ids.map(id=>sources.find(s=>s.id===id));if(selected.some(s=>!s))throw Error('资料源已变化，请刷新。');
        busy=true;stopRequested=false;
        try{for(const source of selected as KnowledgeSource[]){
          if(stopRequested)break;current=source.id;source.status='reading';source.detail='正在读取和整理…';await persist();
          try{
            const result=source.kind==='folder'?await folderDocuments(source.location,!!source.signature):await options.read(structuredClone(source));
            if(stopRequested){source.status='idle';source.detail='已停止，本来源未提交；此前完成的候选保留。';await persist();break;}
            const failed=result.failed??[],complete=result.complete??true;
            const signature=createHash('sha256').update(JSON.stringify(failed.length?[result.documents,failed.map(f=>f.locator)]:result.documents)).digest('hex');
            if(signature===source.signature&&options.canSkip?.(source)!==false){source.status='ready';source.detail='内容没有变化，无需重复整理。'+result.warnings.join(' ');}
            else{
              const output=await options.ingest(structuredClone(source),result.documents,()=>{if(stopRequested)throw Error('整理已停止，本来源未提交。');},{failed,complete});
              source.knowledgeIds=output.ids;source.signature=signature;source.status='ready';
              source.detail=`新增 ${output.created} 条待审核知识，跳过 ${output.skipped} 条没变的内容。`+(output.kept?`有 ${output.kept} 条知识来自这次没读成的文件，继续照常使用。`:'')+[...new Set([...result.warnings,...output.warnings])].join(' ');
            }
            source.updatedAt=new Date().toISOString();
          }catch(e){source.status=stopRequested?'idle':'error';source.detail=stopRequested?'已停止，本来源未提交；此前完成的候选保留。':e instanceof Error?e.message:'读取失败，请重试。';if(!stopRequested&&source.kind!=='folder'){await options.invalidate?.(structuredClone(source));if(source.knowledgeIds.length)source.detail+=' 原知识记录保留，暂停参与回答；请重新整理后核对启用。';}else if(!stopRequested&&source.knowledgeIds.length)source.detail+=' 原来的知识继续使用。';}
          await persist();
        }}finally{busy=false;current=undefined;}
        return view();
      }
    },
  };
}
