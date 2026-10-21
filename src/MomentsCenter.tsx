import { useEffect, useState } from 'react';
import { CheckCircle2, ClipboardCopy, Download, FileImage, ListChecks, MonitorSmartphone, ShieldCheck, Users } from 'lucide-react';
import { api, copyText } from './api';
import { handoffZip, imageBytes, safeName, textBytes } from './moments-export';
import { Button, Field, PageHead } from './components';
import type { DeviceKind, MomentsAccount, MomentsAsset, MomentsCampaign, MomentsContent, MomentsJob } from '../server/moments-campaign';

type View = {
  accounts: MomentsAccount[]; assets: MomentsAsset[]; content: MomentsContent[];
  campaigns: MomentsCampaign[]; jobs: MomentsJob[];
  stats: { accounts: number; pending: number; verified: number; reported: number; unknown: number };
  provider: { personalWechatApi: false; autoPublishEnabled: false };
};
type Tab = 'tasks'|'content'|'accounts'|'history';
const statusLabel: Record<MomentsJob['status'],string> = {
  review:'待审核', approved:'待发布', handoff:'已交接、待操作',
  reported:'操作员说已发布，待核实', verified:'已人工核实发布',
  unknown:'结果不确定，禁止重发', skipped:'已跳过', stale:'原内容或账号已修改，失效',
};
const deviceLabels: Record<DeviceKind,string> = { windows:'Windows 电脑', mac:'Mac 电脑', phone:'手机（人工发布）' };
function saveFile(dataUrl: string, name: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = name.replace(/[\\/:*?"<>|\x00-\x1f]/g,'_');
  document.body.append(a); a.click(); a.remove();
}
async function toDataUrl(file: File): Promise<string> {
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onload = () => typeof reader.result==='string' ? resolve(reader.result) : reject(new Error('文件读取失败'));
    reader.onerror = () => reject(reader.error ?? new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}
export default function MomentsCenter() {
  const [view,setView] = useState<View>();
  const [tab,setTab] = useState<Tab>('tasks');
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [busy,setBusy] = useState(false);
  const [name,setName] = useState('');
  const [device,setDevice] = useState<DeviceKind>('windows');
  const [deviceLabel,setDeviceLabel] = useState('');
  const [ownerConfirmed,setOwnerConfirmed] = useState(false);
  const [batchAccounts,setBatchAccounts] = useState('');
  const [selectedContent,setSelectedContent] = useState('');
  const [title,setTitle] = useState('');
  const [text,setText] = useState('');
  const [assetIds,setAssetIds] = useState<string[]>([]);
  const [targets,setTargets] = useState<string[]>([]);
  const [jobTexts,setJobTexts] = useState<Record<string,string>>({});
  const [visibility,setVisibility] = useState<Record<string,string>>({});
  const [identityCheck,setIdentityCheck] = useState<Record<string,boolean>>({});
  const [timelineCheck,setTimelineCheck] = useState<Record<string,boolean>>({});
  const refresh = async () => {
    const v = await api<View>('GET','/moments');
    setView(v);
    setSelectedContent(old=>old && v.content.some(c=>c.id===old)?old:'');
  };
  useEffect(()=>{void refresh().catch(e=>setError((e as Error).message));},[]);
  const run = async (method:'POST'|'PUT',path:string,body:unknown,message:string) => {
    setBusy(true);setError('');setNotice('');
    try { await api(method,path,body);
      if(method==='PUT'&&path.startsWith('/moments/jobs/')) {
        const id=path.slice('/moments/jobs/'.length);
        setIdentityCheck(v=>({...v,[id]:false}));
      }
      await refresh();setNotice(message);return true; }
    catch(e){setError((e as Error).message);return false;}
    finally{setBusy(false);}
  };
  const beginEdit = (id:string) => {
    setSelectedContent(id); const c = view?.content.find(v=>v.id===id);
    setTitle(c?.title??'');setText(c?.text??'');setAssetIds(c?.assetIds??[]);
  };
  const saveContent = async () => {
    const c = view?.content.find(v=>v.id===selectedContent);
    const ok = await run(c?'PUT':'POST',c?'/moments/content/'+c.id:'/moments/content',
      {title,text,assetIds,...(c?{expectedVersion:c.version}:{})},
      c?'内容已保存新版本：旧的未交接任务将失效，需重新分配':'内容已创建');
    if(ok) beginEdit('');
  };
  const upload = async (files: FileList|null) => {
    if(!files?.length)return;
    setBusy(true);setError('');setNotice('');
    try {
      let added = [...assetIds];
      for(const f of Array.from(files)) {
        if(!['image/png','image/jpeg','image/webp'].includes(f.type)||f.size>4*1024*1024)throw Error('每张图需为不超过4MB的 PNG/JPEG/WebP');
        const dataUrl = await toDataUrl(f);
        const a = await api<MomentsAsset>('POST','/moments/assets',{name:f.name,dataUrl});
        if(!added.includes(a.id))added.push(a.id);
        if(added.length>9)throw Error('最多选择9张图片，请移除多余图片');
        setAssetIds([...added]);
      }
      setNotice('图片已保存到咔哒本地素材库，尚未发布或上传微信');
    }catch(e){setError((e as Error).message);}
    finally{setBusy(false);}
  };
  const download = async (id:string) => {
    setBusy(true);setError('');
    try { const a = await api<MomentsAsset & {dataUrl:string}>('GET','/moments/assets/'+id);saveFile(a.dataUrl,a.name); }
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  const copy = async (text:string) => {try{await copyText(text);setNotice('已复制文案，需在所选账号原生微信中手动发布');}catch(e){setError((e as Error).message);}};
  const exportBundle = async (j:MomentsJob, account?:MomentsAccount) => {
    if (!account) { setError('账号不存在，无法导出');return; }
    setBusy(true);setError('');setNotice('');
    try {
      const files: Array<{name:string;bytes:Uint8Array}> = [
        {name:'朋友圈正文.txt',bytes:textBytes(j.text)},
        {name:'发布说明.txt',bytes:textBytes('目标账号：'+account.name+'\n设备：'+account.deviceLabel+'\n可见范围提醒：'+j.visibility+'\n\n请在正确账号的原生微信中人工发布，再到咔哒登记并核实。文件包不包含微信登录信息。\n')},
      ];
      for (const [i,id] of j.assetIds.entries()) {
        const a=await api<MomentsAsset & {dataUrl:string}>('GET','/moments/assets/'+id);
        files.push({name:String(i+1).padStart(2,'0')+'-'+safeName(a.name),bytes:imageBytes(a.dataUrl)});
      }
      const blob=handoffZip(files),url=URL.createObjectURL(blob);
      const a=document.createElement('a');a.href=url;a.download='朋友圈-'+safeName(account.name)+'-素材包.zip';
      document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
      setNotice('素材包已导出；可用隔空投送/文件传输到手机。请在对应个人微信里人工发布。');
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  const current = view?.content.find(c=>c.id===selectedContent);
  const active = view?.accounts.filter(a=>a.enabled)??[];
  const media = (list:string[]) => list.map(id=>view?.assets.find(a=>a.id===id)).filter((a):a is MomentsAsset=>Boolean(a));
  const latestJobs = [...(view?.jobs??[])].reverse();
  return <>
    <PageHead title="朋友圈运营中心" eyebrow="PERSONAL WECHAT · LOCAL WORKSPACE"
      description="一条内容分发给多个个人微信号。每个账号独立审核、人工发布、核实结果；不会自动登录或批量代发。" />
    {error&&<div className="notice" role="alert">{error}</div>}
    {notice&&<div className="notice" role="status">{notice}</div>}
    <section className="panel" style={{padding:18,marginBottom:16}}>
      <p><strong>多设备模式已启用：</strong>适合 6+ 账号分布于 Windows、Mac、手机。电脑未登录或手机上的账号可以使用“复制正文＋保存图片”的人工交接方式。</p>
      <p className="muted">个人微信无已验证的批量发朋友圈官方 API。本版本不代发、不抓取联系人、不保存微信密码。只有核实账号本人朋友圈后才登记“已核实”。</p>
      {view&&<div className="form-row"><span><Users size={14}/> 有效账号 {view.stats.accounts}</span><span><ListChecks size={14}/> 待处理 {view.stats.pending}</span><span><CheckCircle2 size={14}/> 已核实 {view.stats.verified}</span><span>结果不明 {view.stats.unknown}</span></div>}
    </section>
    <div className="operation-platforms" role="group" aria-label="朋友圈运营工作区">
      {([['tasks','发布任务'],['content','内容库'],['accounts','我的账号'],['history','发布记录']] as const).map(([key,label])=>
        <button key={key} aria-pressed={tab===key} onClick={()=>{setTab(key);if(key==='content')beginEdit(selectedContent);}}>{label}</button>)}
    </div>
    {tab==='accounts'&&<section className="panel" style={{padding:20,marginTop:14}}>
      <h2><MonitorSmartphone size={19}/> 账号与设备登记</h2>
      <p className="muted">只登记你自己或已获得操作授权的个人号备注和设备，不输入微信密码。账号备注不要与其他号重复。</p>
      <form onSubmit={e=>{e.preventDefault();void (async()=>{
        if(await run('POST','/moments/accounts',{name,device,deviceLabel,ownedOrAuthorized:ownerConfirmed},'账号已登记')){
          setName('');setDeviceLabel('');setOwnerConfirmed(false);
        }
      })();}}>
        <div className="form-row">
          <Field label="账号备注（唯一）"><input required maxLength={80} value={name} onChange={e=>setName(e.target.value)} placeholder="例如：个人主号 / 企业AI业务号"/></Field>
          <Field label="主要设备"><select value={device} onChange={e=>setDevice(e.target.value as DeviceKind)}>{Object.entries(deviceLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="设备名称"><input required maxLength={120} value={deviceLabel} onChange={e=>setDeviceLabel(e.target.value)} placeholder="例如：Win-A / Mac mini / iPhone-2"/></Field>
        </div>
        <label><input type="checkbox" checked={ownerConfirmed} onChange={e=>setOwnerConfirmed(e.target.checked)}/> 我是账号所有者或已获得明确操作授权</label>
        <div style={{marginTop:12}}><Button type="submit" busy={busy||!ownerConfirmed}>登记账号</Button></div>
      </form>
      <details style={{marginTop:18}}><summary>批量登记 6+ 账号（省去逐条填写）</summary>
        <p className="muted">每行：账号备注 | windows/mac/phone | 设备名称。不同号使用不同备注，最多一次30个，不需要密码。</p>
        <textarea rows={5} value={batchAccounts} onChange={e=>setBatchAccounts(e.target.value)}
          placeholder={'个人主号|windows|Win-A\n业务号|mac|Mac mini\n品牌号|phone|iPhone-2'} />
        <div style={{marginTop:10}}><Button busy={busy||!ownerConfirmed||!batchAccounts.trim()} onClick={()=>void (async()=>{
          try {
            const accounts=batchAccounts.trim().split(/\r?\n/).map(line=>{
              const parts=line.split('|').map(s=>s.trim());
              if(parts.length!==3||!['windows','mac','phone'].includes(parts[1]))throw Error('请按 账号备注|windows/mac/phone|设备名称 每行填写');
              return {name:parts[0],device:parts[1],deviceLabel:parts[2]};
            });
            if(await run('POST','/moments/accounts/batch',{accounts,ownedOrAuthorized:ownerConfirmed},'多个账号已登记'))setBatchAccounts('');
          }catch(e){setError((e as Error).message);}
        })()}>确认以上账号已获授权，批量登记</Button></div>
      </details>
      <h2 style={{marginTop:22}}>已登记账号（{view?.accounts.length??0}）</h2>
      {!view?.accounts.length&&<p className="muted">先登记至少两个实际使用的账号。</p>}
      {view?.accounts.map(a=><article key={a.id} className="panel" style={{padding:12,marginTop:8}}>
        <strong>{a.name}</strong> · {deviceLabels[a.device]} · {a.deviceLabel} · {a.enabled?'启用':'已停用'}
        <div style={{marginTop:8}}><Button busy={busy} variant="secondary" onClick={()=>void run('PUT','/moments/accounts/'+a.id,{enabled:!a.enabled,ownedOrAuthorized:true},a.enabled?'账号已停用，未完成任务作废':'账号已重新启用')}>{a.enabled?'停用账号':'重新启用'}</Button></div>
      </article>)}
    </section>}
    {tab==='content'&&<section className="panel" style={{padding:20,marginTop:14}}>
      <h2><FileImage size={19}/> 朋友圈内容与配图</h2>
      <p className="muted">建议使用内容工厂产出的已审校文案和原图。本地素材可多号复用，实际发布前分别确认各账号的可见范围。</p>
      <Field label="编辑已有内容 / 创建新内容">
        <select value={selectedContent} onChange={e=>beginEdit(e.target.value)}>
          <option value="">＋ 新建内容</option>
          {view?.content.map(c=><option value={c.id} key={c.id}>{c.title} · v{c.version}</option>)}
        </select>
      </Field>
      <Field label="内容标题"><input maxLength={120} value={title} onChange={e=>setTitle(e.target.value)} placeholder="例如：2026年10月客户案例"/></Field>
      <Field label="朋友圈正文"><textarea rows={6} maxLength={5000} value={text} onChange={e=>setText(e.target.value)} placeholder="粘贴正文；后续可按不同账号分别改写"/></Field>
      <Field label="上传配图（每张不超过4MB，最多9张，PNG/JPEG/WebP）">
        <input type="file" multiple accept="image/png,image/jpeg,image/webp" disabled={busy||assetIds.length>=9} onChange={e=>{void upload(e.target.files);e.target.value='';}}/>
      </Field>
      {media(assetIds).map(a=><div key={a.id} className="form-row" style={{marginTop:8}}>
        <span>{a.name} · {(a.size/1024).toFixed(0)} KB</span>
        <Button variant="secondary" busy={busy} onClick={()=>void download(a.id)}>保存图片</Button>
        <Button variant="secondary" busy={busy} onClick={()=>setAssetIds(v=>v.filter(id=>id!==a.id))}>从内容移除</Button>
      </div>)}
      <div style={{marginTop:14}}><Button busy={busy||!title.trim()||!text.trim()} onClick={()=>void saveContent()}>{current?'保存新版本':'保存内容'}</Button></div>
      {current&&<p className="muted">保存旧内容的新版本会使尚未操作的旧任务失效；已报告发布的任务保留原始版本，不被覆盖。</p>}
      <h2 style={{marginTop:22}}>内容库</h2>
      {view?.content.map(c=><button key={c.id} className="operation-task" onClick={()=>beginEdit(c.id)}>
        <span><strong>{c.title}</strong><small>v{c.version} · {c.assetIds.length} 张图 · {c.text.slice(0,60)}</small></span>
      </button>)}
    </section>}
    {tab==='tasks'&&<>
      <section className="panel" style={{padding:20,marginTop:14,marginBottom:16}}>
        <h2><ListChecks size={19}/> 创建多账号分发任务</h2>
        <p>选择一条已保存的内容，然后勾选要发送的个人号。**一次分发为每个账号生成独立任务**，不会在微信中直接发布。</p>
        <Field label="选择内容">
          <select value={selectedContent} onChange={e=>setSelectedContent(e.target.value)}>
            <option value="">请选择内容</option>{view?.content.map(c=><option key={c.id} value={c.id}>{c.title} · v{c.version} · {c.assetIds.length}张图</option>)}
          </select>
        </Field>
        {!view?.content.length&&<p className="muted">先在「内容库」创建一条内容。</p>}
        {!active.length&&<p className="muted">先在「我的账号」登记微信号。</p>}
        <div style={{display:'flex',flexWrap:'wrap',gap:10,margin:'12px 0'}}>
          {active.map(a=><label key={a.id} style={{padding:9,border:'1px solid var(--border)',borderRadius:8}}>
            <input type="checkbox" checked={targets.includes(a.id)} onChange={e=>setTargets(v=>e.target.checked?[...v,a.id]:v.filter(id=>id!==a.id))}/> {a.name} <small>({a.deviceLabel})</small>
          </label>)}
        </div>
        <div style={{marginBottom:10}}><Button variant="secondary" disabled={!current||busy} onClick={()=>setTargets(active.filter(a=>!view?.jobs.some(j=>j.accountId===a.id&&j.contentId===current?.id&&j.contentVersion===current?.version&&j.status!=='skipped')).map(a=>a.id))}>选中尚未分配该内容的账号</Button></div>
        <div className="form-row">
          <Button busy={busy||!current||!targets.length} onClick={()=>void (async()=>{
            if(await run('POST','/moments/campaigns',{contentId:selectedContent,accountIds:targets},'已创建逐账号任务，不会自动发朋友圈'))setTargets([]);
          })()}>为选中的 {targets.length} 个账号创建任务</Button>
          <Button variant="secondary" onClick={()=>{setTab('accounts');}}>管理账号</Button>
          <Button variant="secondary" onClick={()=>{setTab('content');beginEdit('');}}>新建内容</Button>
        </div>
      </section>
      <section className="panel" style={{padding:20}}>
        <h2>发布队列（{view?.jobs.length??0}）</h2>
        {!view?.jobs.length&&<p className="muted">还没有发布任务。先建内容、登记账号，再创建分发任务。</p>}
        {latestJobs.map((j,index)=>{
          const a=view?.accounts.find(x=>x.id===j.accountId), c=view?.content.find(x=>x.id===j.contentId);
          const workingText=jobTexts[j.id]??j.text, workingVisibility=visibility[j.id]??j.visibility;
          const readyToHandoff=['approved','handoff'].includes(j.status) && workingText===j.text && workingVisibility===j.visibility;
          return <details key={j.id} open={index===0} className="panel" style={{padding:14,marginTop:12}}>
            <summary><strong>{j.accountName??a?.name??'已丢失账号'} · {j.contentTitle??c?.title??'内容已丢失'} v{j.contentVersion}</strong> · {statusLabel[j.status]} · {j.assetIds.length} 张图</summary>
            <p className="muted">{j.deviceLabel??a?.deviceLabel} / {a?deviceLabels[a.device]:''} · {statusLabel[j.status]}。手机账号使用素材包手动发布。</p>
            <Field label="当前账号专属正文（可以不同）">
              <textarea rows={4} maxLength={5000} value={workingText} disabled={!['review','approved'].includes(j.status)} onChange={e=>setJobTexts(v=>({...v,[j.id]:e.target.value}))}/>
            </Field>
            <Field label="可见范围 / 账号发布提醒（必须在原生微信确认）">
              <input maxLength={300} value={workingVisibility} disabled={!['review','approved'].includes(j.status)} onChange={e=>setVisibility(v=>({...v,[j.id]:e.target.value}))}/>
            </Field>
            {j.assetIds.length>0&&<div className="form-row" style={{margin:'8px 0'}}>
              {media(j.assetIds).map(m=><Button key={m.id} variant="secondary" busy={busy} onClick={()=>void download(m.id)}><Download size={13}/> {m.name}</Button>)}
            </div>}
            <div className="form-row" style={{marginTop:12}}>
              <Button busy={busy||!readyToHandoff} variant="secondary" onClick={()=>void copy(j.text)}><ClipboardCopy size={14}/> 复制已保存正文</Button>
              <Button busy={busy||!readyToHandoff} variant="secondary" onClick={()=>void exportBundle(j,a?{...a,name:j.accountName??a.name,deviceLabel:j.deviceLabel??a.deviceLabel}:undefined)}><Download size={14}/> 一键打包文案+配图</Button>
              {['review','approved'].includes(j.status)&&<Button busy={busy} variant="secondary" onClick={()=>void run('PUT','/moments/jobs/'+j.id,{expectedFingerprint:j.fingerprint,text:workingText,visibility:workingVisibility},'已保存该账号版本；审核状态重置')}>保存专属文案</Button>}
              {j.status==='review'&&<Button busy={busy||workingText!==j.text||workingVisibility!==j.visibility} onClick={()=>void run('POST','/moments/jobs/'+j.id+'/approve',{expectedFingerprint:j.fingerprint,confirmed:true},'已审核该账号任务')}>审核通过</Button>}
            </div>
            {j.status==='approved'&&<>
              <p className="muted">请先在原生微信中核对当前登录的确为「{j.accountName??a?.name}」，尤其注意同一电脑上切号或不同设备上的账号。</p>
              <label><input type="checkbox" checked={identityCheck[j.id]??false} onChange={e=>setIdentityCheck(v=>({...v,[j.id]:e.target.checked}))}/> 我已人工核对账号身份、正文、图片、可见范围</label>
              <div style={{marginTop:10}}><Button busy={busy||!identityCheck[j.id]||!readyToHandoff} onClick={()=>void run('POST','/moments/jobs/'+j.id+'/handoff',{accountId:j.accountId,expectedFingerprint:j.approvedFingerprint,identityConfirmed:true},'已交接，请到对应设备的微信中手动发布')}>开始本账号人工发布</Button></div>
            </>}
            {j.status==='handoff'&&<div className="form-row" style={{marginTop:12}}>
              <Button busy={busy} onClick={()=>void run('POST','/moments/jobs/'+j.id+'/report',{accountId:j.accountId,operatorConfirmed:true,outcome:'reported'},'已记录你的发布操作，仍需要检查本人朋友圈')}>我在原生微信已发布</Button>
              <Button busy={busy} variant="secondary" onClick={()=>void run('POST','/moments/jobs/'+j.id+'/report',{accountId:j.accountId,operatorConfirmed:true,outcome:'unknown'},'结果不确定，已锁定避免重发')}>不确定是否发出</Button>
              <Button busy={busy} variant="secondary" onClick={()=>void run('POST','/moments/jobs/'+j.id+'/report',{accountId:j.accountId,operatorConfirmed:true,outcome:'skipped'},'已跳过此账号')}>取消本次发布</Button>
            </div>}
            {j.status==='reported'&&<>
              <p><ShieldCheck size={15}/> 请进入当前账号<strong>本人朋友圈</strong>，核对实际发表的文字、图片和可见性。这是人工核实，不是接口回执。</p>
              <label><input type="checkbox" checked={timelineCheck[j.id]??false} onChange={e=>setTimelineCheck(v=>({...v,[j.id]:e.target.checked}))}/> 我已在正确账号的本人朋友圈看到这条内容</label>
              <div style={{marginTop:10}}><Button busy={busy||!timelineCheck[j.id]} onClick={()=>void run('POST','/moments/jobs/'+j.id+'/verify',{accountId:j.accountId,expectedFingerprint:j.approvedFingerprint,timelineConfirmed:true},'已保存该账号的人工核实记录')}>核实发布成功</Button></div>
            </>}
            {j.status==='unknown'&&<Button busy={busy} variant="secondary" onClick={()=>{if(window.confirm('请先亲自在对应账号的本人朋友圈检查：确实没有发布这条内容。确认后解除锁定？'))void run('POST','/moments/jobs/'+j.id+'/resolve-unknown',{accountId:j.accountId,confirmedNotPublished:true},'已解除未知状态，需重新审核后交接');}}>核实未发布，解除锁定</Button>}
          </details>;
        })}
      </section>
    </>}
    {tab==='history'&&<section className="panel" style={{padding:20,marginTop:14}}>
      <h2>发布结果与复盘</h2>
      <p className="muted">这里记录人工工作流状态，不显示伪造的阅读量、转化数或接口送达率。</p>
      <table style={{width:'100%',textAlign:'left'}}><thead><tr><th>账号</th><th>内容</th><th>状态</th><th>时间</th></tr></thead>
        <tbody>{latestJobs.map(j=><tr key={j.id}>
          <td>{j.accountName??view?.accounts.find(a=>a.id===j.accountId)?.name??'-'}</td>
          <td>{j.contentTitle??view?.content.find(c=>c.id===j.contentId)?.title??'-'} v{j.contentVersion}</td>
          <td>{statusLabel[j.status]}</td><td>{new Date(j.updatedAt).toLocaleString('zh-CN')}</td>
        </tr>)}</tbody></table>
      <p className="muted">内容、图片与账号备注都保存在这台咔哒设备的本地数据目录；Mac 和手机不会因此自动同步。跨设备时请从任务卡复制文案并下载图片手动交接。</p>
    </section>}
  </>;
}
