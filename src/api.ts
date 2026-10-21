const token=()=>document.querySelector<HTMLMetaElement>('meta[name="api-token"]')?.content || '';
export async function api<T=any>(method:string,path:string,body?:unknown):Promise<T> {
  if (!/^\/moments(?:\/|$)/.test(path)) throw new Error('Unsupported community route');
  const result=await fetch('/api'+path,{
    method,
    headers:{'x-kadadesk-token':token(),...(body === undefined ? {} : {'content-type':'application/json'})},
    ...(body === undefined ? {} : {body:JSON.stringify(body)}),
    credentials:'same-origin',
  });
  const parsed=await result.json().catch(()=>null);
  if (!result.ok) throw new Error(parsed?.error || ('请求失败：'+result.status));
  return parsed as T;
}
export async function copyText(content:string):Promise<void> {
  if(!navigator.clipboard?.writeText) throw new Error('浏览器无法使用剪贴板，请使用 HTTPS/本机地址，或手工复制');
  await navigator.clipboard.writeText(content);
}
