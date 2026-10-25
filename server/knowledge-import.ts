import { parse } from 'csv-parse/sync';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import { htmlKnowledgeText } from './knowledge-html';
import type { ChatRoles } from '../shared/knowledge';
import type { KnowledgeDraft, KnowledgeImportFile, KnowledgeImportInput } from '../shared/knowledge';
import type { Scenario } from '../shared/types';
import { KNOWLEDGE_IMPORT_LIMITS as LIMITS } from '../shared/knowledge';

const scenarios = new Set<Scenario | 'all'>(['service', 'community', 'sales', 'recruitment', 'content', 'all']);
const safeZipBytes = 16 * 1024 * 1024;
const documentExtensions = new Set(['txt', 'md', 'html', 'htm', 'csv', 'json', 'xlsx', 'docx', 'pdf']);

const fail = (message: string): never => { throw new Error(`知识导入失败：${message}`); };
const extension = (name: string) => name.slice(name.lastIndexOf('.') + 1).toLowerCase();
const normalize = (value: unknown, max = 20000) => { const text = typeof value === 'string' ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : ''; if (text.length > max) fail(`单个字段超过 ${max} 字符，请拆分后导入；原文未截断`); return text; };
const splitValues = (value: unknown) => (Array.isArray(value) ? value.map(item => normalize(item, 500)) : normalize(value, 2000).split('|')).map(item => item.trim()).filter(Boolean);
const titleFor = (text: string, fallback: string) => text.replace(/\s+/g, ' ').slice(0, 120) || fallback;

function decodeText(bytes: Uint8Array, source: string, warnings: string[]): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le', { fatal: true }).decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be', { fatal: true }).decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch {
    const result = new TextDecoder('gb18030', { fatal: true }).decode(bytes);
    warnings.push(`${source} 按 GB18030/GBK 编码读取，请在预览中核对中文。`);
    return result;
  }
}

function validateName(name: unknown, field = '文件名'): string {
  if (typeof name !== 'string' || !name.trim() || name.length > 200 || /[\\/]/.test(name) || name === '.' || name === '..') fail(`${field}必须是不含路径的文件名`);
  return (name as string).trim();
}

function decodeFile(file: KnowledgeImportFile): Uint8Array {
  const name = validateName(file?.name);
  if (!Number.isSafeInteger(file?.size) || file.size < 0 || file.size > LIMITS.fileBytes) fail(`文件“${name}”大小无效或超过 8MB`);
  if (typeof file?.base64 !== 'string' || !file.base64 || file.base64.length > LIMITS.base64Characters || file.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64)) fail(`文件“${name}”不是规范 Base64`);
  const bytes = Buffer.from(file.base64, 'base64');
  if (!bytes.length && file.size) fail(`文件“${name}”Base64 内容为空`);
  if (bytes.toString('base64') !== file.base64 || bytes.byteLength !== file.size) fail(`文件“${name}”Base64 与声明大小不一致`);
  return bytes;
}

/** Refuse zip bombs before giving Office bytes to a document library. */
function assertSafeZip(bytes: Uint8Array, name: string) {
  if (bytes.byteLength < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) fail(`文件“${name}”不是有效的 Office 压缩包`);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) { eocd = i; break; }
  if (eocd < 0) fail(`文件“${name}”缺少压缩目录`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = view.getUint16(eocd + 10, true); const directoryOffset = view.getUint32(eocd + 16, true);
  if (entries > 2000 || directoryOffset >= bytes.length) fail(`文件“${name}”压缩目录超过安全限制`);
  let offset = directoryOffset; let total = 0;
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) fail(`文件“${name}”压缩目录无效`);
    total += view.getUint32(offset + 24, true);
    if (total > safeZipBytes) fail(`文件“${name}”解压后超过安全限制`);
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
}

function draft(source: string, sourceLocator: string, values: Partial<KnowledgeDraft> & { content: string; title?: string }): KnowledgeDraft {
  const content = normalize(values.content);
  if (!content) fail(`“${source}”的${sourceLocator}没有可导入文本`);
  if (values.scenario && !scenarios.has(values.scenario)) fail(`“${source}”的${sourceLocator}场景无效，请使用模板中的场景标识`);
  return { title: values.title ? normalize(values.title, 200) : titleFor(values.question || content, `${source} ${sourceLocator}`), content, tags: values.tags ?? [], aliases: values.aliases ?? [], scenario: values.scenario || 'all', source, sourceLocator, ...(values.question ? { question: normalize(values.question, 2000) } : {}) };
}

// PDF and Word extraction can leave NUL and other control characters in the text; they are never part of a fact.
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​﻿]/g;
export const cleanExtractedText = (text: string) => text.replace(/\r\n?/g, '\n').replace(CONTROL_CHARACTERS, '');
// 「问：…」「答：…」 and 「Q: …」「A: …」 paragraphs in FAQ documents.
const QUESTION_LINE = /^\s*(?:问题?|提问|Q)\s*\d{0,3}\s*[:：.、．]\s*/i;
const ANSWER_LINE = /^\s*(?:答案?|回答|解答|A)\s*\d{0,3}\s*[:：.、．]\s*/i;
const CHUNK_CHARACTERS = 1600;
const length = (value: string) => Array.from(value).length;

/** Bounds a chunk for retrieval on line boundaries; only a single overlong line is cut, preferably after a sentence end. */
export function splitLongText(text: string, max = CHUNK_CHARACTERS): string[] {
  const out: string[] = []; let current = '';
  const flush = () => { if (current.trim()) out.push(current.trim()); current = ''; };
  for (const line of text.split('\n')) {
    let rest = line;
    while (length(rest) > max) {
      const window = Array.from(rest).slice(0, max).join('');
      const end = Math.max(...['。', '！', '？', '；', '.', '!', '?', ';'].map(mark => window.lastIndexOf(mark)));
      const piece = end > window.length / 2 ? window.slice(0, end + 1) : window;
      flush(); if (piece.trim()) out.push(piece.trim()); rest = rest.slice(piece.length);
    }
    if (current && length(current) + length(rest) + 1 > max) flush();
    current += (current ? '\n' : '') + rest;
  }
  flush(); return out;
}

/** The last Q/A marker of a paragraph group is a question still waiting for its answer. */
function openQuestion(group: string) {
  const marked = group.split('\n').filter(line => QUESTION_LINE.test(line) || ANSWER_LINE.test(line));
  return !!marked.length && QUESTION_LINE.test(marked[marked.length - 1]);
}

/** 问/答 pairs inside one group; text outside a complete pair is returned as plain remainder. */
function questionAnswerPairs(group: string): { pairs: Array<{ question: string; answer: string }>; rest: string[] } {
  const pairs: Array<{ question: string; answer: string }> = []; const rest: string[] = [];
  let question: string[] | undefined, answer: string[] | undefined;
  const close = () => {
    if (question && answer && answer.join('\n').trim()) pairs.push({ question: question.join('\n').trim(), answer: answer.join('\n').trim() });
    else if (question) rest.push(question.join('\n'));
    question = undefined; answer = undefined;
  };
  for (const line of group.split('\n')) {
    if (QUESTION_LINE.test(line)) { close(); question = [line.replace(QUESTION_LINE, '')]; }
    else if (ANSWER_LINE.test(line) && question && !answer) answer = [line.replace(ANSWER_LINE, '')];
    else if (answer) answer.push(line);
    else if (question) question.push(line);
    else rest.push(line);
  }
  close();
  return { pairs, rest: rest.map(part => part.trim()).filter(Boolean) };
}

function textChunks(text: string, source: string, prefix = '段落'): KnowledgeDraft[] {
  const clean = cleanExtractedText(text);
  const groups: string[] = [];
  for (const group of clean.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean)) {
    // Word turns 问 and 答 into separate paragraphs: keep the answer with its question.
    if (groups.length && ANSWER_LINE.test(group) && openQuestion(groups[groups.length - 1])) groups[groups.length - 1] += `\n${group}`;
    else groups.push(group);
  }
  const rows: KnowledgeDraft[] = []; let heading = '';
  // Titles name the content, never its position: inserting a paragraph must not rename every later fact.
  // Only when two pieces would carry the same title (a long paragraph split in parts) does a counter tell them apart.
  const titles = new Map<string, number>();
  const unique = (title: string) => { const seen = titles.get(title) ?? 0; titles.set(title, seen + 1); return seen ? `${title.slice(0, 190)}（${seen + 1}）` : title; };
  const plain = (part: string) => {
    for (const content of splitLongText(part)) {
      const locator = `${prefix} ${rows.length + 1}`;
      rows.push(draft(source, locator, { title: unique(heading ? `${titleFor(heading, source).slice(0, 80)} · ${titleFor(content, source).slice(0, 60)}` : titleFor(content, source)), content }));
    }
  };
  for (let part of groups) {
    if (/^#{1,6}\s+/.test(part)) { const lines = part.split('\n'); heading = lines.shift()!.replace(/^#{1,6}\s+/, '').trim(); part = lines.join('\n').trim(); if (!part) continue; }
    const { pairs, rest } = questionAnswerPairs(part);
    if (!pairs.length) { plain(part); continue; }
    if (rest.length) plain(rest.join('\n'));
    for (const pair of pairs) {
      if (length(pair.question) > 2000 || length(pair.answer) > 20000) { plain(`${pair.question}\n${pair.answer}`); continue; }
      rows.push(draft(source, `${prefix} ${rows.length + 1}`, { title: unique(titleFor(pair.question, source)), question: pair.question, content: pair.answer }));
    }
  }
  if (!rows.length && clean.trim()) rows.push(draft(source, `${prefix} 1`, { content: clean }));
  return rows;
}

// Table headers people actually use. Matching ignores case, spaces, punctuation and a trailing colon.
const HEADERS = {
  question: ['问题', '常见问题', '客户问题', '客户提问', '提问', '问', '问法', 'q', 'question', 'faq'],
  answer: ['标准答案', '答案', '回答', '解答', '答复', '回复', '标准回复', '回复话术', '话术', '答', 'a', 'answer', 'reply', 'response'],
  content: ['内容', '正文', '说明', '描述', '详情', '介绍', 'content', 'description', 'detail', 'details', 'text'],
  title: ['标题', '主题', 'title', 'subject'],
  aliases: ['相似问法', '其他问法', '同义问法', 'aliases', 'alias'],
  tags: ['标签', '分类', 'tags', 'tag', 'category'],
  scenario: ['场景', 'scenario'],
};
const headerKey = (name: string) => name.normalize('NFKC').toLowerCase().replace(/[\s:：_\-（）()【】\[\]]/g, '');

function recordToDraft(record: Record<string, unknown>, source: string, locator: string): KnowledgeDraft | undefined {
  const keyed = new Map(Object.entries(record).map(([k, v]) => [headerKey(k), v] as const));
  const get = (...names: string[]) => names.map(name => keyed.get(headerKey(name))).find(value => value !== undefined && (Array.isArray(value) ? value.length > 0 : normalize(value)));
  const question = normalize(get(...HEADERS.question));
  const answer = normalize(get(...HEADERS.answer));
  let content = answer || normalize(get(...HEADERS.content));
  if (!content && !question && Object.values(record).every(value => !normalize(value))) return undefined;
  let title = normalize(get(...HEADERS.title));
  // A plain table without an answer column (a product list: 名称/价格/规格/库存…): the row itself is the fact.
  // The first filled column names it; every filled column becomes 「列名：值」.
  if (!content) {
    const used = new Set([...HEADERS.question, ...HEADERS.aliases, ...HEADERS.tags, ...HEADERS.scenario].map(headerKey));
    const cells = Object.entries(record).filter(([k, v]) => !used.has(headerKey(k)) && normalize(v));
    if (cells.length >= 2 || (cells.length === 1 && question)) { content = cells.map(([k, v]) => `${k.trim()}：${normalize(v)}`).join('；'); title ||= normalize(cells[0][1]); }
  }
  if (!content) fail(`“${source}”的${locator}只有问题、没有答案；请把答案填在「答案」或「回答」列，或删掉这一行`);
  return draft(source, locator, { title: title || titleFor(question, source), question, content, aliases: splitValues(get(...HEADERS.aliases)), tags: splitValues(get(...HEADERS.tags)), scenario: normalize(get('场景', 'scenario')) as Scenario | 'all' });
}

const importFailure = (error: unknown) => error instanceof Error && error.message.startsWith('知识导入失败');
const withoutPrefix = (error: unknown) => (error as Error).message.replace(/^知识导入失败：/, '');

/** One unusable row never sinks the file: it becomes a warning shown in the preview. */
function parseRecords(records: unknown[], source: string, locatorFor: (index: number) => string, warnings: string[]): KnowledgeDraft[] {
  const rows: KnowledgeDraft[] = [];
  records.forEach((record, index) => {
    try {
      if (!record || Array.isArray(record) || typeof record !== 'object') return fail(`“${source}”的${locatorFor(index)}不是有效知识对象`);
      const item = recordToDraft(record as Record<string, unknown>, source, locatorFor(index));
      if (item) rows.push(item);
    } catch (error) { if (!importFailure(error)) throw error; warnings.push(`${withoutPrefix(error)}（已跳过这一行，其他行照常导入）`); }
  });
  return rows;
}

/** ExcelJS cell values: formulas, rich text, hyperlinks and dates are objects, not strings. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    const date = `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
    return value.getUTCHours() || value.getUTCMinutes() ? `${date} ${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}` : date;
  }
  if (typeof value === 'object') {
    const cell = value as Record<string, unknown>;
    if (Array.isArray(cell.richText)) return cell.richText.map(part => cellText((part as { text?: unknown })?.text)).join('');
    if ('formula' in cell || 'sharedFormula' in cell || 'result' in cell) return cellText(cell.result);
    if ('text' in cell) return cellText(cell.text);
    if ('error' in cell) return '';
  }
  return '';
}

const knownHeaders = new Set(Object.values(HEADERS).flat().map(headerKey));
/** Finds the header among the first five rows: a title row such as 「常见问题汇总（2026版）」 may sit above it. */
function headerRow(rows: string[][]): number {
  const candidates = rows.slice(0, 5);
  const known = candidates.findIndex(row => row.some(cell => cell && knownHeaders.has(headerKey(cell))));
  if (known >= 0) return known;
  // A plain list (名称/价格/规格…): at least two short, non-numeric labels.
  return candidates.findIndex(row => { const filled = row.filter(Boolean); return filled.length >= 2 && filled.every(cell => cell.length <= 30 && !/^[\d.,\s%¥￥$-]+$/.test(cell)); });
}

/** Turns a grid (first column index 0) into keyed records below the detected header row. */
function gridRecords(grid: string[][], source: string, sheetLabel: string, locator: (row: number) => string, warnings: string[]): KnowledgeDraft[] | undefined {
  const header = headerRow(grid);
  if (header < 0) return undefined;
  const keys = grid[header].map(cell => cell.trim());
  if (header > 0) warnings.push(`${sheetLabel}前 ${header} 行不是表头（例如标题行），已从第 ${header + 1} 行的表头开始读取。`);
  const records: Record<string, unknown>[] = [], numbers: number[] = [];
  for (let index = header + 1; index < grid.length; index++) {
    const record: Record<string, unknown> = {};
    keys.forEach((key, column) => { if (key) record[key] = grid[index][column] ?? ''; });
    records.push(record); numbers.push(index);
  }
  return parseRecords(records, source, i => locator(numbers[i]), warnings);
}

// Chat exports put a timestamp before or after the nickname: 「小美 2026-10-01 10:00」 or 「2026-10-01 10:00 小美」.
const CHAT_TIME = String.raw`(?:\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?\s+)?\d{1,2}:\d{2}(?::\d{2})?`;
const TIME_FIRST = new RegExp(`^${CHAT_TIME}\\s+(.{1,100})$`);
const TIME_LAST = new RegExp(`^(.{1,100}?)\\s+${CHAT_TIME}$`);
const LEADING_TIME = new RegExp(`^\\s*${CHAT_TIME}\\s+`);
// Media the export cannot carry: never an answer, never a question.
const MEDIA_PLACEHOLDER = /^\s*(?:[\[【<（(]\s*(?:图片|照片|语音|视频|文件|表情|动画表情|表情包|链接|位置|名片|小程序|红包|转账|聊天记录|音乐|Photo|Image|Picture|Voice|Audio|Video|File|Sticker|Emoji|GIF|Link|Location)\s*[\]】>）)]\s*)+$/i;
const withoutMedia = (content: string) => content.split('\n').filter(line => line.trim() && !MEDIA_PLACEHOLDER.test(line)).join('\n').trim();

export function parseChatTranscript(text: string, sourceName = '粘贴聊天', roles?: ChatRoles): { rows: KnowledgeDraft[]; warnings: string[] } {
  if (typeof text !== 'string' || !text.trim()) fail('聊天文本不能为空');
  const source = validateName(sourceName, '聊天来源名');
  const warnings: string[] = [];
  const originalText = text;
  if (roles) {
    if (!Array.isArray(roles.customers) || !Array.isArray(roles.staff) || [...roles.customers, ...roles.staff].length > 40 || [...roles.customers, ...roles.staff].some(n => typeof n !== 'string' || !n.trim() || n.length > 100 || /[\r\n：:]/.test(n))) fail('聊天昵称设置无效，请每行填写一个昵称，不含冒号');
    const names = new Map<string, string>();
    for (const [group, role] of [[roles.customers, '客户'], [roles.staff, '客服']] as const) for (const name of group) { if (names.has(name.trim()) && names.get(name.trim()) !== role) fail('同一昵称不能同时属于客户和我方'); names.set(name.trim(), role); }
    let unknown = false;
    text = text.split(/\r?\n/).map(line => {
      const trimmed = line.trim();
      const header = TIME_FIRST.exec(trimmed)?.[1]?.trim() ?? TIME_LAST.exec(trimmed)?.[1]?.trim();
      if (header && names.has(header)) return `${names.get(header)}：`;
      const body = trimmed.replace(LEADING_TIME, '');
      for (const [name, role] of names) {
        if (body === name) return `${role}：`;
        if (body.startsWith(`${name}:`) || body.startsWith(`${name}：`)) return `${role}：${body.slice(name.length + 1)}`;
      }
      if (header && header.length <= 40 && !/[，。！？,.!?]/.test(header) || /^[^：:\s]{1,40}[：:]/.test(body) && !/^(客户|用户|买家|咨询者|客服|销售|顾问|商家|助手|Q|A)[：:]/i.test(body)) unknown = true;
      return line;
    }).join('\n');
    if (unknown) { warnings.push('存在未指定角色的昵称或类似发言标题，已保留整段原文；补全角色后可重新整理问答。'); return { rows: textChunks(originalText, source, '聊天原文段'), warnings }; }
  }
  const isQuestion = (role: string) => /^(客户|用户|买家|咨询者|q)$/i.test(role);
  const turns: Array<{ index: number; question: boolean; content: string }> = []; const prefix: string[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    const match = /^\s*(客户|用户|买家|咨询者|客服|销售|顾问|商家|助手|Q|A)\s*[：:]\s*(.*?)\s*$/i.exec(line.replace(LEADING_TIME, ''));
    if (match) {
      const question = isQuestion(match[1]); const last = turns[turns.length - 1];
      // Several messages in a row from the same side are one turn: the answer is everything we said before the customer spoke again.
      if (last && last.question === question) last.content += `\n${match[2]}`;
      else turns.push({ index: index + 1, question, content: match[2] });
    }
    else if (turns.length) turns[turns.length - 1].content += `\n${line}`;
    else prefix.push(line);
  });
  if (!turns.length) { warnings.push('未识别明确客户/客服/销售/Q/A角色；已保留原文，未推断问答关系。'); return { rows: textChunks(text, source, '聊天原文段'), warnings }; }
  const rows: KnowledgeDraft[] = prefix.join('\n').trim() ? textChunks(prefix.join('\n'), source, '未配对原文段') : []; let pending: { text: string; line: number } | undefined;
  if (rows.length) warnings.push('角色标签前的原文已单独保留，请审核其用途。');
  let media = 0;
  for (const turn of turns) {
    const content = withoutMedia(turn.content);
    if (!content) { media++; continue; }
    if (turn.question) {
      if (pending) { rows.push(draft(source, `聊天第 ${pending.line} 行`, { content: `【未配对客户原话】\n${pending.text}` })); warnings.push(`聊天第 ${pending.line} 行客户提问未找到后续客服回复，已保留原文。`); }
      pending = { text: content, line: turn.index };
    } else if (pending) {
      if (pending.text.length > 2000 || content.length > 20000) {
        rows.push(...textChunks(`【客户原话】\n${pending.text}\n【我方原话】\n${content}`, source, `聊天第 ${pending.line}-${turn.index} 行 原文段`));
        warnings.push(`聊天第 ${pending.line} 行问答较长，已完整分段保留，请核对后整理。`);
      } else rows.push(draft(source, `聊天第 ${pending.line}-${turn.index} 行`, { title: titleFor(pending.text, source), question: pending.text, content }));
      pending = undefined;
    } else {
      rows.push(draft(source, `聊天第 ${turn.index} 行`, { content: `【未配对客服原话】\n${content}` })); warnings.push(`聊天第 ${turn.index} 行客服回复没有明确对应问题，已保留原文。`);
    }
  }
  if (pending) { rows.push(draft(source, `聊天第 ${pending.line} 行`, { content: `【未配对客户原话】\n${pending.text}` })); warnings.push(`聊天第 ${pending.line} 行客户提问未找到后续客服回复，已保留原文。`); }
  if (media) warnings.push(`有 ${media} 段只有图片、语音、表情等内容，导出文本里看不到，已跳过。`);
  return { rows, warnings };
}

async function parseXlsx(bytes: Uint8Array, source: string, warnings: string[]): Promise<KnowledgeDraft[]> {
  assertSafeZip(bytes, source);
  const excelModule = await import('exceljs'); const ExcelJS = (excelModule as any).default ?? excelModule; const book = new ExcelJS.Workbook();
  try { await book.xlsx.load(bytes as any); } catch { return fail(`Excel 文件“${source}”无法读取，可能已加密或损坏`); }
  const rows: KnowledgeDraft[] = [];
  if (book.worksheets.length > 20) fail(`Excel 文件“${source}”超过 20 个工作表，请拆分`);
  for (const sheet of book.worksheets) {
    if (sheet.rowCount > 10000) fail(`工作表“${sheet.name}”超过 10,000 行，请拆分`);
    const grid: string[][] = [];
    for (let number = 1; number <= Math.min(sheet.rowCount, 10000); number++) {
      const values = (sheet.getRow(number).values as unknown[]) ?? [];
      grid.push(Array.from({ length: Math.max(0, values.length - 1) }, (_, column) => cellText(values[column + 1]).trim()));
    }
    if (grid.every(row => row.every(cell => !cell))) continue;
    const parsed = gridRecords(grid, source, `工作表“${sheet.name}”`, index => `工作表 ${sheet.name} 第 ${index + 1} 行`, warnings);
    if (!parsed) { warnings.push(`工作表“${sheet.name}”前 5 行没有找到表头（如「问题」「答案」或「名称」「价格」），已跳过这个工作表。`); continue; }
    rows.push(...parsed);
  }
  return rows;
}

async function parseDocx(bytes: Uint8Array, source: string): Promise<KnowledgeDraft[]> {
  assertSafeZip(bytes, source);
  const mammoth = await import('mammoth');
  try {
    // HTML keeps Word headings as headings (context for the paragraphs below) instead of turning them into entries of their own.
    const options = { convertImage: mammoth.images.imgElement(async () => ({ src: '' })) };
    const result = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) }, options);
    const text = htmlKnowledgeText(result.value, { document: true });
    if (!cleanExtractedText(text).trim()) return fail(`Word 文件“${source}”没有可提取文字，可能是扫描件或空文档`);
    return textChunks(text, source);
  } catch (error) { if (importFailure(error)) throw error; return fail(`Word 文件“${source}”无法读取，可能已加密或损坏`); }
}

/** pdf.js needs its character maps for PDFs whose Chinese fonts are not embedded; without them such text PDFs read as blank. */
function pdfAssets(): { cMapUrl?: string; cMapPacked?: boolean; standardFontDataUrl?: string } {
  const bases: string[] = [];
  // Packaged worker: scripts/build-desktop.mjs copies the maps next to knowledge-import-worker.cjs.
  if (typeof __dirname === 'string') bases.push(join(__dirname, 'pdfjs'));
  try { bases.push(dirname(createRequire(typeof __filename === 'string' ? __filename : import.meta.url).resolve('pdfjs-dist/package.json'))); } catch { /* not installed */ }
  for (const base of bases) if (existsSync(join(base, 'cmaps')) && existsSync(join(base, 'standard_fonts'))) {
    const cMapPath = (join(base, 'cmaps') + '/').replace(/\\/g, '/');
    const fontPath = (join(base, 'standard_fonts') + '/').replace(/\\/g, '/');
    return { cMapUrl: cMapPath, cMapPacked: true, standardFontDataUrl: fontPath };
  }
  return {};
}

async function parsePdf(bytes: Uint8Array, source: string, warnings: string[]): Promise<KnowledgeDraft[]> {
  try {
    const { extractText, getDocumentProxy } = await import('unpdf'); const pdf = await getDocumentProxy(new Uint8Array(bytes), pdfAssets());
    if (pdf.numPages > 100) return fail(`PDF 文件“${source}”页数超过 100 页限制`);
    const extracted = await extractText(pdf, { mergePages: false }); const pages = extracted.text;
    const pageTexts = (Array.isArray(pages) ? pages : [pages]).map(page => cleanExtractedText(normalize(page, LIMITS.extractedCharacters)).trim());
    pageTexts.forEach((text, i) => { if (!text) warnings.push(`${source} 第 ${i + 1} 页没有可提取文字，可能为空页或扫描图片，请核对并在需要时先做 OCR。`); });
    const rows = pageTexts.flatMap((text, index) => text ? textChunks(text, source, `第 ${index + 1} 页`) : []);
    if (!rows.length) return fail(`PDF 文件“${source}”没有可提取文字，扫描件需要 OCR 后再导入`);
    return rows;
  } catch (error) { if (importFailure(error)) throw error; return fail(`PDF 文件“${source}”无法读取，可能已加密、损坏或不是文本 PDF${error instanceof Error && error.message ? `：${error.message}` : ''}`); }
}

async function parseFile(file: KnowledgeImportFile, warnings: string[]): Promise<KnowledgeDraft[]> {
  if (!file || typeof file !== 'object') fail('文件项无效');
  const name = validateName(file.name); const kind = extension(name); if (!documentExtensions.has(kind)) fail(`不支持文件“${name}”的格式`);
  const bytes = decodeFile(file); const text = () => decodeText(bytes, name, warnings);
  try {
    if (kind === 'txt' || kind === 'md') return textChunks(text(), name);
    if (kind === 'html' || kind === 'htm') return textChunks(htmlKnowledgeText(text()), name);
    if (kind === 'csv') {
      const grid = (parse(text(), { columns: false, skip_empty_lines: true, relax_column_count: true, bom: true, trim: true, max_record_size: 200000 }) as unknown[][]).map(row => row.map(cell => String(cell ?? '')));
      const parsed = gridRecords(grid, name, `CSV“${name}”`, index => `CSV 第 ${index + 1} 行`, warnings);
      return parsed ?? fail(`CSV 文件“${name}”前 5 行没有找到表头，请在第一行写「问题」「答案」等列名`);
    }
    if (kind === 'json') { const value = JSON.parse(text()); const records = Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : fail(`JSON 文件“${name}”必须是数组或包含 items 数组`); return parseRecords(records, name, index => `JSON 第 ${index + 1} 项`, warnings); }
    if (kind === 'xlsx') return await parseXlsx(bytes, name, warnings);
    if (kind === 'docx') return await parseDocx(bytes, name);
    return await parsePdf(bytes, name, warnings);
  } catch (error) { if (error instanceof Error && error.message.startsWith('知识导入失败')) throw error; return fail(`文件“${name}”解析失败：${error instanceof Error ? error.message : '格式无效'}`); }
}

export async function parseKnowledgeImport(input: KnowledgeImportInput): Promise<{ rows: KnowledgeDraft[]; warnings: string[] }> {
  if (!input || typeof input !== 'object') fail('导入参数无效');
  const files = input.files ?? []; const warnings: string[] = [];
  if (!Array.isArray(files) || files.length > LIMITS.files) fail(`最多可导入 ${LIMITS.files} 个文件`);
  const totalBase64 = files.reduce((sum, file) => sum + (typeof file?.base64 === 'string' ? file.base64.length : 0), 0);
  if (totalBase64 > LIMITS.base64Characters) fail('文件 Base64 总量超过 12MB');
  let rows: KnowledgeDraft[] = [];
  for (const file of files) {
    if (!file || typeof file !== 'object') fail('文件项无效');
    validateName(file.name);
    let parsed: KnowledgeDraft[]; const before = warnings.length;
    if (input.textKind === 'chat' && ['txt','md'].includes(extension(file.name))) {
      const chat = parseChatTranscript(decodeText(decodeFile(file), file.name, warnings), file.name, input.chatRoles); parsed = chat.rows; warnings.push(...chat.warnings);
    } else parsed = await parseFile(file, warnings);
    if (!parsed.length) fail(`文件“${file.name}”没有可识别条目，请检查表头或内容${warnings.length > before ? '：' + warnings.slice(before, before + 3).join(' ') : ''}`); rows.push(...parsed);
  }
  if (input.text !== undefined) {
    if (typeof input.text !== 'string' || input.text.length > LIMITS.extractedCharacters) fail('粘贴文本必须是字符串且不超过 50 万字符');
    if (input.text.trim()) {
      const source = input.sourceName ? validateName(input.sourceName, '文本来源名') : '粘贴文本';
      if (input.textKind === 'chat') { const chat = parseChatTranscript(input.text, source, input.chatRoles); rows.push(...chat.rows); warnings.push(...chat.warnings); }
      else rows.push(...textChunks(input.text, source));
    }
  }
  if (!files.length && !input.text?.trim()) fail('请提供至少一个文件或一段文本');
  if (!rows.length) fail('未从导入内容中识别到可编辑的文本条目');
  const totalText = rows.reduce((sum, row) => sum + row.title.length + row.content.length + (row.question?.length ?? 0), 0);
  if (totalText > LIMITS.extractedCharacters) fail('提取文本总量超过 50 万字符');
  // Larger files are previewed in full and committed in batches of LIMITS.rows; nothing is dropped silently.
  if (rows.length > LIMITS.previewRows) fail(`单次超过 ${LIMITS.previewRows} 条草稿，请把资料拆成几份分别导入；未截断原文`);
  return { rows, warnings };
}
