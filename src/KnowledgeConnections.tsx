import { useEffect, useState } from 'react';
import type { PageProps } from './App';
import type { KnowledgeImportPreview } from '../shared/knowledge';
import { api } from './api';
import { Button, Field } from './components';
type Status={persistent:boolean;feishu:boolean;notion:boolean};
export default function KnowledgeConnections({perform,busy,notify,onPreview}:PageProps&{onPreview(p:KnowledgeImportPreview):void}){
  const [kind,setKind]=useState<'feishu'|'notion'>('feishu'),[status,setStatus]=useState<Status>();
  const [appId,setId]=useState(''),[secret,setSecret]=useState(''),[url,setUrl]=useState(''),[working,setWorking]=useState(false);
  const load=()=>api<Status>('GET','/knowledge/connections').then(setStatus);
  useEffect(()=>{void load().catch(e=>notify(e.message,true));},[]);
  const save=async()=>{setWorking(true);try{await api('PUT','/knowledge/connections',{kind,...(kind==='feishu'?{appId,appSecret:secret}:{token:secret})});setSecret('');await load();notify('凭据已保存。下一步粘贴文档链接，读取成功后才算连接验证通过。');}catch(e){notify((e as Error).message,true);}finally{setWorking(false);}};
  return <section className="panel knowledge-intake"><div className="intake-body"><h2>连接在线知识库</h2><p>选平台 → 设置只读权限 → 粘贴文档链接 → 读取预览 → 核对后启用。</p>
    <Field label="知识库平台"><select disabled={working||busy} value={kind} onChange={e=>{setKind(e.target.value as typeof kind);setId('');setSecret('');setUrl('');}}><option value="feishu">飞书知识库 / 云文档</option><option value="notion">Notion</option></select></Field>
    <details open><summary>第一次连接怎么设置？</summary>{kind==='feishu'?<ol><li>请企业管理员在飞书开放平台创建企业自建应用，获取 App ID 和 App Secret。</li><li>给应用开通文档内容只读权限；知识库链接还需读取知识库节点权限，发布应用。</li><li>在要导入的文档 / 知识库中添加此应用的阅读权限。能在浏览器打开，不等于应用有权读取。</li><li>下方保存凭据，复制 /docx/ 或 /wiki/ 文档链接并读取。不支持的旧文档、表格可先导出文件。</li></ol>:<ol><li>在 Notion 的开发者连接设置中创建内部连接，只需读取内容权限，复制连接密钥。</li><li>打开要导入的页面，在页面菜单的 Connections 中添加刚创建的连接。</li><li>下方保存密钥，粘贴该页面链接并读取。子页面需分别选择；数据库请导出 CSV。</li></ol>}</details>
    <p className="muted">{status?.[kind]?'已保存连接凭据；读取文档可验证权限。':'还未保存连接凭据。'}{status?.persistent?'桌面端加密保存，工作区备份不含凭据。':'浏览器服务仅在本次运行期间保存凭据。'}</p>
    {kind==='feishu'&&<Field label="App ID（应用凭证页复制）"><input value={appId} autoComplete="off" onChange={e=>setId(e.target.value)} placeholder="cli_…"/></Field>}
    <Field label={kind==='feishu'?'App Secret（应用密钥）':'Notion 连接密钥'}><input type="password" autoComplete="new-password" value={secret} onChange={e=>setSecret(e.target.value)} placeholder="只填写在这里，不用发给客服"/></Field>
    <div className="page-actions"><Button busy={working} disabled={busy||!secret.trim()||(kind==='feishu'&&!appId.trim())} onClick={()=>void save()}>保存连接凭据</Button>{status?.[kind]&&<Button variant="secondary" disabled={working||busy} onClick={async()=>{setWorking(true);try{await api('DELETE','/knowledge/connections',{kind});await load();notify('连接凭据已删除，已导入资料仍保留。');}catch(e){notify((e as Error).message,true);}finally{setWorking(false);}}}>断开连接</Button>}</div>
    <Field label="要导入的文档链接" hint="只读取你选择的这篇文档，不会扫描整个账号。"><input type="url" value={url} maxLength={1000} disabled={working||busy} onChange={e=>setUrl(e.target.value)} placeholder={kind==='feishu'?'https://企业.feishu.cn/wiki/…':'https://www.notion.so/…'}/></Field>
    <Button busy={busy} disabled={working||!status?.[kind]||!url.trim()} onClick={async()=>{const result=await perform<KnowledgeImportPreview>('POST','/knowledge/connections/preview',{kind,url});if(result)onPreview(result);}}>读取文档并预览</Button>
    <p className="muted">目前为手动读取快照，源文档更新后请重新读取并核对旧知识；图片与附件不会自动识别。百度网盘、阿里云盘、Google Drive、OneDrive 可从“连接网盘”进入授权与文件选择，需先配置获批应用。</p>
  </div></section>;
}
