import { request } from 'node:https';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import type { KnowledgeImportFile } from '../shared/knowledge';

const blocked = new BlockList();
for (const [ip, bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]] as const) blocked.addSubnet(ip,bits);
export const publicV4 = (ip: string) => isIP(ip) === 4 && !blocked.check(ip);
export function publicKnowledgeUrl(raw: unknown): URL {
  if (typeof raw !== 'string' || raw.length > 300) throw Error('知识链接需为不超过 300 字符的公开 HTTPS 地址。');
  let url: URL; try { url = new URL(raw); } catch { throw Error('知识链接格式无效。'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || isIP(url.hostname) || !url.hostname.includes('.') || /(^|\.)(localhost|local|internal|lan)$/.test(url.hostname)) throw Error('仅支持公开网站的 HTTPS 链接，不支持本机、内网或带登录凭据的地址。');
  if ([...url.searchParams.keys()].some(k => /token|secret|password|api.?key|signature|credential/i.test(k))) throw Error('请使用不含访问令牌的公开链接，或下载文件后导入。');
  url.hash = ''; return url;
}

/** Resolve once and pin the validated address to the TLS connection; redirects repeat validation. */
export async function downloadPublicKnowledge(raw: unknown): Promise<{file: KnowledgeImportFile; url: string}> {
  let url = publicKnowledgeUrl(raw); const signal = AbortSignal.timeout(20000);
  for (let redirect = 0; redirect <= 3; redirect++) {
    signal.throwIfAborted();
    const addresses = await Promise.race([lookup(url.hostname,{all:true,family:4}), new Promise<never>((_,reject) => {
      if(signal.aborted) reject(Error('读取链接超时。')); else signal.addEventListener('abort',()=>reject(Error('读取链接超时。')),{once:true});
    })]);
    if (!addresses.length || addresses.some(a => !publicV4(a.address))) throw Error('该链接未解析到允许的公网地址。');
    const result = await new Promise<{redirect?: string; bytes?: Buffer; mime?: string}>((resolve,reject) => {
      const req = request(url,{method:'GET',signal,headers:{Accept:'text/html,text/plain,text/markdown,application/pdf','Accept-Encoding':'identity','User-Agent':'FlowDesk-Knowledge/1.0'}, lookup: ((_host: unknown, opts: any, cb: any) => opts?.all ? cb(null,[{address:addresses[0].address,family:4}]) : cb(null,addresses[0].address,4)) as any}, res => {
        if([301,302,303,307,308].includes(res.statusCode ?? 0)){res.destroy();resolve({redirect:res.headers.location});return;}
        if(res.statusCode!==200){res.destroy();reject(Error('链接无法公开读取，请在原平台导出文件或复制正文后导入。'));return;}
        const mime=(res.headers['content-type']||'').split(';')[0].trim().toLowerCase();
        if(!['text/html','text/plain','text/markdown','application/pdf','application/xhtml+xml'].includes(mime) || (res.headers['content-encoding'] && res.headers['content-encoding']!=='identity')){res.destroy();reject(Error('链接未返回支持的正文格式，请下载 PDF、Word 或 Markdown 文件后导入。'));return;}
        const chunks: Buffer[]=[];let size=0;
        res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>8*1024*1024){res.destroy(Error('线上文件超过 8MB，请拆分后导入。'));return;}chunks.push(chunk);});
        res.on('error',reject);res.on('end',()=>resolve({bytes:Buffer.concat(chunks),mime}));
      });req.on('error',()=>reject(Error('读取公开链接失败或超时，请检查网络，或使用文件导入。')));req.end();
    });
    if(result.redirect){if(redirect===3)throw Error('链接跳转过多，请使用最终正文链接。');url=publicKnowledgeUrl(new URL(result.redirect,url).href);continue;}
    if(!result.bytes?.length)throw Error('链接未返回可读取的正文。');
    const ext=result.mime==='application/pdf'?'pdf':result.mime?.includes('html')?'html':result.mime==='text/markdown'?'md':'txt';
    return {file:{name:`${url.hostname.slice(0,120)}.${ext}`,size:result.bytes.length,base64:result.bytes.toString('base64')},url:url.href};
  }
  throw Error('链接跳转过多。');
}
