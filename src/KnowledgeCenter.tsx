import {useEffect,useState} from 'react';
import {api} from './api';
type Entry={id:string;title:string;content:string;tags:string[];reviewStatus:'pending'|'approved';enabled:boolean};
type Store={entries:Entry[];count:number;approved:number};
type Hit={id:string;title:string;excerpt:string;tags:string[];score:number};
export default function KnowledgeCenter(){
 const [view,setView]=useState<Store>({entries:[],count:0,approved:0});
 const [title,setTitle]=useState(''),[content,setContent]=useState(''),[tags,setTags]=useState('');
 const [query,setQuery]=useState(''),[hits,setHits]=useState<Hit[]>([]);
 const [error,setError]=useState(''),[note,setNote]=useState(''),[busy,setBusy]=useState(false);
 const refresh=async()=>setView(await api<Store>('GET','/knowledge'));
 useEffect(()=>{void refresh().catch(e=>setError((e as Error).message));},[]);
 const act=async(operation:()=>Promise<unknown>,message:string)=>{
  setBusy(true);setError('');setNote('');
  try{await operation();await refresh();setNote(message);}
  catch(e){setError((e as Error).message);}
  finally{setBusy(false);}
 };
 return <section className="panel" style={{padding:22}}>
  <div className="eyebrow">BUILT-IN KNOWLEDGE MODULE / V0.1</div>
  <h1>知识库</h1>
  <p>本地保存文档内容，人工审核后才允许进入检索。这里没有向外部模型发送资料，也不会自动回应客户。</p>
  <p className="muted">已录入 {view.count} 条 · 已启用并审核 {view.approved} 条 · 当前为单机单工作区原型；企业多租户权限待开发</p>
  {error&&<p role="alert" className="notice">{error}</p>}
  {note&&<p role="status" className="notice">{note}</p>}
  <div className="form-row">
   <div style={{flex:1,minWidth:260}}>
    <h2>录入新知识</h2>
    <label className="field"><span>标题</span><input value={title} maxLength={200} onChange={e=>setTitle(e.target.value)}/></label>
    <label className="field"><span>正文（最多 20000 字）</span><textarea value={content} rows={6} maxLength={20000} onChange={e=>setContent(e.target.value)}/></label>
    <label className="field"><span>标签（逗号分隔）</span><input value={tags} onChange={e=>setTags(e.target.value)}/></label>
    <button className="btn primary" disabled={busy||!title.trim()||!content.trim()} onClick={()=>void act(async()=>{
      await api('POST','/knowledge',{title,content,tags:tags.split(/[,，]/).map(s=>s.trim()).filter(Boolean)});
      setTitle('');setContent('');setTags('');
    },'知识已保存为待审核草稿')}>保存草稿</button>
   </div>
   <div style={{flex:1,minWidth:260}}>
    <h2>检索已审核知识</h2>
    <label className="field"><span>查询</span><input value={query} maxLength={500} onChange={e=>setQuery(e.target.value)}/></label>
    <button className="btn secondary" disabled={busy||!query.trim()} onClick={()=>void act(async()=>{
      const result=await api<{hits:Hit[]}>('POST','/knowledge/search',{query});setHits(result.hits);
    },'检索完成')}>查询</button>
    <div>{hits.map(h=><article className="panel" style={{padding:12,marginTop:10}} key={h.id}><strong>{h.title}</strong><p>{h.excerpt}</p></article>)}</div>
   </div>
  </div>
  <h2 style={{marginTop:20}}>知识清单</h2>
  {view.entries.length===0?<p className="muted">目前没有知识条目。可先添加一条模拟 FAQ。</p>:view.entries.map(x=><article className="panel" key={x.id} style={{padding:14,marginTop:10}}>
   <strong>{x.title}</strong><p className="muted">{x.reviewStatus==='approved'?'已审核':'待审核'} · {x.enabled?'已启用':'已停用'} · {x.tags.join('、')||'无标签'}</p>
   <p style={{whiteSpace:'pre-wrap'}}>{x.content.slice(0,600)}</p>
   <div className="form-row">
    {x.reviewStatus==='pending'&&<button className="btn primary" disabled={busy} onClick={()=>void act(()=>api('POST','/knowledge/'+x.id+'/approve',{}),'已审核并启用')}>人工审核通过</button>}
    {x.reviewStatus==='approved'&&<button className="btn secondary" disabled={busy} onClick={()=>void act(()=>api('POST','/knowledge/'+x.id+'/'+(x.enabled?'disable':'enable'),{}),x.enabled?'已停用':'已启用')}>{x.enabled?'停用知识':'启用知识'}</button>}
    <button className="btn secondary" disabled={busy} onClick={()=>{if(window.confirm('确认永久删除这条本地知识？'))void act(()=>api('POST','/knowledge/'+x.id+'/delete',{confirm:true}),'已删除');}}>删除</button>
   </div>
  </article>)}
 </section>;
}
