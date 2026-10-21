import React, {Suspense, lazy, useEffect, useState} from 'react';
import {api} from './api';
const ContentOperations=lazy(()=>import('./MomentsCenter'));

type Plugin = {
  id:string;name:string;version:string;description:string;
  bundled:boolean;downloadable:boolean;permissions:string[];enabled:boolean;
};
export default function WorkspaceApp(){
  const [plugins,setPlugins]=useState<Plugin[]>([]);
  const [page,setPage]=useState<'home'|'plugins'|'content'>('home');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const refresh=async()=>{
    const data=await api<Plugin[]>('GET','/plugins');
    setPlugins(data);setLoading(false);
  };
  useEffect(()=>{void refresh().catch(e=>{setError((e as Error).message);setLoading(false);});},[]);
  const content=plugins.find(p=>p.id==='com.kadadesk.content-ops');
  const toggle=async(p:Plugin)=>{
    setBusy(true);setError('');
    try{
      await api('POST','/plugins/'+p.id+'/'+(p.enabled?'disable':'enable'),{});
      await refresh();
      if(p.enabled&&page==='content')setPage('plugins');
    }catch(e){setError((e as Error).message);}
    finally{setBusy(false);}
  };
  return <main className="site">
    <nav className="site-nav">
      <div><strong>咔哒 KADAdesk</strong><span style={{marginLeft:12}}>社区版 · 可扩展 AI 工作台</span></div>
      <div className="form-row">
        <button className="btn secondary" aria-pressed={page==='home'} onClick={()=>setPage('home')}>工作台</button>
        <button className="btn secondary" aria-pressed={page==='plugins'} onClick={()=>setPage('plugins')}>插件管理</button>
        {content?.enabled&&<button className="btn secondary" aria-pressed={page==='content'} onClick={()=>setPage('content')}>内容运营</button>}
      </div>
    </nav>
    {error&&<p className="notice" role="alert">{error}</p>}
    {loading?<p>正在载入工作台…</p>:<>
      {page==='home'&&<section className="panel" style={{padding:24}}>
        <div className="eyebrow">KADADESK CORE / WORKSPACE</div>
        <h1>按需组合你的 AI 工作台</h1>
        <p>工作台提供统一入口和模块启停。目前发布的是早期社区版：只内置一个内容运营示例模块，其他功能正在逐步开发。安装第三方插件和插件市场仍未实现。</p>
        <div className="form-row">
          <button className="btn primary" onClick={()=>setPage('plugins')}>查看已内置模块</button>
          {content?.enabled&&<button className="btn secondary" onClick={()=>setPage('content')}>打开内容运营</button>}
        </div>
        <p className="muted" style={{marginTop:18}}>规划方向：知识库、AI 回复建议、客户跟进、社群运营、行业连接器等均以独立模块逐步交付。没有获得授权的外部平台自动收发不会在工作台中悄悄启用。</p>
      </section>}
      {page==='plugins'&&<section className="panel" style={{padding:24}}>
        <h1>插件管理</h1>
        <p className="muted">现在支持**已随程序内置的可信模块**启用或停用，状态在本机保留；暂不支持任意第三方插件包的下载、加载、升级和卸载。</p>
        {plugins.map(p=><article key={p.id} className="panel" style={{padding:16,marginTop:12}}>
          <h2>{p.name} <span className="muted">v{p.version}</span></h2>
          <p>{p.description}</p>
          <p className="muted">{p.id} · {p.bundled?'内置模块':'独立安装'} · {p.enabled?'已启用':'已停用'} · {p.downloadable?'支持独立下载':'暂不支持独立下载'}</p>
          <p className="muted">权限声明：{p.permissions.join('、')||'无'}</p>
          <div className="form-row">
            <button className="btn primary" disabled={busy} onClick={()=>void toggle(p)}>{p.enabled?'停用模块':'启用模块'}</button>
            {p.enabled&&<button className="btn secondary" onClick={()=>setPage('content')}>打开模块</button>}
          </div>
        </article>)}
      </section>}
      {page==='content'&&(content?.enabled?
        <Suspense fallback={<p>正在加载内容运营模块…</p>}><ContentOperations/></Suspense>
        :<section className="panel" style={{padding:24}}><h2>内容运营未启用</h2><button className="btn secondary" onClick={()=>setPage('plugins')}>前往插件管理</button></section>)}
    </>}
    <footer>Community Workspace · 当前内置示例不自动发布内容 · <a href="https://github.com/AIMarshallLee/kadadesk-community" target="_blank" rel="noreferrer">GitHub 共创</a></footer>
  </main>;
}
