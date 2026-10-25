const recordDiag = (_scope: string, _detail?: any) => {};
import { app, dialog, ipcMain } from 'electron';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { parse } from 'csv-parse/sync';
import { createCustomers, type ShopLead } from './customers';
import { createReplyModel, type ReplyModelCredentials } from './reply-model';
import { knowledgeAvailable } from '../server/knowledge';
import { cellText } from '../server/knowledge-import';
import type { DesktopReplyConfig } from '../shared/desktop-replies';
import type { Knowledge } from '../shared/types';

/** A spreadsheet as rows of text: CSV (UTF-8, or GB18030 as saved by Excel/WPS in Chinese) or the first XLSX sheet with content. */
export async function readSheet(path: string): Promise<string[][]> {
  const info = await stat(path); if (info.size > 20 * 1024 * 1024) throw new Error('文件太大了（最多 20 MB），请拆开导入。');
  const kind = extname(path).toLowerCase(); const bytes = await readFile(path);
  if (kind === '.csv' || kind === '.txt') {
    let text = new TextDecoder('utf-8').decode(bytes);
    if (text.includes('�')) { try { text = new TextDecoder('gb18030').decode(bytes); } catch { /* keep utf-8 */ } }
    return (parse(text, { columns: false, skip_empty_lines: true, relax_column_count: true, relax_quotes: true, bom: true, trim: true, max_record_size: 200000 }) as unknown[][]).slice(0, 5005).map(r => r.map(c => String(c ?? '')));
  }
  if (kind === '.xlsx') {
    const excelModule = await import('exceljs'); const ExcelJS = (excelModule as any).default ?? excelModule; const book = new ExcelJS.Workbook();
    try { await book.xlsx.load(bytes as any); } catch { throw new Error('这个 Excel 文件打不开，可能加了密码或已损坏；可以另存为 CSV 再导入。'); }
    for (const sheet of book.worksheets.slice(0, 20)) {
      const grid: string[][] = [];
      for (let n = 1; n <= Math.min(sheet.rowCount, 5005); n++) { const values = (sheet.getRow(n).values as unknown[]) ?? []; grid.push(Array.from({ length: Math.max(0, values.length - 1) }, (_, c) => cellText(values[c + 1]).trim())); }
      if (grid.some(r => r.some(c => c))) return grid;
    }
    return [];
  }
  throw new Error('只能导入 Excel（.xlsx）或 CSV 文件。旧的 .xls 请先另存为 .xlsx。');
}

export async function registerCustomers(o: {
  trusted(event: Electron.IpcMainInvokeEvent): void;
  directory: string;
  config(): DesktopReplyConfig | undefined;
  credentials(): Promise<ReplyModelCredentials>;
  knowledge(): Promise<Knowledge[]>;
  /** Reception's knowledge lookup for a question (approved, enabled knowledge only). */
  lookup?(config: DesktopReplyConfig, query: string, signal: AbortSignal): Promise<{ knowledge: string; facts?: string }>;
  send(name: string, text: string, detail: string): Promise<{ jobId: string; conversationName: string } | { error: string }>;
  jobOutcome(id: string): { status: string; detail: string; tail: string } | undefined;
  receptionRunning(): boolean;
  customerWaiting(): boolean;
  alertAdmin(kind: string, text: string, redacted: string | null): 'full' | 'redacted' | false | undefined;
  privateOk(): boolean;
  codesReady(): boolean;
  notify(title: string, body: string): void;
  reserveQuota?(): { commit(): Promise<void>; cancel(): void };
}) {
  // The settings are read often (each transcript): a short-lived copy instead of a clone per call.
  let configCache: { at: number; value: DesktopReplyConfig | undefined } | undefined;
  const config = () => { if (!configCache || Date.now() - configCache.at > 5000) configCache = { at: Date.now(), value: o.config() }; return configCache.value; };
  const customers = await createCustomers({
    file: join(o.directory, 'customers', 'profiles.json'),
    config,
    writeText: async (system, text, signal) => createReplyModel(await o.credentials()).generate({ system, messages: [{ role: 'user', content: text }], signal }),
    captureAllowed: async () => { try { const c = await o.credentials(); return !!c.baseUrl; } catch { return false; } },
    knowledge: async (query, signal) => { const c = config(); if (!c || !o.lookup) return { knowledge: '' }; return o.lookup(c, query, signal); },
    identity: () => (config() as any)?.identity,
    businessTags: async () => (await o.knowledge()).filter(k => knowledgeAvailable(k) && !k.id.startsWith('knowledge_demo_')).map(k => k.tags),
    send: o.send, jobOutcome: o.jobOutcome, receptionRunning: o.receptionRunning, customerWaiting: o.customerWaiting,
    alertAdmin: o.alertAdmin, privateOk: o.privateOk, codesReady: o.codesReady, notify: o.notify,
    ...(o.reserveQuota ? { reserveQuota: o.reserveQuota } : {}),
    leads: async (): Promise<ShopLead[]> => {
      try { const raw = JSON.parse(await readFile(join(o.directory, 'lead-finder', 'leads.json'), 'utf8')) as { leads?: Array<Record<string, unknown>> }; return (raw.leads ?? []).filter(l => typeof l?.name === 'string' && typeof l?.key === 'string').map(l => ({ key: String(l.key), name: String(l.name), ...(typeof l.area === 'string' ? { area: l.area } : {}), ...(typeof l.category === 'string' ? { category: l.category } : {}), ...(typeof l.phone === 'string' ? { phone: l.phone } : {}) })); }
      catch { return []; }
    },
  });
  const handle = (name: string, action: (...args: any[]) => unknown) => ipcMain.handle(`flowdesk:customers:${name}`, (event, ...args) => { o.trusted(event); return action(...args); });
  handle('state', () => customers.view());
  handle('set-capture', (v: unknown) => customers.setCapture(v));
  handle('save-followup-settings', (v: unknown) => customers.saveFollowUpSettings(v));
  handle('save-lines', (v: unknown) => customers.saveLines(v));
  handle('seed-lines', () => customers.seedLines());
  handle('add', (name: unknown, channel: unknown) => customers.addProfile(name, channel));
  handle('set-fact', (id: unknown, field: unknown, value: unknown) => customers.setFact(id, field, value));
  handle('rename', (id: unknown, name: unknown, aliases: unknown) => customers.rename(id, name, aliases));
  handle('set-tags', (id: unknown, tags: unknown) => customers.setTags(id, tags));
  handle('add-note', (id: unknown, text: unknown) => customers.addNote(id, text));
  handle('remove-note', (id: unknown, at: unknown) => customers.removeNote(id, at));
  handle('set-next', (id: unknown, at: unknown, reason: unknown) => customers.setNextFollowUp(id, at, reason));
  handle('add-purchase', (id: unknown, input: unknown) => customers.addPurchase(id, input));
  handle('remove-purchase', (id: unknown, purchaseId: unknown) => customers.removePurchase(id, purchaseId));
  handle('merge', (into: unknown, from: unknown) => customers.merge(into, from));
  handle('remove', (id: unknown) => customers.remove(id));
  handle('save-segment', (name: unknown, filter: unknown) => customers.saveSegment(name, filter));
  handle('remove-segment', (id: unknown) => customers.removeSegment(id));
  handle('make-list', () => customers.makeListNow());
  handle('approve', (id: unknown) => customers.approve(id));
  handle('edit', (id: unknown, text: unknown) => customers.edit(id, text));
  handle('skip', (id: unknown) => customers.skip(id));
  handle('redraft', (id: unknown) => customers.redraft(id));
  handle('create-broadcast', (input: unknown) => customers.createBroadcast(input));
  handle('edit-broadcast-item', (id: unknown, profileId: unknown, text: unknown) => customers.editBroadcastItem(id, profileId, text));
  handle('remove-broadcast-item', (id: unknown, profileId: unknown, removed: unknown) => customers.removeBroadcastItem(id, profileId, removed));
  handle('start-broadcast', (id: unknown) => customers.startBroadcast(id));
  handle('stop-broadcast', (id: unknown) => customers.stopBroadcast(id));
  handle('remove-broadcast', (id: unknown) => customers.removeBroadcast(id));
  // The file comes from the system picker, never from a path typed by the page.
  handle('import-pick', async () => {
    const r = await dialog.showOpenDialog({ title: '选一个客户表（Excel 或 CSV）', properties: ['openFile'], filters: [{ name: '表格', extensions: ['xlsx', 'csv'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    return customers.previewImport(basename(r.filePaths[0]), await readSheet(r.filePaths[0]));
  });
  handle('import-commit', (token: unknown, mapping: unknown, line: unknown) => customers.commitImport(token, mapping, line));
  handle('export', async (filter: unknown) => {
    const r = await dialog.showSaveDialog({ title: '导出客户表', defaultPath: join(app.getPath('documents'), `咔哒-客户档案-${new Date().toISOString().slice(0, 10)}.csv`), filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (r.canceled || !r.filePath) return null;
    await writeFile(r.filePath, customers.exportCsv(filter), 'utf8'); return basename(r.filePath);
  });
  const clock = setInterval(() => { void customers.tick().catch(error => recordDiag('customers-tick', { error: error instanceof Error ? error.name : 'failed' })); }, 30_000); clock.unref?.();
  app.once('will-quit', () => { clearInterval(clock); });
  return customers;
}
