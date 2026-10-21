// Standalone community API allowlist. No USB, private KADAdesk bridge or sender.
export function isAllowedRequest(value:unknown):boolean {
 if(!value||typeof value!=='object')return false;
 const r=value as {method?:unknown;path?:unknown};
 if(typeof r.method!=='string'||typeof r.path!=='string')return false;
 const m=r.method.toUpperCase(),p=r.path;
 if(m==='GET')return p==='/moments'||/^\/moments\/assets\/[a-f0-9-]+$/.test(p);
 if(m==='POST')return /^\/moments\/(accounts|assets|content|campaigns|accounts\/batch)$/.test(p)||
   /^\/moments\/jobs\/[^/]+\/(approve|handoff|report|verify|resolve-unknown)$/.test(p);
 if(m==='PUT')return /^\/moments\/(accounts|content|jobs)\/[^/]+$/.test(p);
 return false;
}
