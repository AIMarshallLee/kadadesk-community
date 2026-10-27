import React,{Suspense,lazy,useEffect,useState} from 'react';
import {api} from './api';

const ContentOperations=lazy(()=>import('./MomentsCenter'));
const KnowledgeCenter=lazy(()=>import('./KnowledgeCenter'));
type Plugin={
 id:string;name:string;version:string;description:string;
 bundled:boolean;downloadable:boolean;permissions:string[];enabled:boolean;
};
type Page='home'|'plugins'|'content'|'knowledge'|'workflows';
type Task={
 id:string;title:string;status:'running'|'completed'|'blocked'|'interrupted';
 createdAt:string;error?:string;
 result?:{contentId:string;sourceIds:string[];manualReviewRequired:true;automaticExternalSend:false};
};
type TaskList={tasks:Task[];automaticExternalSend:false};
const pageFor=(id:string):Page=>id==='com.kadadesk.knowledge'?'knowledge':'content';
export default function WorkspaceApp(){
 const [plugins,setPlugins]=useState<Plugin[]>([]);
 const [page,setPage]=useState<Page>('home');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [loading,setLoading]=useState(true);
 const [taskTitle,setTaskTitle]=useState('');
 const [taskQuery,setTaskQuery]=useState('');
 const [tasks,setTasks]=useState<Task[]>([]);
 const refreshTasks=async()=>{
  const state=await api<TaskList>('GET','/tasks');
  setTasks(state.tasks);
 };
 const openWorkflows=()=>{
  setPage('workflows');
  void refreshTasks().catch(e=>setError((e as Error).message));
 };
 const startWorkflow=async()=>{
  setBusy(true);setError('');
  try {
   const task=await api<Task>('POST','/tasks/knowledge-to-content',{title:taskTitle,query:taskQuery});
   await refreshTasks();
   if(task.status!=='completed')setError(task.error||'任务未完成，请查看任务记录');
  }catch(e){setError((e as Error).message);}
  finally{setBusy(false);}
 };
 const refresh=async()=>{
  const data=await api<Plugin[]>('GET','/plugins');
  setPlugins(data);setLoading(false);
 };
 useEffect(()=>{void refresh().catch(e=>{setError((e as Error).message);setLoading(false);});},[]);
 const content=plugins.find(p=>p.id==='com.kadadesk.content-ops');
 const knowledge=plugins.find(p=>p.id==='com.kadadesk.knowledge');
 const toggle=async(p:Plugin)=>{
  setBusy(true);setError('');
  try{
   await api('POST','/plugins/'+p.id+'/'+(p.enabled?'disable':'enable'),{});
   await refresh();
   if(p.enabled&&page===pageFor(p.id))setPage('plugins');
  }catch(e){setError((e as Error).message);}
  finally{setBusy(false);}
 };
 return <main className="site">
  <nav className="site-nav">
   <div><strong>咔哒 KADAdesk</strong><span style={{marginLeft:12}}>社区版 · 可扩展 AI 工作台</span></div>
   <div className="form-row">
    <button className="btn secondary" aria-pressed={page==='home'} onClick={()=>setPage('home')}>工作台</button>
    <button className="btn secondary" aria-pressed={page==='plugins'} onClick={()=>setPage('plugins')}>插件管理</button>
    <button className="btn secondary" aria-pressed={page==='workflows'} onClick={openWorkflows}>任务编排</button>
    {content?.enabled&&<button className="btn secondary" aria-pressed={page==='content'} onClick={()=>setPage('content')}>内容运营</button>}
    {knowledge?.enabled&&<button className="btn secondary" aria-pressed={page==='knowledge'} onClick={()=>setPage('knowledge')}>知识库</button>}
   </div>
  </nav>
  {error&&<p className="notice" role="alert">{error}</p>}
  {loading?<p>正在载入工作台…</p>:<>
   {page==='home'&&<section className="panel" style={{padding:24}}>
    <div className="eyebrow">KADADESK CORE / WORKSPACE</div>
    <h1>按需组合你的 AI 工作台</h1>
    <p>当前社区版包含内容运营和本地知识库两个可信内置模块，可按需启用或停用。AI 回复辅助、完整知识检索和第三方插件下载安装正在开发，不能把规划当作已实现功能。</p>
    <div className="form-row">
     <button className="btn primary" onClick={()=>setPage('plugins')}>查看内置模块</button>
     <button className="btn secondary" onClick={openWorkflows}>试用跨插件任务</button>
     {content?.enabled&&<button className="btn secondary" onClick={()=>setPage('content')}>打开内容运营</button>}
     {knowledge?.enabled&&<button className="btn secondary" onClick={()=>setPage('knowledge')}>打开知识库</button>}
    </div>
    <p className="muted" style={{marginTop:18}}>所有内容当前只在本机保存。知识库无企业级多租户权限，内容运营无第三方平台自动发布；企业部署前必须另行评估数据及商业许可。</p>
   </section>}
   {page==='plugins'&&<section className="panel" style={{padding:24}}>
    <h1>插件管理</h1>
    <p className="muted">支持可信内置模块的启停，状态在本机持久保存；目前尚不支持任意第三方插件包下载、升级和卸载。</p>
    {plugins.map(p=><article key={p.id} className="panel" style={{padding:16,marginTop:12}}>
     <h2>{p.name} <span className="muted">v{p.version}</span></h2>
     <p>{p.description}</p>
     <p className="muted">{p.id} · {p.bundled?'内置模块':'独立安装'} · {p.enabled?'已启用':'已停用'} · {p.downloadable?'支持独立下载':'暂不支持独立下载'}</p>
     <p className="muted">权限声明：{p.permissions.join('、')||'无'}</p>
     <div className="form-row">
      <button className="btn primary" disabled={busy} onClick={()=>void toggle(p)}>{p.enabled?'停用模块':'启用模块'}</button>
      {p.enabled&&<button className="btn secondary" onClick={()=>setPage(pageFor(p.id))}>打开模块</button>}
     </div>
    </article>)}
   </section>}
   {page==='workflows'&&<section className="panel" style={{padding:24}}>
    <div className="eyebrow">TRUSTED WORKFLOWS / LOCAL-ONLY</div>
    <h1>跨插件任务 · 已审核知识 → 内容草稿</h1>
    <p>使用基础知识库中已审核、已启用的材料，整理成一份待人工复核的内容草稿。当前不调用大模型、不连接外部平台、不会自动发布。</p>
    <div className="form-row">
     <label>草稿标题 <input value={taskTitle} maxLength={120} onChange={e=>setTaskTitle(e.target.value)} placeholder="例如：产品常见问题" /></label>
     <label>知识关键词 <input value={taskQuery} maxLength={500} onChange={e=>setTaskQuery(e.target.value)} placeholder="例如：售后政策" /></label>
     <button className="btn primary" disabled={busy||!taskTitle.trim()||!taskQuery.trim()} onClick={()=>void startWorkflow()}>{busy?'正在整理…':'生成待审核草稿'}</button>
    </div>
    <p className="muted">可先在知识库录入并审核测试资料。任何一个依赖插件停用后，任务将拒绝执行。</p>
    <h2>本机任务记录</h2>
    {tasks.length===0?<p className="muted">暂无任务</p>:tasks.map(t=><article className="panel" key={t.id} style={{padding:12,marginTop:8}}>
     <strong>{t.title}</strong> <span className="muted">· {t.status} · {new Date(t.createdAt).toLocaleString()}</span>
     {t.error&&<p role="alert">{t.error}</p>}
     {t.result&&<p>草稿已保存至内容运营，需人工检查后才能使用。引用知识 {t.result.sourceIds.length} 条。<button className="btn secondary" onClick={()=>setPage('content')}>查看内容运营</button></p>}
    </article>)}
   </section>}
   {page==='content'&&(content?.enabled?
    <Suspense fallback={<p>正在加载内容运营…</p>}><ContentOperations/></Suspense>
    :<section className="panel" style={{padding:24}}><h2>内容运营未启用</h2><button className="btn secondary" onClick={()=>setPage('plugins')}>前往插件管理</button></section>)}
   {page==='knowledge'&&(knowledge?.enabled?
    <Suspense fallback={<p>正在加载知识库…</p>}><KnowledgeCenter/></Suspense>
    :<section className="panel" style={{padding:24}}><h2>知识库未启用</h2><button className="btn secondary" onClick={()=>setPage('plugins')}>前往插件管理</button></section>)}
  </>}
  <footer>Community Workspace · 按需安装的第三方插件系统仍在建设 · <a href="https://github.com/AIMarshallLee/kadadesk-community" target="_blank" rel="noreferrer">GitHub 共创</a></footer>
 </main>;
}
