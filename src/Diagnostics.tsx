import { useState } from 'react';
import { BookOpen, Copy, LifeBuoy, HelpCircle, MessageCircleQuestion } from 'lucide-react';
import { Button, Modal } from './components';
import { buildDiagnosticReport, SUPPORT_HINT } from '../shared/diagnostics';
import { vendor } from '../shared/vendor';
import './diagnostics.css';
import Tutorial, { openHelpAssistant } from './Tutorial';
import { TUTORIALS, type TutorialId } from '../shared/tutorials';

/** 先看小教程: one chip per tutorial; the picked one opens below. 「问咔哒」 next to them; support comes after both. */
function SelfHelp({onLeave}:{onLeave?:()=>void}){
  const [pick,setPick]=useState<TutorialId>();
  return <section className="diagnostics-self-help" style={{marginBottom:14}}><h2 style={{display:'flex',alignItems:'center',gap:6}}><BookOpen size={17}/>先看小教程</h2><p className="muted">大多数问题照着做几步就能自己解决。</p>
    <div style={{display:'flex',flexWrap:'wrap',gap:6}}>{TUTORIALS.map(t=><button type="button" key={t.id} aria-pressed={pick===t.id} className={`btn ${pick===t.id?'btn-primary':'btn-secondary'}`} style={{padding:'4px 10px',fontSize:12}} onClick={()=>setPick(v=>v===t.id?undefined:t.id)}>{t.title}</button>)}</div>
    {pick&&<Tutorial key={pick} id={pick} open onLeave={onLeave}/>}
    <div className="diagnostic-actions" style={{marginTop:10}}><Button variant="secondary" onClick={()=>{onLeave?.();openHelpAssistant();}}><MessageCircleQuestion size={16}/>问咔哒</Button><span className="muted">用一句话问，AI 按使用手册回答并带你去对应的地方。</span></div>
  </section>;
}

export function DiagnosticsPanel({onClose}:{onClose?:()=>void}={}) {
  const [report,setReport]=useState('');const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);const [bundle,setBundle]=useState<{name:string;shown:boolean}>();
  const bridge=window.flowdesk?.diagnostics,support=window.flowdesk?.support;
  const load=async()=>bridge?bridge.report():buildDiagnosticReport({version:'0.3.0',build:'community-v0.3.0',platform:'browser',entries:[],storageOk:false});
  // 主操作：一键生成求助包（一个 .txt，放在「下载」里），再在访达/资源管理器里选中它。
  const makeBundle=async()=>{setBusy(true);setMessage('');setBundle(undefined);try{
    if(support){setBundle(await support.bundle());}
    else{const text='咔哒求助包\n'+SUPPORT_HINT+'\n\n'+await load();const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='咔哒求助包.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setBundle({name:'咔哒求助包.txt',shown:false});}
  }catch{setMessage('没能生成求助包。可以先点下面的「复制日志」，粘贴发给咔哒客服。');}finally{setBusy(false);}};
  const action=async(kind:'copy'|'view')=>{setBusy(true);setMessage('');try{
    if(kind==='copy'&&bridge){const text=await bridge.copy();setReport(text);setMessage('日志已复制，请直接粘贴发给咔哒客服。');}
    else {const text=await load();setReport(text);if(kind==='copy'){try{await navigator.clipboard.writeText(text);setMessage('日志已复制，请粘贴发给咔哒客服。');}catch{setMessage('未能自动复制，请在下面点“选中全部日志”，再按 Ctrl+C 复制。');}}}
  }catch{setMessage('未能复制。若咔哒正在输入，请等它交还键鼠后再试；也可以先点“查看日志”再手动复制。');}finally{setBusy(false);}};
  return <section className="diagnostics-panel"><SelfHelp onLeave={onClose}/><h2>还不行？一键生成求助包</h2><p>点下面的按钮，咔哒会在「下载」文件夹里生成一个求助文件，并帮你打开文件所在的位置。</p>
    <div className="diagnostic-actions"><Button busy={busy} onClick={()=>void makeBundle()}><LifeBuoy size={16}/>一键生成求助包</Button></div>
    {bundle&&<div className="support-bundle-done" role="status"><strong>已生成：{bundle.name}</strong><span>{bundle.shown?'已在「下载」文件夹里选中它。':'它在「下载」文件夹里。'}</span><span>{SUPPORT_HINT}</span></div>}
    <p className="muted">求助包里只有版本、系统、设置开关、最近的出错类型和耗时统计；没有客户名字、聊天内容、截图、知识库、密钥或卡密，也不会自动上传。</p>
    {!bridge&&<p role="status">当前只能生成基本信息；桌面诊断入口需要更新到包含此功能的版本。</p>}
    <div className="diagnostic-secondary"><span className="muted">其他方式：</span><Button variant="secondary" busy={busy} onClick={()=>void action('copy')}><Copy size={16}/>复制日志</Button><Button variant="secondary" busy={busy} onClick={()=>void action('view')}>查看日志</Button></div>
    <p role="status">{message}</p>{report&&<><button type="button" className="text-link" onClick={()=>{const el=document.getElementById('diagnostic-report') as HTMLTextAreaElement|null;el?.focus();el?.select();}}>选中全部日志</button><textarea id="diagnostic-report" aria-label="脱敏诊断日志" readOnly value={report}/></>}<p className="muted" style={{fontSize:11,marginTop:12}}>以上都试过还不行：生成求助包发给客服 · <a href={`mailto:${vendor.supportEmail}`}>邮件联系负责人</a></p></section>;
}
/** One-tap feedback: describe the problem, the app saves the diagnostics and opens an email draft to the beta owner. */
export function FeedbackButton({compact=false}:{compact?:boolean}){
  const [open,setOpen]=useState(false);const [text,setText]=useState('');const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');
  const send=async()=>{setBusy(true);setMessage('');try{const bridge=window.flowdesk?.diagnostics;if(!bridge?.feedback)throw Error('当前环境不支持一键反馈');const r=await bridge.feedback(text);setMessage(r.opened?'已打开邮件草稿，并把诊断日志放在「下载」里，请作为附件一起发送。':`未能打开邮件应用。日志已保存到：${r.file}，请发到服务人员。`);}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}};
  return <><button type="button" className={`btn btn-secondary diagnostics-entry${compact?' compact':''}`} onClick={()=>setOpen(true)}><LifeBuoy size={16}/>反馈问题</button>{open&&<Modal title="反馈问题" subtitle="写一句刚才发生了什么，咔哒会附上诊断日志。" onClose={()=>setOpen(false)}><textarea rows={4} style={{width:'100%',boxSizing:'border-box'}} placeholder="例如：客户发了图片后没有回复 / 昨晚 3 点停了" value={text} onChange={e=>setText(e.target.value)} />{message&&<p className="muted" style={{marginTop:8}}>{message}</p>}<div className="modal-actions"><Button variant="secondary" onClick={()=>setOpen(false)}>关闭</Button><Button busy={busy} onClick={()=>void send()}>生成邮件并附日志</Button></div></Modal>}</>;
}
export default function DiagnosticsButton({label='帮助与日志',iconOnly=false}:{label?:string;iconOnly?:boolean}) {
  const[open,setOpen]=useState(false);return <>{iconOnly?<button type="button" className="cp-btn-icon" title="帮助与日志" aria-label="帮助与日志" onClick={()=>setOpen(true)}><HelpCircle size={14}/></button>:<button type="button" className="btn btn-secondary diagnostics-entry" onClick={()=>setOpen(true)}><LifeBuoy size={16}/>{label}</button>}{open&&<Modal title="帮助与日志" subtitle="先看小教程或问咔哒；还不行再生成求助包发给客服。" onClose={()=>setOpen(false)}><DiagnosticsPanel onClose={()=>setOpen(false)}/></Modal>}</>;
}
