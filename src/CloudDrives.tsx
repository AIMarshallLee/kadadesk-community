import {useEffect,useRef,useState} from 'react';
import {driveKinds,driveNames,driveRedirect,type DriveKind,type DrivesView,type DrivePage,type DriveEntry} from '../shared/cloud-drives';
import {api,navigate} from './api';
import {Button,Field} from './components';
import type {PageProps} from './App';
import type {KnowledgeSourceView} from '../shared/knowledge-sources';

export default function CloudDrives({notify,perform}:PageProps){
  const [kind,setKind]=useState<DriveKind>('baidu'),[view,setView]=useState<DrivesView>();
  const [clientId,setClientId]=useState(''),[secret,setSecret]=useState(''),[working,setWorking]=useState(false);
  const [attempt,setAttempt]=useState<{manualCode:boolean;attemptId:string}>(),[code,setCode]=useState('');
  const [page,setPage]=useState<DrivePage>(),[selected,setSelected]=useState<DriveEntry[]>([]),[trail,setTrail]=useState<DriveEntry[]>([]);
  const [filter,setFilter]=useState(''),[error,setError]=useState('');const sequence=useRef(0);
  const load=()=>api<DrivesView>('GET','/knowledge/drives').then(setView);
  useEffect(()=>{void load().catch(e=>setError(e.message));const timer=setInterval(()=>void load().catch(()=>{}),2500);return()=>clearInterval(timer);},[]);
  const status=view?.providers[kind];
  async function run(work:()=>Promise<void>){setWorking(true);setError('');try{await work();}catch(e){const message=(e as Error).message;setError(message);notify(message,true);}finally{setWorking(false);}}
  async function browse(nextTrail=trail,next?:string){
    const seq=++sequence.current;
    const result=await api<DrivePage>('POST','/knowledge/drives/list',{kind,folder:nextTrail.at(-1)?.handle,page:next});
    if(sequence.current!==seq)return;
    setPage(previous=>next?{entries:[...(previous?.entries??[]),...result.entries],next:result.next}:result);setTrail(nextTrail);
  }
  function chooseKind(next:DriveKind){sequence.current++;setKind(next);setClientId('');setSecret('');setCode('');setAttempt(undefined);setPage(undefined);setTrail([]);setSelected([]);setFilter('');setError('');}
  const addSources=async()=>{
    const result=await api<{view:KnowledgeSourceView;ids:string[]}>('POST','/knowledge/drives/sources',{kind,handles:selected.map(s=>s.handle)});
    const ids=result.ids;
    if(ids.length)await api('POST','/knowledge/sources/sync',{ids,confirm:true});
    await perform('GET','/state');setSelected([]);notify('已添加资料源并完成本次整理尝试。请查看每份结果并审核知识。');navigate('knowledge/sources');
  };
  return <section className="panel knowledge-intake"><div className="intake-body">
    <h2>连接网盘，直接整理远端资料</h2><p>授权登录 → 浏览目录 → 勾选文档 → 读取并整理 → 审核启用。不用先下载再搬运文件。</p>
    <div className="page-actions" role="group" aria-label="网盘平台">{driveKinds.map(k=><Button key={k} variant={kind===k?'primary':'secondary'} disabled={working} onClick={()=>chooseKind(k)}>{driveNames[k]}</Button>)}</div>
    <div className="notice"><strong>{driveNames[kind]} · {status?.connected?'已保存授权':status?.configured?'可以开始授权':'需管理员配置应用'}</strong><p>{status?.message??'正在读取连接状态…'}</p>{!status?.configured&&<p>此安装尚未配置该平台的应用凭证。请管理员完成下方接入设置，之后使用者在网盘官方页面登录授权即可。</p>}</div>
    <div className="page-actions"><Button busy={working} disabled={!window.flowdesk?.knowledgeSources?.authorizeDrive||!status?.configured||working} onClick={()=>void run(async()=>{setAttempt(await window.flowdesk!.knowledgeSources!.authorizeDrive(kind));setCode('');await load();})}>{status?.connected?'重新授权账号':'在浏览器授权登录'}</Button>
      {status?.auth==='waiting'&&<Button variant="secondary" disabled={working} onClick={()=>void run(async()=>{await api('POST','/knowledge/drives/cancel');setAttempt(undefined);await load();})}>取消本次授权</Button>}
      {status?.connected&&<Button variant="secondary" disabled={working} onClick={()=>void run(async()=>{await api('DELETE','/knowledge/drives',{kind});setPage(undefined);setSelected([]);setTrail([]);await load();})}>断开账号（保留知识）</Button>}
    </div>
    {!window.flowdesk&&<p className="muted">授权登录请使用咔哒 Windows 桌面版。</p>}
    {attempt?.manualCode&&status?.auth==='waiting'&&<div className="notice"><Field label="百度授权页显示的授权码" hint="授权页复制后只粘贴在这里；不要提供账号密码或 Cookie。"><input type="password" autoComplete="new-password" maxLength={4096} value={code} onChange={e=>setCode(e.target.value)}/></Field><Button disabled={working||!code.trim()} onClick={()=>void run(async()=>{await api('POST','/knowledge/drives/code',{attemptId:attempt.attemptId,code});setCode('');await load();})}>完成授权</Button></div>}
    <details open={!status?.configured}><summary>管理员接入设置（首次配置一次）</summary>
      <p>填写你自己组织已获批的应用凭证。咔哒会在桌面端加密保存，不写入工作区导出文件。此处不是网盘账号密码；未通过平台审核的应用可能无法授权或下载。</p>
      {kind==='baidu'?<ol><li>在百度网盘开放平台完成企业开发者认证并创建应用，申请文件列表、文件信息与下载能力。</li><li>填写 API Key（应用 ID）与 Secret Key。授权使用平台的授权码页面（oob）。</li><li>上方授权后把页面显示的授权码粘贴回来。百度的 netdisk 授权范围由平台定义，咔哒仅调用读取接口。</li></ol>:kind==='alipan'?<ol><li>在阿里云盘开放平台申请应用。申请 user:base 与 file:all:read 权限，不需写入权限。</li><li>将下方回调地址加入应用白名单，填写 App ID 和 App Secret。</li><li>保存后从上方登录授权，完成后自动回到咔哒；下载能力取决于应用获批权限与平台政策。</li></ol>:kind==='google'?<ol><li>在 Google Cloud 启用 Drive API，配置 OAuth 同意屏幕，并添加内测用户。</li><li>创建“桌面应用”OAuth 客户端，填入 Client ID 与客户端密钥（若控制台提供）。使用 drive.readonly 权限，面向公众发布需要完成平台要求的验证。</li><li>保存后从上方登录 Google 授权，授权结果通过本机回调接收。</li></ol>:<ol><li>在 Microsoft Entra 注册支持目标账号类型的应用（需要个人账号时请选择相应选项）。</li><li>添加“移动和桌面应用”回调地址，启用委托 Files.Read 与 offline_access。公共客户端不填写应用密钥。</li><li>保存 Client ID 后登录授权；组织账号可能还需管理员同意。</li></ol>}
      {kind!=='baidu'&&<p>回调地址：<code>{driveRedirect}</code></p>}
      <Field label="应用 ID / Client ID" hint={status?.clientId?'已保存：'+status.clientId:'由网盘开放平台提供，普通用户无需自行创建。'}><input autoComplete="off" value={clientId} onChange={e=>setClientId(e.target.value)} disabled={working}/></Field>
      {kind!=='onedrive'&&<Field label="应用密钥 / Client Secret"><input type="password" autoComplete="new-password" value={secret} disabled={working} onChange={e=>setSecret(e.target.value)} placeholder="只在此处填写"/></Field>}
      <p className="muted">保存新配置会清除该平台已有授权，需重新登录。换账号后请重新选择文件，避免把不同账号的资料混在一起。</p>
      <Button variant="secondary" disabled={working||!clientId.trim()||(['baidu','alipan'].includes(kind)&&!secret.trim())} onClick={()=>void run(async()=>{await api('PUT','/knowledge/drives',{kind,clientId,clientSecret:secret});setSecret('');setPage(undefined);setSelected([]);setTrail([]);setAttempt(undefined);await load();notify('应用配置已保存，请点击上方授权登录。');})}>保存应用配置</Button>
    </details>
    <hr/>
    <h3>选择要交给客服学习的文件</h3><p className="muted">支持文字 PDF、DOCX、XLSX、CSV、JSON、TXT、Markdown、HTML。Google 文档和表格会导出为 Office 文件，演示文稿导出为 PDF。单文件最大 8MB，一次选 30 份；扫描件需先 OCR。</p>
    <div className="page-actions"><Button variant="secondary" disabled={working||!status?.connected} onClick={()=>void run(()=>browse([]))}>打开网盘根目录</Button><Button variant="secondary" disabled={working||!trail.length} onClick={()=>void run(()=>browse(trail.slice(0,-1)))}>返回上级</Button><Button variant="secondary" disabled={working||!page} onClick={()=>void run(()=>browse())}>刷新当前目录</Button></div>
    <p>当前位置：根目录{trail.map(f=>' / '+f.name).join('')}</p>
    {error&&<p role="alert" className="notice">{error}</p>}
    {page&&<><Field label="筛选已加载的文件名"><input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="例如：产品、FAQ、价格"/></Field>
      <div className="source-list">{page.entries.filter(e=>e.name.toLowerCase().includes(filter.toLowerCase())).map(entry=><article key={entry.handle}>{entry.folder?<Button variant="secondary" disabled={working} onClick={()=>void run(()=>browse([...trail,entry]))}>文件夹 · {entry.name}</Button>:<label><input type="checkbox" disabled={working||!entry.supported||(!selected.some(f=>f.handle===entry.handle)&&selected.length>=30)} checked={selected.some(f=>f.handle===entry.handle)} onChange={e=>setSelected(e.target.checked?[...selected,entry]:selected.filter(f=>f.handle!==entry.handle))}/><strong>{entry.name}</strong><small>{entry.size===undefined?'在线文档':Math.ceil(entry.size/1024)+' KB'}{!entry.supported?' · 暂不支持或超过 8MB':''}</small></label>}</article>)}</div>
      {!page.entries.length&&<p>这个目录为空。</p>}{page.next&&<Button variant="secondary" disabled={working} onClick={()=>void run(()=>browse(trail,page.next))}>加载下一页</Button>}
    </>}
    {!!selected.length&&<details open><summary>已选择 {selected.length} 份（可跨目录选择）</summary>{selected.map(f=><p key={f.handle}>{f.name} <Button variant="ghost" disabled={working} onClick={()=>setSelected(selected.filter(e=>e.handle!==f.handle))}>取消选择</Button></p>)}</details>}
    <div className="page-actions"><Button busy={working} disabled={working||!selected.length} onClick={()=>void run(addSources)}>添加并整理所选文件（{selected.length}）</Button><Button variant="secondary" disabled={working} onClick={()=>navigate('knowledge/sources')}>查看资料源和整理结果</Button></div>
    <p className="muted">原网盘文件保持不变。内容在本机解析、分段和去重；新知识需审核后才用于回答。后续在“我的资料源”重新读取即可获取更新。</p>
  </div></section>;
}
