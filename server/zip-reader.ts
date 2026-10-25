import { inflateRawSync } from 'node:zlib';
import * as zlib from 'node:zlib';

/**
 * A small ZIP reader for 「把压缩包拖进来」: central directory first, stored and deflate entries only.
 * Nothing is written to disk; names are only labels, and every size is checked before and after inflating.
 */
export interface ZipLimits { entries: number; entryBytes: number; totalBytes: number; ratio: number }
export const DEFAULT_ZIP_LIMITS: ZipLimits = { entries: 5000, entryBytes: 8 * 1024 * 1024, totalBytes: 64 * 1024 * 1024, ratio: 200 };
export interface ZipEntry { path: string; size: number; compressedSize: number; method: number; encrypted: boolean; offset: number }
export interface ZipFile { path: string; bytes: Buffer }
export interface ZipSkip { path: string; reason: string }

export class ZipError extends Error {}
const fail = (message: string): never => { throw new ZipError(message); };

const utf8 = new TextDecoder('utf-8', { fatal: true });
let gbk: TextDecoder | undefined;
try { gbk = new TextDecoder('gbk'); } catch { gbk = undefined; }
/** Names without the UTF-8 flag are usually GBK on Chinese Windows; valid UTF-8 is tried first. */
function decodeName(bytes: Uint8Array, flagged: boolean) {
  if (flagged) return Buffer.from(bytes).toString('utf8');
  try { return utf8.decode(bytes); } catch { /* not UTF-8 */ }
  return gbk ? gbk.decode(bytes) : Buffer.from(bytes).toString('latin1');
}

/** Directory entries, or null for a path that would escape the archive or names nothing (zip-slip, drive letters). */
export function safeZipPath(name: string): string | null {
  const path = name.replaceAll('\\', '/');
  if (path.startsWith('/') || /^[a-z]:/i.test(path) || path.includes('\0')) return null;
  const parts = path.split('/').filter(part => part && part !== '.');
  if (!parts.length || parts.some(part => part === '..')) return null;
  return parts.join('/');
}

/** Lists the entries of the central directory. Rejects ZIP64 and archives larger than the limits allow. */
export function listZip(data: Buffer, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipEntry[] {
  if (data.length < 22 || data.readUInt32LE(0) !== 0x04034b50 && data.readUInt32LE(0) !== 0x06054b50) fail('这不是有效的 ZIP 压缩包。');
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 0xffff); i--) if (data.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) fail('压缩包不完整（找不到目录），请重新下载或重新压缩。');
  const disk = data.readUInt16LE(eocd + 4), count = data.readUInt16LE(eocd + 10), size = data.readUInt32LE(eocd + 12), offset = data.readUInt32LE(eocd + 16);
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff || (eocd >= 20 && data.readUInt32LE(eocd - 20) === 0x07064b50)) fail('这个压缩包太大（ZIP64 格式），请解压后直接拖文件夹进来。');
  if (disk !== 0) fail('不支持分卷压缩包，请合并后再导入。');
  if (count > limits.entries) fail(`压缩包里超过 ${limits.entries} 个文件，请解压后挑业务资料文件夹拖进来。`);
  if (offset + size > eocd) fail('压缩包目录无效，请重新下载或重新压缩。');
  const entries: ZipEntry[] = [];
  let p = offset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > eocd || data.readUInt32LE(p) !== 0x02014b50) fail('压缩包目录无效，请重新下载或重新压缩。');
    const flags = data.readUInt16LE(p + 8), method = data.readUInt16LE(p + 10);
    const compressedSize = data.readUInt32LE(p + 20), uncompressed = data.readUInt32LE(p + 24);
    const nameLength = data.readUInt16LE(p + 28), extraLength = data.readUInt16LE(p + 30), commentLength = data.readUInt16LE(p + 32);
    const local = data.readUInt32LE(p + 42);
    if (p + 46 + nameLength + extraLength + commentLength > eocd) fail('压缩包目录无效，请重新下载或重新压缩。');
    if (compressedSize === 0xffffffff || uncompressed === 0xffffffff || local === 0xffffffff) fail('这个压缩包太大（ZIP64 格式），请解压后直接拖文件夹进来。');
    let name = decodeName(data.subarray(p + 46, p + 46 + nameLength), (flags & 0x800) !== 0);
    // Info-ZIP Unicode Path (0x7075): the UTF-8 name some tools add next to a legacy-encoded one.
    for (let e = p + 46 + nameLength, end = e + extraLength; e + 4 <= end;) {
      const id = data.readUInt16LE(e), length = data.readUInt16LE(e + 2);
      if (id === 0x7075 && length > 5 && e + 4 + length <= end && data[e + 4] === 1) name = data.subarray(e + 9, e + 4 + length).toString('utf8');
      e += 4 + length;
    }
    entries.push({ path: name, size: uncompressed, compressedSize, method, encrypted: (flags & 1) !== 0, offset: local });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** The bytes of one entry, inflated with a hard output cap; the declared size and CRC must match. */
export function readZipEntry(data: Buffer, entry: ZipEntry, limits: ZipLimits = DEFAULT_ZIP_LIMITS): Buffer {
  if (entry.encrypted) fail('文件有密码');
  if (entry.method !== 0 && entry.method !== 8) fail('压缩方式不支持');
  if (entry.size > limits.entryBytes) fail(`超过 ${Math.round(limits.entryBytes / 1024 / 1024)}MB`);
  if (entry.offset + 30 > data.length || data.readUInt32LE(entry.offset) !== 0x04034b50) fail('文件损坏');
  const start = entry.offset + 30 + data.readUInt16LE(entry.offset + 26) + data.readUInt16LE(entry.offset + 28);
  if (start + entry.compressedSize > data.length) fail('文件损坏');
  const raw = data.subarray(start, start + entry.compressedSize);
  let bytes: Buffer;
  if (entry.method === 0) bytes = Buffer.from(raw);
  else {
    if (entry.size > Math.max(1024 * 1024, entry.compressedSize * limits.ratio)) fail('压缩比异常');
    try { bytes = inflateRawSync(raw, { maxOutputLength: Math.max(1, Math.min(limits.entryBytes, entry.size + 1)) }); }
    catch { return fail('文件损坏或解压后过大'); }
  }
  if (bytes.length !== entry.size) fail('文件损坏（大小不符）');
  const crc32 = (zlib as unknown as { crc32?: (data: Uint8Array) => number }).crc32;
  if (crc32) {
    // The CRC sits in the central directory too, but the local header copy is enough when no data descriptor is used.
    const flags = data.readUInt16LE(entry.offset + 6), expected = data.readUInt32LE(entry.offset + 14);
    if (!(flags & 8) && crc32(bytes) >>> 0 !== expected >>> 0) fail('文件损坏（校验不通过）');
  }
  return bytes;
}

/**
 * Reads the files `want(path)` accepts (true). A string is a reason to report the path as skipped; false ignores it
 * silently. Unwanted paths are not inflated; bad entries are skipped with a reason.
 * The running total of declared sizes is capped before anything is inflated, so a ZIP bomb stops early.
 */
export function readZip(data: Buffer, want: (path: string) => string | boolean, limits: ZipLimits = DEFAULT_ZIP_LIMITS, maxFiles = Infinity) {
  const files: ZipFile[] = [], skipped: ZipSkip[] = [];
  let total = 0, ignored = 0;
  for (const entry of listZip(data, limits)) {
    if (entry.path.endsWith('/') || entry.path.endsWith('\\')) continue;
    const path = safeZipPath(entry.path);
    if (!path) { skipped.push({ path: entry.path.slice(0, 200), reason: '路径不安全' }); continue; }
    const verdict = want(path);
    if (verdict !== true) { if (verdict) skipped.push({ path, reason: verdict }); else ignored++; continue; }
    if (files.length >= maxFiles) { skipped.push({ path, reason: `一次最多读 ${maxFiles} 份` }); continue; }
    if (total + entry.size > limits.totalBytes) { skipped.push({ path, reason: `解压后合计超过 ${Math.round(limits.totalBytes / 1024 / 1024)}MB` }); continue; }
    try { const bytes = readZipEntry(data, entry, limits); total += bytes.length; files.push({ path, bytes }); }
    catch (error) { if (!(error instanceof ZipError)) throw error; skipped.push({ path, reason: error.message }); }
  }
  return { files, skipped, ignored };
}
