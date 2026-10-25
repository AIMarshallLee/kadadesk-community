import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { cellText, parseChatTranscript, parseKnowledgeImport, splitLongText } from './knowledge-import';

const encoded = (name: string, bytes: Buffer) => ({ name, size: bytes.length, base64: bytes.toString('base64') });
const text = (name: string, value: string) => encoded(name, Buffer.from(value));
async function xlsx(build: (book: ExcelJS.Workbook) => void) { const book = new ExcelJS.Workbook(); build(book); return Buffer.from(await book.xlsx.writeBuffer()); }

/** A Word file with real heading styles, as Word itself writes them. */
async function docx(paragraphs: Array<{ text: string; heading?: boolean }>) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  zip.file('word/styles.xml', '<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>');
  const body = paragraphs.map(p => `<w:p>${p.heading ? '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' : ''}<w:r><w:t>${p.text}</w:t></w:r></w:p>`).join('');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

/** A text PDF whose Chinese font (STSong-Light) is not embedded: reading it needs pdf.js's bundled character maps. */
function cjkPdf(hex: string) {
  const stream = `BT /F1 12 Tf 72 720 Td <${hex}> Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [6 0 R] >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /DW 1000 >>'];
  let body = '%PDF-1.4\n'; const offsets: number[] = [];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(body); body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body);
}
const ucs2 = (value: string) => Array.from(value).map(c => c.codePointAt(0)!.toString(16).padStart(4, '0').toUpperCase()).join('');

test('Excel 公式、富文本、超链接和日期单元格按显示的文字读取', async () => {
  const bytes = await xlsx(book => {
    const sheet = book.addWorksheet('FAQ');
    sheet.addRow([{ richText: [{ text: '问' }, { font: { bold: true }, text: '题' }] }, '答案', '更新日期']);
    sheet.getCell('A2').value = '会员价多少';
    sheet.getCell('B2').value = { formula: '"会员价"&"88元"', result: '会员价88元' } as any;
    sheet.getCell('C2').value = new Date(Date.UTC(2026, 9, 1));
    sheet.getCell('A3').value = { richText: [{ text: '官网' }, { text: '地址' }] } as any;
    sheet.getCell('B3').value = { text: '点这里打开官网', hyperlink: 'https://example.com' } as any;
  });
  const result = await parseKnowledgeImport({ files: [encoded('faq.xlsx', bytes)] });
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].question, '会员价多少');
  assert.equal(result.rows[0].content, '会员价88元');
  assert.equal(result.rows[1].question, '官网地址');
  assert.equal(result.rows[1].content, '点这里打开官网');
  assert.equal(cellText(new Date(Date.UTC(2026, 9, 1))), '2026-10-01');
  assert.equal(cellText({ formula: 'A1', result: 12 }), '12');
  assert.equal(cellText({ error: '#REF!' }), '');
});

test('Excel 表头上方的标题行、空答案行和说明页只产生提示，不让整份文件失败', async () => {
  const bytes = await xlsx(book => {
    const faq = book.addWorksheet('常见问题');
    faq.addRow(['常见问题汇总（2026版）']);
    faq.addRow([]);
    faq.addRow(['问题', '答案']);
    faq.addRow(['几天发货', '下单后48小时内发货']);
    faq.addRow(['能开发票吗', '']);
    faq.addRow(['支持退货吗', '7天无理由退货']);
    const notes = book.addWorksheet('填写说明');
    notes.addRow(['这张表请按问题和答案两列填写，每行一个问题，不要合并单元格。']);
    notes.addRow(['填好以后直接导入咔哒即可，价格变了改这张表再导一次。']);
  });
  const result = await parseKnowledgeImport({ files: [encoded('faq.xlsx', bytes)] });
  assert.deepEqual(result.rows.map(r => r.question), ['几天发货', '支持退货吗']);
  assert.equal(result.rows[0].sourceLocator, '工作表 常见问题 第 4 行');
  assert.ok(result.warnings.some(w => /第 5 行只有问题、没有答案/.test(w)));
  assert.ok(result.warnings.some(w => /标题行/.test(w)));
  assert.ok(result.warnings.some(w => /填写说明.*跳过/.test(w)));
});

test('CSV 有标题行和空答案行时照常导入其余行', async () => {
  const result = await parseKnowledgeImport({ files: [text('faq.csv', '店铺常见问题\n问题,答案\n几天发货,48小时内\n包邮吗,\n能退吗,7天无理由')] });
  assert.deepEqual(result.rows.map(r => [r.question, r.content]), [['几天发货', '48小时内'], ['能退吗', '7天无理由']]);
  assert.ok(result.warnings.some(w => /CSV 第 4 行只有问题/.test(w)));
});

test('Word 标题作为上下文保留，问/答 两段合并成一条问答', async () => {
  const bytes = await docx([
    { text: '售后政策', heading: true },
    { text: '问：几天能退货？' }, { text: '答：签收后7天内可以无理由退货。' },
    { text: 'Q: 运费谁出？' }, { text: 'A: 质量问题由我们承担运费。' },
    { text: '定制商品不支持无理由退货。' },
  ]);
  const result = await parseKnowledgeImport({ files: [encoded('售后.docx', bytes)] });
  assert.equal(result.rows.length, 3);
  assert.ok(!result.rows.some(r => r.content === '售后政策'), '标题不能单独成为一条知识');
  assert.equal(result.rows[0].question, '几天能退货？');
  assert.equal(result.rows[0].content, '签收后7天内可以无理由退货。');
  assert.equal(result.rows[1].question, '运费谁出？');
  assert.equal(result.rows[1].content, '质量问题由我们承担运费。');
  assert.match(result.rows[2].title, /^售后政策 · 定制商品/);
});

test('段落标题只取内容，不带位置序号；插入新段落不改变后面段落的标题', async () => {
  const before = await parseKnowledgeImport({ text: '产品A价格为298元。\n\n周末不发货。', sourceName: '说明.txt' });
  const after = await parseKnowledgeImport({ text: '新到货：产品B。\n\n产品A价格为298元。\n\n周末不发货。', sourceName: '说明.txt' });
  assert.ok(before.rows.every(r => !/段落/.test(r.title)));
  assert.equal(after.rows[2].title, before.rows[1].title);
  assert.equal(after.rows[2].sourceLocator, '段落 3');
});

test('长段落按行切分，不在一行中间截断；控制字符被清除', async () => {
  const line = (n: number) => `第${n}条：` + '这是一行比较长的价格说明，包含规格、颜色、尺寸。'.repeat(8);
  const long = Array.from({ length: 12 }, (_, i) => line(i + 1)).join('\n');
  const chunks = splitLongText(long, 1600);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) for (const piece of chunk.split('\n')) assert.match(piece, /^第\d+条：/);
  const result = await parseKnowledgeImport({ text: '价格\u0000表：A025 保温杯 59元' });
  assert.equal(result.rows[0].content, '价格表：A025 保温杯 59元');
});

test('中文字体未嵌入的文本 PDF 能读出文字，不被当成扫描件', async () => {
  const bytes = cjkPdf(ucs2('保温杯价格'));
  const result = await parseKnowledgeImport({ files: [encoded('价目表.pdf', bytes)] });
  assert.match(result.rows[0].content, /保温杯价格/);
  assert.ok(!result.warnings.some(w => /扫描/.test(w)));
});

test('聊天导出：时间在昵称前的发言头、连续发言合并、图片占位不当答案', () => {
  const chat = [
    '2026-10-01 10:00 小美', '你好，这个保温杯多少钱？', '2026-10-01 10:00 小美', '[图片]',
    '2026-10-01 10:01 店长', '[图片]', '2026-10-01 10:01 店长', '59元，今天下单明天发货。', '2026-10-01 10:02 店长', '满99包邮。',
    '2026-10-01 10:03 小美', '[语音]',
  ].join('\n');
  const result = parseChatTranscript(chat, '聊天记录.txt', { customers: ['小美'], staff: ['店长'] });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].question, '你好，这个保温杯多少钱？');
  assert.equal(result.rows[0].content, '59元，今天下单明天发货。\n满99包邮。');
  assert.ok(result.warnings.some(w => /图片、语音/.test(w)));
  const plain = parseChatTranscript('2026-10-01 10:00 客户：能便宜点吗\n2026-10-01 10:01 客服：[表情]\n2026-10-01 10:01 客服：已经是最低价了', '聊天.txt');
  assert.equal(plain.rows[0].content, '已经是最低价了');
});
