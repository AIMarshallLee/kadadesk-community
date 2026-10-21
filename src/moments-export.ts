// Small dependency-free, uncompressed ZIP builder for user-initiated local handoff.
// Images are already compressed. No network send, remote sync or session access.
const encoder = new TextEncoder();
function crc32(data: Uint8Array) {
  let c = 0xffffffff;
  for (const b of data) {
    c ^= b;
    for (let i=0;i<8;i++) c = (c>>>1) ^ ((c&1) ? 0xedb88320 : 0);
  }
  return (c^0xffffffff)>>>0;
}
function header(length: number) { return new Uint8Array(length); }
function put16(v: DataView, o:number,n:number) {v.setUint16(o,n,true);}
function put32(v: DataView, o:number,n:number) {v.setUint32(o,n,true);}
export function handoffZip(files: {name:string;bytes:Uint8Array}[]) {
  if (!files.length || files.length>12) throw Error('导出文件数无效');
  const locals: Uint8Array[] = [], central: Uint8Array[]=[];
  let offset=0;
  for (const f of files) {
    if (!f.name || f.name.includes('/') || f.name.includes('\\') || f.name==='.' || f.name==='..') throw Error('文件名称不安全');
    const name=encoder.encode(f.name);
    if (name.length>220 || f.bytes.length>4*1024*1024+4096) throw Error('单文件超出打包限制');
    const crc=crc32(f.bytes);
    const local=header(30+name.length),l=new DataView(local.buffer);
    put32(l,0,0x04034b50);put16(l,4,20);put16(l,6,0x0800);
    put16(l,8,0);put16(l,10,0);put16(l,12,0);
    put32(l,14,crc);put32(l,18,f.bytes.length);put32(l,22,f.bytes.length);
    put16(l,26,name.length);put16(l,28,0);local.set(name,30);
    locals.push(local,f.bytes); // V1: STORE, no compression, preserving image bytes
    const cd=header(46+name.length),d=new DataView(cd.buffer);
    put32(d,0,0x02014b50);put16(d,4,20);put16(d,6,20);put16(d,8,0x0800);
    put16(d,10,0);put16(d,12,0);put16(d,14,0);
    put32(d,16,crc);put32(d,20,f.bytes.length);put32(d,24,f.bytes.length);
    put16(d,28,name.length);put16(d,30,0);put16(d,32,0);
    put16(d,34,0);put16(d,36,0);put32(d,38,0);put32(d,42,offset);
    cd.set(name,46);central.push(cd);
    offset+=local.length+f.bytes.length;
  }
  const dirLength=central.reduce((n,x)=>n+x.length,0);
  const end=header(22),e=new DataView(end.buffer);
  put32(e,0,0x06054b50);put16(e,4,0);put16(e,6,0);
  put16(e,8,files.length);put16(e,10,files.length);
  put32(e,12,dirLength);put32(e,16,offset);put16(e,20,0);
  return new Blob([...locals,...central,end] as BlobPart[],{type:'application/zip'});
}
export function imageBytes(dataUrl:string):Uint8Array {
  if (!/^data:image\/(png|jpeg|webp);base64,/.test(dataUrl)) throw Error('图片格式不可导出');
  const raw=atob(dataUrl.slice(dataUrl.indexOf(',')+1));
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
export function safeName(name:string) {return name.replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,100)||'file';}
export function textBytes(s:string) {return encoder.encode(s);}
