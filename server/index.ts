import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createMomentsOperations } from './moments-campaign.ts';
import { ApiError } from './autopilot.ts';
import { isAllowedRequest } from '../desktop/guards.ts';

const dist = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const mime = (name:string) => name.endsWith('.js') ? 'text/javascript; charset=utf-8'
  : name.endsWith('.css') ? 'text/css; charset=utf-8'
  : name.endsWith('.svg') ? 'image/svg+xml'
  : name.endsWith('.woff2') ? 'font/woff2'
  : 'application/octet-stream';
const MAX_JSON = 5_700_000;
function fail(res:ServerResponse,code:number,message:string) {
  res.writeHead(code, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
  res.end(JSON.stringify({error:message}));
}
async function parseJson(req:IncomingMessage) {
  if (!String(req.headers['content-type']??'').startsWith('application/json')) throw new ApiError(415,'仅支持 JSON 请求');
  let size=0;const chunks:Buffer[]=[];
  for await (const chunk of req) {
    size+=chunk.length;
    if (size>MAX_JSON) throw new ApiError(413,'请求正文过大');
    chunks.push(Buffer.from(chunk));
  }
  if(!size)return {};
  let input:unknown;
  try { input=JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch {throw new ApiError(400,'JSON 请求格式无效');}
  if(!input || typeof input!=='object' || Array.isArray(input))throw new ApiError(400,'请输入 JSON 对象');
  return input as Record<string,unknown>;
}
export async function createLocalServer(options:{dataDir:string;port?:number}) {
  await mkdir(options.dataDir,{recursive:true,mode:0o700});
  const moments=await createMomentsOperations(options.dataDir);
  const token=randomBytes(32).toString('hex');
  let activePort=0;
  const server=createServer(async(req,res)=>{
    try {
      const host=req.headers.host;
      if(!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host) || host!==`127.0.0.1:${activePort}`)
        return fail(res,403,'只允许通过本机 127.0.0.1 访问');
      const origin=req.headers.origin;
      if(origin && origin!==`http://127.0.0.1:${activePort}`)return fail(res,403,'已阻止跨站来源');
      const pathname=new URL(req.url??'/',`http://127.0.0.1:${activePort}`).pathname;
      res.setHeader('cache-control','no-store');
      res.setHeader('x-content-type-options','nosniff');
      res.setHeader('x-frame-options','DENY');
      res.setHeader('referrer-policy','no-referrer');
      res.setHeader('content-security-policy',"default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; connect-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:");
      if(pathname.startsWith('/api/')) {
        if(req.headers['x-kadadesk-token']!==token)return fail(res,403,'本地会话已失效，请刷新工作台');
        const path=pathname.slice('/api'.length);
        if(path!=='/moments'&&!path.startsWith('/moments/'))return fail(res,404,'接口不存在');
        const method=(req.method||'GET').toUpperCase();
        if(!['GET','POST','PUT'].includes(method))return fail(res,405,'不支持该方法');
        if(!isAllowedRequest({method,path}))return fail(res,404,'接口不存在');
        const body=method==='GET'?{}:await parseJson(req);
        const result=await moments.handle(method,path,body);
        res.writeHead(200,{'content-type':'application/json; charset=utf-8'});
        return res.end(JSON.stringify(result));
      }
      if(req.method!=='GET'&&req.method!=='HEAD')return fail(res,405,'仅支持 GET');
      let file:string;
      if(pathname==='/' || pathname==='/index.html')file=join(dist,'index.html');
      else if(/^\/assets\/[a-zA-Z0-9_.-]+$/.test(pathname)) file=join(dist,pathname);
      else return fail(res,404,'文件不存在');
      const data=await readFile(file);
      if(pathname==='/'||pathname==='/index.html') {
        const html=data.toString('utf8').replace('</head>',`<meta name="api-token" content="${token}"></head>`);
        res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
        return res.end(req.method==='HEAD'?'':html);
      }
      res.writeHead(200,{'content-type':mime(file)});
      return res.end(req.method==='HEAD'?'':data);
    }catch(e) {
      const code=e instanceof ApiError?e.status:500;
      if (code===500)console.error('[local-workspace]',(e as Error).message);
      if (!res.headersSent)fail(res,code,code===500?'本地处理失败，请查看终端日志':(e as Error).message);
      else res.end();
    }
  });
  await new Promise<void>((accept,reject)=>{
    server.once('error',reject);
    server.listen(options.port??0,'127.0.0.1',()=>{server.off('error',reject);accept();});
  });
  const address=server.address();
  if(!address||typeof address==='string')throw Error('未获得本机端口');
  activePort=address.port;
  return {url:`http://127.0.0.1:${activePort}`,port:activePort,server,token,close:()=>new Promise<void>((ok,bad)=>server.close(err=>err?bad(err):ok()))};
}
if(process.argv[1] && resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))) {
  const dataDir=process.env.KADADESK_COMMUNITY_DATA_DIR || join(homedir(),'.kadadesk-community');
  const app=await createLocalServer({dataDir,port:process.env.PORT?Number(process.env.PORT):0});
  console.log('KADAdesk Community · 内容发布工作台');
  console.log('Open in your browser: '+app.url);
  console.log('Data stored locally in: '+dataDir);
  console.log('No social platform account is logged in or posted to automatically.');
  const end=async()=>{await app.close();process.exit(0);};
  process.once('SIGINT',()=>void end());process.once('SIGTERM',()=>void end());
}
