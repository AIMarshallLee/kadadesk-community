import assert from 'node:assert/strict';
import test from 'node:test';
import { listZip, readZip, safeZipPath, ZipError } from './zip-reader';
import { makeZip } from './zip-fixture';
import { expandZip, wantedDocument } from './knowledge-expand';

const asUpload = (name: string, data: Buffer) => ({ name, size: data.length, base64: data.toString('base64') });

test('reads stored and deflate entries with their folder path; skips folders and unwanted files without inflating them', () => {
  const data = makeZip([
    { name: '资料/', data: '', method: 0 },
    { name: '资料/价格.md', data: '# 价格\n\n基础版 99 元。', method: 8 },
    { name: '资料/说明.txt', data: '工作日 9 点到 18 点在线。', method: 0 },
    { name: '资料/logo.png', data: Buffer.alloc(64, 1) },
  ]);
  const { files, skipped, ignored } = readZip(data, path => path.endsWith('.png') ? false : true);
  assert.deepEqual(files.map(f => [f.path, f.bytes.toString('utf8')]), [['资料/价格.md', '# 价格\n\n基础版 99 元。'], ['资料/说明.txt', '工作日 9 点到 18 点在线。']]);
  assert.deepEqual(skipped, []); assert.equal(ignored, 1);
});

test('zip-slip paths, encrypted entries and forged sizes are skipped with a reason, never thrown', () => {
  const data = makeZip([
    { name: '../outside.md', data: 'x' },
    { name: '/etc/passwd.txt', data: 'x' },
    { name: 'C:\\Windows\\a.txt', data: 'x' },
    { name: 'secret.md', data: 'x', flags: 0x801 },
    { name: 'bomb.txt', data: 'a'.repeat(1000), declaredSize: 10 },
    { name: 'ok.md', data: '正常的一份资料。' },
  ]);
  const { files, skipped } = readZip(data, () => true);
  assert.deepEqual(files.map(f => f.path), ['ok.md']);
  assert.deepEqual(skipped.map(s => s.reason), ['路径不安全', '路径不安全', '路径不安全', '文件有密码', '文件损坏或解压后过大']);
  assert.equal(safeZipPath('a/./b/c.md'), 'a/b/c.md'); assert.equal(safeZipPath('a/../../b.md'), null);
});

test('zip bombs stop at the entry and total caps before inflating', () => {
  const big = Buffer.alloc(3 * 1024 * 1024, 0x61);
  const data = makeZip([{ name: 'a.txt', data: big }, { name: 'b.txt', data: big }, { name: 'c.txt', data: big }]);
  const limits = { entries: 10, entryBytes: 4 * 1024 * 1024, totalBytes: 7 * 1024 * 1024, ratio: 2000 };
  const { files, skipped } = readZip(data, () => true, limits);
  assert.equal(files.length, 2); assert.match(skipped[0].reason, /合计超过 7MB/);
  const tight = readZip(data, () => true, { ...limits, ratio: 10 });
  assert.equal(tight.files.length, 0); assert.ok(tight.skipped.every(s => s.reason === '压缩比异常'));
  const perEntry = readZip(data, () => true, { ...limits, entryBytes: 1024 * 1024 });
  assert.ok(perEntry.skipped.every(s => /超过 1MB/.test(s.reason)));
});

test('rejects non-ZIP data, ZIP64 markers and too many entries with a plain message', () => {
  assert.throws(() => listZip(Buffer.from('not a zip at all, just some text bytes')), ZipError);
  const zip64 = makeZip([{ name: 'a.md', data: 'x' }]); zip64.writeUInt32LE(0xffffffff, zip64.length - 6);
  assert.throws(() => listZip(zip64), /ZIP64/);
  const many = makeZip(Array.from({ length: 12 }, (_, i) => ({ name: `f${i}.md`, data: 'x' })));
  assert.throws(() => listZip(many, { entries: 10, entryBytes: 1024, totalBytes: 4096, ratio: 10 }), /超过 10 个文件/);
});

test('GBK names without the UTF-8 flag are decoded (Chinese Windows ZIPs)', () => {
  let gbkName: Buffer;
  try { gbkName = Buffer.from(new Uint8Array([0xbc, 0xdb, 0xb8, 0xf1, 0x2e, 0x74, 0x78, 0x74])); new TextDecoder('gbk'); }
  catch { return; } // a runtime without GBK falls back to latin1; nothing to assert
  const { files } = readZip(makeZip([{ name: gbkName, data: '99 元' }]), () => true);
  assert.equal(files[0].path, '价格.txt');
});

test('expandZip keeps folder provenance in the file name and filters like a dropped folder', () => {
  const data = makeZip([
    { name: 'shop-main/docs/价格.md', data: '基础版 99 元。' },
    { name: 'shop-main/.git/config.txt', data: 'x' },
    { name: 'shop-main/node_modules/pkg/readme.md', data: 'x' },
    { name: '__MACOSX/shop-main/._价格.md', data: 'x' },
    { name: 'shop-main/docs/~$报价.docx', data: 'x' },
    { name: 'shop-main/src/app.ts', data: 'x' },
    { name: 'shop-main/inner.zip', data: 'x' },
    { name: 'FAQ.txt', data: '周末也发货。' },
  ]);
  const result = expandZip(asUpload('shop-main.zip', data));
  assert.deepEqual(result.files.map(f => f.name), ['shop-main／docs／价格.md', 'shop-main／FAQ.txt']);
  assert.equal(Buffer.from(result.files[0].base64, 'base64').toString('utf8'), '基础版 99 元。');
  assert.deepEqual(result.skipped, [{ name: 'shop-main／inner.zip', reason: '压缩包里的压缩包，请先解压' }]);
  assert.equal(result.ignored, 5);
  assert.throws(() => expandZip(asUpload('broken.zip', Buffer.from('PK nonsense that is long enough to scan'))), /broken\.zip/);
  assert.throws(() => expandZip({ name: 'x.zip', size: 3, base64: 'not base64!' }), /压缩包无效/);
  assert.equal(wantedDocument('docs/a.PDF'), true); assert.equal(wantedDocument('docs/a.pdf', 9 * 1024 * 1024), '超过 8MB');
});
