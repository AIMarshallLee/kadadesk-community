/** Read-only, explicitly selected documents. Credentials never enter workspace exports. */
export type ConnectorKind = 'feishu' | 'notion';
export interface ConnectorCredential { token?: string; appId?: string; appSecret?: string }
export interface ConnectorSecrets { get(): Promise<string | undefined>; set(value:string): Promise<void>; delete():Promise<void> }
export function connectorKind(value:unknown):ConnectorKind { if(value==='feishu'||value==='notion')return value;throw Error('请选择飞书或 Notion。'); }
export function connectorCredential(kind:ConnectorKind, input:Record<string,unknown>):ConnectorCredential {
  const field=(name:string)=>{const v=input[name];if(typeof v!=='string'||!v.trim()||v.length>2000||/[\r\n]/.test(v))throw Error('请完整填写连接凭据。');return v.trim();};
  return kind==='notion'?{token:field('token')}:{appId:field('appId'),appSecret:field('appSecret')};
}
export function documentReference(kind:ConnectorKind, value:unknown) {
  if(typeof value!=='string'||value.length>1000)throw Error('请粘贴文档链接。');
  let url:URL;try{url=new URL(value);}catch{throw Error('请粘贴完整的 HTTPS 文档链接。');}
  if(url.protocol!=='https:'||url.username||url.password||url.port)throw Error('文档链接必须使用 HTTPS，不能包含登录凭据。');
  if(kind==='feishu'){
    if(!/(^|\.)feishu\.cn$/i.test(url.hostname))throw Error('请使用飞书文档或知识库节点链接。');
    const m=/^\/(docx|wiki)\/([a-zA-Z0-9]+)\/?$/.exec(url.pathname);if(!m)throw Error('目前支持飞书新版文档及知识库内的文档；表格请导出后导入。');
    return {id:m[2],type:m[1],url:url.origin+url.pathname};
  }
  if(!/(^|\.)(notion\.so|notion\.site)$/i.test(url.hostname))throw Error('请使用 Notion 页面链接。');
  const m=/([a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\/?$/i.exec(url.pathname);if(!m)throw Error('页面链接中没有找到 Notion 页面 ID。');
  return {id:m[1],type:'page',url:url.origin+url.pathname};
}
export async function readConnectedDocument(kind:ConnectorKind, credential:ConnectorCredential, reference:unknown, fetchImpl:typeof fetch=fetch) {
  const ref=documentReference(kind,reference), signal=AbortSignal.timeout(45000);
  let calls=0, characters=0;
  async function json(url:string,init:RequestInit={}) {
    if(++calls>100)throw Error('文档层级或分页过多，请分成较小页面导入。');
    let response:Response;
    try{response=await fetchImpl(url,{...init,redirect:'error',signal});}catch{throw Error('连接超时或网络不可用，请检查网络后重试。');}
    if(!response.ok)throw Error(response.status===401?'凭据无效或已过期，请重新连接。':response.status===403||response.status===404?'无权读取此文档，请给应用添加此页面的阅读权限后重试。':response.status===429?'服务商暂时限流，请稍后再试。':`知识库服务请求失败（HTTP ${response.status}）。`);
    const reader=response.body?.getReader();if(!reader)throw Error('知识库返回空响应。');
    let size=0;const chunks:Uint8Array[]=[];
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024)throw Error('文档响应过大，请拆分后导入。');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
    try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('知识库返回内容无法解析。');}
  }
  function append(text:string,lines:string[]){characters+=text.length;if(characters>500000)throw Error('文档超过 50 万字，请拆分后导入。');if(text.trim())lines.push(text);}
  if(kind==='feishu'){
    const auth=await json('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({app_id:credential.appId,app_secret:credential.appSecret})});
    if(auth.code!==0||typeof auth.tenant_access_token!=='string')throw Error('飞书应用凭据无效，请检查 App ID、App Secret 及应用发布状态。');
    const headers={Authorization:`Bearer ${auth.tenant_access_token}`};let docId=ref.id;
    if(ref.type==='wiki'){
      const result=await json(`https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=${encodeURIComponent(ref.id)}`,{headers});
      if(result.code!==0)throw Error('无法读取知识库节点，请给应用添加知识库与文档阅读权限。');
      if(result.data?.node?.obj_type!=='docx')throw Error('该节点不是新版文档；表格或旧版文档请导出后导入。');
      docId=result.data.node.obj_token;
    }
    if(typeof docId!=='string'||!/^[a-zA-Z0-9]+$/.test(docId))throw Error('飞书返回的文档 ID 无效。');
    const result=await json(`https://open.feishu.cn/open-apis/docx/v1/documents/${docId}/raw_content`,{headers});
    if(result.code!==0||typeof result.data?.content!=='string')throw Error('无法读取正文，请检查文档分享和应用的文档只读权限。');
    const lines:string[]=[];append(result.data.content,lines);if(!lines.length)throw Error('文档没有可导入的文字。');
    return {text:lines.join('\n'),source:'飞书文档',url:ref.url,warnings:['读取所选文档的文字；图片、附件及其他节点未导入。']};
  }
  const lines:string[]=[],warnings=new Set<string>(),visited=new Set<string>();
  const headers={Authorization:`Bearer ${credential.token}`,'Notion-Version':'2022-06-28'};
  async function walk(id:string,depth:number){
    if(depth>15)throw Error('页面层级超过 15 层，请分开导入。');if(visited.has(id))throw Error('页面结构循环，请选择较小的页面。');visited.add(id);
    let cursor:string|undefined;const cursors=new Set<string>();
    do{
      const result=await json(`https://api.notion.com/v1/blocks/${encodeURIComponent(id)}/children?page_size=100${cursor?'&start_cursor='+encodeURIComponent(cursor):''}`,{headers});
      if(!Array.isArray(result.results))throw Error('Notion 页面结构无效。');
      for(const block of result.results){
        const content=block[block.type];
        if(block.type==='child_page'||block.type==='child_database'){warnings.add('子页面与数据库未递归导入，请分别选择页面或导出表格。');continue;}
        const text=(value:any)=>Array.isArray(value)?value.map(v=>typeof v.plain_text==='string'?v.plain_text:typeof v.text?.content==='string'?v.text.content:'').join(''):'';
        append(text(content?.rich_text),lines);
        if(block.type==='table_row'&&Array.isArray(content?.cells))append(content.cells.map(text).join(' | '),lines);
        if(['image','file','pdf','video','audio','embed','unsupported'].includes(block.type))warnings.add('页面中的图片、附件或嵌入内容未转成文字。');
        if(block.has_children){if(typeof block.id!=='string')throw Error('Notion 返回无效内容块。');await walk(block.id,depth+1);}
      }
      cursor=result.has_more?result.next_cursor:undefined;if(result.has_more&&(!cursor||cursors.has(cursor)))throw Error('Notion 分页异常，请稍后重试。');if(cursor)cursors.add(cursor);
    }while(cursor);
  }
  await walk(ref.id,0);if(!lines.length)throw Error('页面没有可导入的正文；请检查权限，数据库请导出为表格。');
  return {text:lines.join('\n\n'),source:'Notion 页面',url:ref.url,warnings:[...warnings]};
}
