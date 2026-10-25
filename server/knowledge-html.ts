import { parse } from 'parse5';

/** Web pages need a minimum body and no login form; local Word files pass `{ document: true }` and keep short texts. */
export function htmlKnowledgeText(html: string, options: { document?: boolean } = {}): string {
  const doc = parse(html); const excluded = new Set(['script','style','noscript','template','svg','nav','footer','header','form','button','iframe']);
  const children = (n: any): any[] => n.childNodes ?? [];
  const find = (n: any, tag: string): any => n.tagName === tag ? n : children(n).map(c=>find(c,tag)).find(Boolean);
  const password = (n: any): boolean => n.tagName==='input' && n.attrs?.some((a:any)=>a.name==='type'&&a.value==='password') || children(n).some(password);
  if(!options.document&&password(doc))throw Error('该页面需要登录，请从原知识库导出文件或复制正文后导入。');
  const root = options.document ? find(doc,'body') || doc : find(doc,'article') || find(doc,'main') || find(doc,'body') || doc;
  function walk(n: any): string {
    if(n.nodeName==='#text')return n.value;
    if(excluded.has(n.tagName) || n.attrs?.some((a:any)=>a.name==='hidden'||a.name==='aria-hidden'&&a.value==='true'))return '';
    if(n.tagName==='br')return '\n';
    const value=children(n).map(walk).join('');
    if(/^h[1-6]$/.test(n.tagName))return `\n\n# ${value.trim()}\n\n`;
    return /^(p|div|section|article|main|li|tr|blockquote|pre|table|ul|ol)$/.test(n.tagName)?`\n\n${value}\n\n`:n.tagName==='td'||n.tagName==='th'?`${value} | `:value;
  }
  const text=walk(root).replace(/[\t ]+\n/g,'\n').replace(/\n[\t ]+/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  if(!options.document&&text.length<30)throw Error('页面没有足够的可读取正文，可能需要登录或动态加载；请导出文件或复制正文。');
  return text;
}
