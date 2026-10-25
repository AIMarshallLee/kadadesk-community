import test from 'node:test';
import assert from 'node:assert/strict';
import {parseKnowledgeImport,parseChatTranscript} from './knowledge-import';
import {htmlKnowledgeText} from './knowledge-html';
import {publicKnowledgeUrl,publicV4} from './knowledge-web';
const file=(name:string,text:string)=>({name,size:Buffer.byteLength(text),base64:Buffer.from(text).toString('base64')});

test('中文Windows文本编码可预览，聊天长问题不因标题200字限制失败',async()=>{
 const utf16=Buffer.concat([Buffer.from([255,254]),Buffer.from('客户：怎么合作？\n客服：先确认业务需求。','utf16le')]);
 const p=await parseKnowledgeImport({files:[{name:'记录.txt',size:utf16.length,base64:utf16.toString('base64')}],textKind:'chat'});
 assert.equal(p.rows[0].content,'先确认业务需求。');
 const gbk=Buffer.from([0xd6,0xd0,0xce,0xc4]);
 const g=await parseKnowledgeImport({files:[{name:'资料.txt',size:gbk.length,base64:gbk.toString('base64')}]});
 assert.equal(g.rows[0].content,'中文');assert.match(g.warnings[0],/GB18030/);
 const long='长问题'.repeat(120);const c=parseChatTranscript(`客户：${long}\n客服：完整答复`);
 assert.equal(c.rows[0].question,long);assert.ok(c.rows[0].title.length<=200);
});

test('同一标题下文档分段有独立标题，可审核且不丢后文',async()=>{
 const p=await parseKnowledgeImport({text:'# 服务范围\n'+('业务资料'.repeat(500))+'\n\n退款需确认交付情况。'});
 assert.ok(p.rows.length>1);assert.equal(new Set(p.rows.map(r=>r.title)).size,p.rows.length);
 assert.match(p.rows.at(-1)!.content,/退款需确认/);
 await assert.rejects(parseKnowledgeImport({textKind:'chat',files:[null as any]}),/文件项无效/);
});

test('聊天软件昵称和时间标题映射后只把我方回答作为候选答案；文件和粘贴一致',async()=>{
 const text='小张 2026-09-24 09:00:00\n资料怎么整理？\n顾问 2026-09-24 09:01:00\n先整理已授权的业务样本。';
 const roles={customers:['小张'],staff:['顾问']};
 const pasted=await parseKnowledgeImport({text,textKind:'chat',chatRoles:roles});
 const uploaded=await parseKnowledgeImport({files:[file('聊天软件.txt',text)],textKind:'chat',chatRoles:roles});
 assert.equal(pasted.rows[0].question,'资料怎么整理？');assert.equal(uploaded.rows[0].content,'先整理已授权的业务样本。');
 assert.throws(()=>parseChatTranscript(text,'聊天',{customers:['顾问'],staff:['顾问']}),/不能同时/);
});
test('未知参与者不拼入客服答案，保留原始昵称和文字',()=>{
 const text='小张：多少钱\n顾问：还需确认范围\n路人：免费送';
 const result=parseChatTranscript(text,'聊天',{customers:['小张'],staff:['顾问']});
 assert.ok(result.warnings.length);assert.ok(result.rows.every(r=>!r.question));assert.equal(result.rows[0].content,text);
});
test('长篇文档完整分段，后部例外条款仍保留，代理字符不损坏',async()=>{
 const text='内容🚀'.repeat(800)+'【例外条款】';
 const result=await parseKnowledgeImport({files:[file('手册.md',text)]});
 assert.ok(result.rows.length>1);assert.equal(result.rows.map(r=>r.content).join(''),text);
 assert.ok(result.rows.every(r=>Array.from(r.content).length<=1600));
});
test('HTML 导出只提取正文和表格，不执行脚本或读取链接',async()=>{
 const html='<html><nav>无关导航</nav><main><h1>服务范围</h1><p>先确认业务场景，再整理已授权的样本。</p><script>sendSecrets()</script><table><tr><td>交付</td><td>流程说明与验收记录</td></tr></table><div hidden>隐藏诱导</div></main></html>';
 const result=await parseKnowledgeImport({files:[file('Notion.html',html)]});
 const text=result.rows.map(r=>r.content).join('');assert.match(text,/验收记录/);assert.doesNotMatch(text,/sendSecrets|隐藏诱导|无关导航/);
 assert.throws(()=>htmlKnowledgeText('<body><input type="password"><p>请登录</p></body>'),/需要登录/);
 assert.throws(()=>htmlKnowledgeText('<html><div id="root"></div><script>render()</script></html>'),/没有足够/);
});
test('公开知识链接拒绝凭据、内网 IP、其他协议及令牌参数',()=>{
 for(const url of ['http://example.com','https://127.0.0.1','https://user:pass@example.com','https://example.com:8443','https://host.local/a','https://example.com/?access_token=secret','file:///C:/a'])assert.throws(()=>publicKnowledgeUrl(url));
 assert.equal(publicKnowledgeUrl('https://example.com/doc#section').href,'https://example.com/doc');
 for(const ip of ['127.0.0.1','10.0.0.1','192.168.1.1','172.20.0.1','100.100.100.200','169.254.169.254','0.0.0.0','::1','::ffff:127.0.0.1'])assert.equal(publicV4(ip),false);
 assert.equal(publicV4('8.8.8.8'),true);
});
