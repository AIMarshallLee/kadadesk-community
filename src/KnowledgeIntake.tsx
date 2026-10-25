import { useState } from 'react';
import { FileUp, Send, TriangleAlert, Sparkles } from 'lucide-react';
import type { KnowledgeImportPreview, KnowledgeImportRow } from '../shared/knowledge';
import type { PageProps } from './App';
import { Button, Field } from './components';
import { api } from './api';
import IndustryTemplates from './IndustryTemplates';
import Tutorial from './Tutorial';

const ACCEPT = '.xlsx,.docx,.pdf,.csv,.json,.txt,.md,.html,.htm';
const split = (value: string) => [...new Set(value.split(/[|,，\n]/).map(x => x.trim()).filter(Boolean))];
const readFile = (file: File) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('无法读取 ' + file.name)); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.readAsDataURL(file); });
const platforms = {
  feishu: { name: '飞书知识库 / 云文档', hint: '有权限的文档可导出 Word、PDF 或 Markdown，再切换文件导入；也可复制正文。公开链接可尝试读取，登录页和动态页面需改用导出文件。' },
  notion: { name: 'Notion', hint: '页面导出为 Markdown 或网页文件（.html）；若下载的是压缩包（.zip），请先解压，再选择其中的文档。Notion 里的表格请先整理成「问题 / 答案」两列，导出为表格文件（.csv）再导入。' },
  yuque: { name: '语雀 / 其他在线知识库', hint: '将有权限的内容导出为本页支持的文件，或复制正文。公开网页可粘贴链接读取；本版不连接账号、不自动同步整本知识库。' },
};
export default function KnowledgeIntake({ state, perform, busy, notify, onPreview }: PageProps & { onPreview: (preview: KnowledgeImportPreview) => void }) {
  const [mode,setMode] = useState<'document'|'chat'|'online'>('document');
  const [files,setFiles] = useState<File[]>([]),[text,setText] = useState(''),[sourceName,setSourceName] = useState('');
  const [customers,setCustomers] = useState(''),[staff,setStaff] = useState(''),[url,setUrl] = useState('');
  const [platform,setPlatform] = useState<keyof typeof platforms>('feishu');
  const choose = (list: FileList|null) => { const next=Array.from(list||[]); if(next.length>5)return notify('一次最多导入 5 个文件。',true);if(next.some(f=>f.size>8*1024*1024))return notify('单个文件不能超过 8MB。',true);setFiles(next); };
  const preview = async (fromUrl=false) => {
    if(fromUrl&&!url.trim())return notify('请填写公开文档链接。',true);
    if(!fromUrl&&!files.length&&!text.trim())return notify('请选择文件或粘贴正文。',true);
    try {
      const encoded=fromUrl?[]:await Promise.all(files.map(async file=>({name:file.name,size:file.size,base64:await readFile(file)})));
      if(encoded.reduce((n,f)=>n+f.base64.length,0)>12*1024*1024)return notify('文件编码后的总大小不能超过 12MB。',true);
      const roles={customers:customers.split('\n').map(n=>n.trim()).filter(Boolean),staff:staff.split('\n').map(n=>n.trim()).filter(Boolean)};
      const body=fromUrl?{url:url.trim()}:{files:encoded.length?encoded:undefined,text:text.trim()||undefined,textKind:mode==='chat'?'chat':'document',sourceName:sourceName.trim()||'粘贴资料',...(mode==='chat'&&(roles.customers.length||roles.staff.length)?{chatRoles:roles}:{})};
      const result=await perform<KnowledgeImportPreview>('POST','/knowledge/import/preview',body);if(result)onPreview(result);
    }catch(error){notify((error as Error).message,true);}
  };
  return <section id="knowledge-import" className="panel knowledge-intake"><div className="panel-head"><div><h2><FileUp size={17}/>导入业务资料</h2><p>选文件 → 看一眼内容 → 确认启用。</p></div></div>
    <div className="intake-body"><Tutorial id="knowledge" />{!state.knowledge.some(k=>!k.id.startsWith('knowledge_demo_'))&&<IndustryTemplates perform={perform} notify={notify} collapsed/>}<div className="segmented" aria-label="导入来源">
      <button type="button" disabled={busy} className={mode==='document'?'selected':''} onClick={()=>setMode('document')}>文件 / 文档</button>
      <button type="button" disabled={busy} className={mode==='chat'?'selected':''} onClick={()=>setMode('chat')}>聊天应用聊天记录</button>
      <button type="button" disabled={busy} className={mode==='online'?'selected':''} onClick={()=>setMode('online')}>在线知识库</button>
    </div>
    {mode==='online'&&<><p>需要读取私有飞书或 Notion 文档？<Button variant="secondary" onClick={()=>{window.location.hash='knowledge/connections';}}>去连接账号</Button></p><Field label="来源平台"><select value={platform} onChange={e=>setPlatform(e.target.value as keyof typeof platforms)}>{Object.entries(platforms).map(([key,value])=><option key={key} value={key}>{value.name}</option>)}</select></Field><p className="muted">{platforms[platform].hint}</p><Field label="公开文档链接" hint="只读取该链接正文，不带登录状态；不会读取其他页面。"><input aria-label="公开文档链接" type="url" value={url} maxLength={300} onChange={e=>setUrl(e.target.value)} placeholder="https://…"/></Field><Button busy={busy} onClick={()=>void preview(true)}>读取链接并预览</Button><div className="intake-or">或导入已导出的文件 / 粘贴正文</div></>}
    {mode==='chat'&&<><p className="muted">复制有权使用的聊天文字，或选择存成文本文件（.txt / .md）的聊天记录。按原昵称填写双方角色；咔哒不会去翻聊天软件里存的记录，也不会自动读取其他会话。图片、语音和附件需另行整理。</p><div className="form-row"><Field label="客户昵称（每行一个）"><textarea rows={2} aria-label="客户昵称" value={customers} onChange={e=>setCustomers(e.target.value)} placeholder="聊天记录中对方的准确昵称"/></Field><Field label="我方昵称（每行一个）"><textarea rows={2} aria-label="我方昵称" value={staff} onChange={e=>setStaff(e.target.value)} placeholder="销售 / 顾问在聊天中的准确昵称"/></Field></div><p className="muted">支持「昵称：内容」及「昵称 日期 时间」后换行的记录；已有「客户：/客服：」标记可直接导入。角色不明时保留原文，避免把客户说法当成标准答案。</p></>}
    <Field label="资料文件" hint="PDF（文字版）、Word 文档、Excel 表格、表格文件（.csv）、文本（.txt / .md）、网页文件（.html）等。最多 5 个，单个 8MB。"><input aria-label="资料文件" type="file" accept={mode==='chat'?'.txt,.md':ACCEPT} multiple onChange={e=>choose(e.target.files)}/></Field>
    {files.length>0&&<p className="selected-files">已选择：{files.map(f=>f.name).join('、')} <button type="button" onClick={()=>setFiles([])}>清除选择</button></p>}
    {mode!=='chat'&&<p className="muted">PDF 会记下每段来自第几页，长文自动分段。扫描出来的 PDF（整页是图片）读不出文字，需要先用「识别图片里的文字」的工具转成文字版；读不出的页面会提示你。</p>}
    <Field label="资料名称（用于追溯粘贴内容）"><input aria-label="资料名称" maxLength={200} value={sourceName} onChange={e=>setSourceName(e.target.value)} placeholder="例如：培训服务问答、飞书销售手册"/></Field>
    <textarea aria-label="导入正文" rows={6} value={text} onChange={e=>setText(e.target.value)} placeholder={mode==='chat'?'客户昵称：…\n我方昵称：…':'粘贴产品说明、FAQ、知识库正文或业务规则…'}/>
    <div className="notice"><TriangleAlert size={16}/>文件只在这台电脑上读取。新资料要你确认后才会启用；启用后到「导入与试答」试一下。</div>
    <Button busy={busy} onClick={()=>void preview()}><Send size={16}/>生成导入预览</Button></div></section>;
}

export function ImportPreview({ preview, perform, busy, notify, onDone, onPreview, state }: PageProps & { preview: KnowledgeImportPreview; onDone: () => void; onPreview: (preview: KnowledgeImportPreview) => void }) {
  const [rows, setRows] = useState(preview.rows.map(row => ({ ...row, selected: !row.duplicateOf && !row.errors.length })));
  const [allowModel, setAllowModel] = useState(false);
  const [business, setBusiness] = useState('');
  const [market, setMarket] = useState('common');
  const [instructions, setInstructions] = useState(preview.organization?.workflow.instructions || '');
  const [workflowSaved, setWorkflowSaved] = useState(false);
  const [replacePrevious, setReplacePrevious] = useState(true);
  const [saving, setSaving] = useState('');
  const selected = rows.filter(r => r.selected && !r.errors.length);
  const edited = rows.some((r,i) => ['title','content','question','aliases','tags'].some(k => JSON.stringify(r[k as keyof KnowledgeImportRow]) !== JSON.stringify(preview.rows[i][k as keyof KnowledgeImportRow])));
  const organize = async () => {
    if (edited) return notify('预览已有手工修改，请先保存候选；智能整理使用原始预览，未覆盖你的修改。', true);
    const result = await perform<KnowledgeImportPreview>('POST', '/knowledge/import/organize', { previewId: preview.previewId, rowIds: selected.map(r=>r.rowId), allowModel });
    if (result) onPreview(result);
  };
  const saveWorkflow = async () => {
    if (!preview.organization || workflowSaved) return;
    const result = await perform('POST', '/workflows', { ...preview.organization.workflow, instructions, enabled: true }, '回复规则已保存。在回复设置选择这条工作流后生效。');
    if (result) setWorkflowSaved(true);
  };
  const validate = (row: KnowledgeImportRow) => ({ ...row, errors: [!row.title.trim() ? '标题不能为空' : '', !row.content.trim() ? '内容不能为空' : '', row.title.length > 200 ? '标题不能超过 200 字' : '', row.content.length > 20000 ? '内容不能超过 20,000 字' : ''].filter(Boolean) });
  const update = (index: number, patch: Partial<KnowledgeImportRow>) => setRows(current => current.map((row, i) => i === index ? { ...validate({ ...row, ...patch }), selected: 'selected' in patch ? Boolean((patch as { selected?: boolean }).selected) : row.selected } : row));
  const commit = async () => {
    const valid = rows.filter(row => row.selected && !row.errors.length); if (!valid.length) return notify('请至少选择一条无错误的候选。', true);
    const payload = valid.map(({ rowId, title, content, question, aliases, tags, scenario }) => ({ rowId, title, content, question, aliases, tags: [...(business.trim() ? [...tags.filter(t=>!/^(业务|business)[:：]/i.test(t)), ...split(business).map(t=>'业务:'+t)] : tags).filter(t=>!/^市场:/.test(t)), ...(market==='common'?[]:[market==='domestic'?'市场:国内':'市场:海外'])], scenario }));
    // More than 300 rows go in several batches of the same preview; nothing is dropped.
    let created = 0, skipped = 0, enabled = 0;
    try {
      for (let i = 0; i < payload.length; i += 300) {
        if (payload.length > 300) setSaving(`正在保存 ${Math.min(i + 300, payload.length)} / ${payload.length}…`);
        const result = await api<{ created: unknown[]; skipped: number; autoEnabled?: { approved: string[] } }>('POST', '/knowledge/import/commit', { previewId: preview.previewId, rows: payload.slice(i, i + 300), confirm: true, ...(preview.replaces?.length ? { replacePrevious } : {}) });
        created += result.created.length; skipped += result.skipped; enabled += result.autoEnabled?.approved.length ?? 0;
      }
    } catch (error) { setSaving(''); await perform('GET', '/state'); return notify(`${created ? `已保存 ${created} 条；` : ''}其余没有保存：${(error as Error).message}`, true); }
    setSaving(''); await perform('GET', '/state', undefined, `已保存 ${created} 条${enabled ? `，已自动启用 ${enabled} 条${created > enabled ? `，${created - enabled} 条等你审核` : ''}` : '知识候选，等待你审核'}${skipped ? `；${skipped} 条和已有内容相同，已跳过` : ''}`); onDone();
  };
  return <section className="panel import-preview"><div className="panel-head"><div><h2>导入预览 <span className="count-badge">{rows.length}</span></h2><p>可修改候选内容。来源在提交后只读，所有新知识默认停用、待审核。</p></div><Button busy={busy || !!saving} onClick={() => void commit()}>确认提交所选</Button></div>{saving && <p className="muted">{saving}</p>}{!!preview.replaces?.length && <label className="model-consent"><input type="checkbox" checked={replacePrevious} onChange={e => setReplacePrevious(e.target.checked)} />这份资料之前导入过，新内容审核后旧版本会停用（没变的内容继续使用）</label>}<div className="knowledge-organize"><Field label="这些资料属于哪个业务或产品？" hint="填一个名称，防止不同业务的报价混用。英文名可用 | 分隔。混合资料请分批导入。"><input maxLength={180} value={business} onChange={e=>setBusiness(e.target.value)} placeholder="例如：我的产品 | My Product"/></Field><Field label="这些资料适用于哪些客户？" hint="价格表请按市场分开导入，不要把两套报价放在同一条资料里。"><select value={market} onChange={e=>setMarket(e.target.value)}><option value="common">通用资料</option><option value="domestic">仅国内客户</option><option value="international">仅海外客户</option></select></Field><strong>让助手理解这些资料</strong><p>自动识别业务、客户常见问法、语气和回复规则。保留原文，补充便于检索的标题和相似问法；建议经你确认后使用。</p><div className="page-actions"><Button variant="secondary" disabled={busy} onClick={()=>setRows(current=>current.map((r,i)=>({...r,selected:i<20&&!r.duplicateOf&&!r.errors.length})))}>选择前20条</Button><Button variant="secondary" disabled={busy} onClick={()=>setRows(current=>current.map(r=>({...r,selected:false})))}>取消全选</Button><span>已选 {selected.length} 条</span></div><label className="model-consent"><input type="checkbox" checked={allowModel} disabled={busy} onChange={e=>setAllowModel(e.target.checked)}/>允许将所选资料发给已配置的回复模型（{state.provider.model}），产生模型费用</label>{!state.provider.hasKey&&<p className="muted">请先在系统设置中配置回复文字模型和密钥。仍可直接导入原文。</p>}{edited&&<p className="muted">预览已手工修改，智能整理暂不可用；可直接提交保留修改。</p>}<Button busy={busy} disabled={!allowModel||!state.provider.hasKey||!selected.length||selected.length>20||edited} onClick={()=>void organize()}><Sparkles size={15}/>智能整理所选资料（最多20条）</Button></div>{preview.organization&&<div className="knowledge-organization"><h3>业务识别与回复建议</h3><p>{preview.organization.summary}</p>{preview.organization.missing.length>0&&<><strong>需要补充或核对</strong><ul>{preview.organization.missing.map((m,i)=><li key={i}>{m}</li>)}</ul></>}<Field label={preview.organization.workflow.name} hint="核对并修改建议，保存后在消息回复设置选择对应工作流；不会自动改动当前正在使用的规则。"><textarea rows={7} value={instructions} disabled={busy||workflowSaved} onChange={e=>setInstructions(e.target.value)} maxLength={6000}/></Field><Button variant="secondary" busy={busy} disabled={workflowSaved||!instructions.trim()} onClick={()=>void saveWorkflow()}>{workflowSaved?'回复规则已保存':'确认并保存回复规则'}</Button></div>}{preview.warnings.filter(warning => !(preview.replaces?.length && warning.startsWith('这份资料之前导入过'))).map(warning => <div className="notice warning" key={warning}><TriangleAlert size={16} />{warning}</div>)}<div className="preview-list">{rows.map((row, index) => <article className={`preview-row ${row.errors.length ? 'has-errors' : ''}`} key={row.rowId}><label className="preview-select"><input type="checkbox" checked={row.selected} disabled={!!row.errors.length} onChange={e => update(index, { selected: e.target.checked } as never)} />选择</label><div className="preview-content"><div className="preview-meta">{row.source || '本地资料'} {row.sourceLocator || ''} {row.duplicateOf && <span className="subtle-badge amber">疑似重复，默认不选</span>} {row.errors.map(error => <span className="error-text" key={error}>{error}</span>)}</div><input value={row.title} onChange={e => update(index, { title: e.target.value })} aria-label="知识标题" /><textarea rows={3} value={row.content} onChange={e => update(index, { content: e.target.value })} aria-label="知识内容" /><div className="preview-fields"><input value={row.question || ''} placeholder="可检索问题" onChange={e => update(index, { question: e.target.value })} /><input value={(row.aliases || []).join('，')} placeholder="相似问法（| 或逗号分隔）" onChange={e => update(index, { aliases: split(e.target.value) })} /><input value={row.tags.join('，')} placeholder="标签（| 或逗号分隔）" onChange={e => update(index, { tags: split(e.target.value) })} /></div></div></article>)}</div></section>;
}
