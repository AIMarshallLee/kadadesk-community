import { useEffect, useRef, useState } from 'react';
import type { KnowledgeImportFile, KnowledgeImportPreview, KnowledgeReviewConflict, KnowledgeReviewResult } from '../shared/knowledge';
import { KNOWLEDGE_IMPORT_LIMITS } from '../shared/knowledge';
import { ONE_STEP_IMPORT_LIMITS, ignoredDocumentPath, importNameFromPath, supportedDocumentName, zipFileName } from '../shared/knowledge-files';
import type { Knowledge } from '../shared/types';
import type { PageProps } from './App';
import { Button } from './components';
import { api, navigate } from './api';
import IndustryTemplates from './IndustryTemplates';
import Tutorial from './Tutorial';
import { categorize, withCategoryTag, knowledgeHealth } from '../shared/knowledge-categories';

const FILE_BYTES = KNOWLEDGE_IMPORT_LIMITS.fileBytes;
const GROUP_FILES = KNOWLEDGE_IMPORT_LIMITS.files;
const GROUP_BASE64 = KNOWLEDGE_IMPORT_LIMITS.base64Characters;
const MB = (n: number) => `${Math.round(n / 1024 / 1024)}MB`;
const readFile = (file: File) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('无法读取 ' + file.name)); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.readAsDataURL(file); });

/** One thing the owner put in: a file with the folder path it came from (「资料/价格.xlsx」). */
type Picked = { file: File; path: string };
type Skip = { name: string; reason: string };
/** A file ready for the import preview: either still on disk (read when its turn comes) or already expanded on the service. */
type Job = { name: string; size: number; file?: File; encoded?: KnowledgeImportFile };
type Outcome = { created: Knowledge[]; approved: string[]; conflicts: KnowledgeReviewConflict[]; duplicates: number; skipped: Skip[]; notes: string[]; auto: boolean };

const shortName = (name: string) => name.split('／').slice(-2).join('／');
/** Plain reasons for a file that could not be read; the run goes on with the next file. */
function reasonOf(name: string, message: string) {
  const m = message.replace(/^知识导入失败：/, '').trim();
  if (/\.pdf$/i.test(name) && /(不是文本 PDF|没有可识别条目|未找到知识条目|没有可读取的文字)/.test(m)) return '扫描件读不出文字';
  if (/加密|密码/.test(m)) return '文件有密码或已加密';
  if (/表头/.test(m)) return '表格第一行没有「问题」「答案」这样的列名';
  if (/未找到知识条目|没有可识别条目/.test(m)) return '没有读到能用的文字';
  if (/超过 8MB/.test(m)) return '超过 8MB';
  return m.length > 60 ? m.slice(0, 60) + '…' : m || '读取失败';
}
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Folders dropped on the panel: walks the directory entries the browser hands over (all of them, in batches). */
async function walkEntry(entry: FileSystemEntry, prefix: string, out: Picked[], budget: { left: number }, depth = 0): Promise<void> {
  if (budget.left <= 0 || depth > 12) return;
  const path = prefix + entry.name;
  if (ignoredDocumentPath(path)) return;
  if (entry.isFile) {
    budget.left--;
    try { const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject)); out.push({ file, path }); } catch { /* unreadable: skipped */ }
    return;
  }
  if (!entry.isDirectory) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve) => reader.readEntries(resolve, () => resolve([])));
    if (!batch.length) break;
    for (const child of batch) await walkEntry(child, path + '/', out, budget, depth + 1);
    if (budget.left <= 0) return;
  }
}

/** What a basket of dropped files becomes: documents to read, ZIPs to open, and what is left out (with or without a reason). */
function plan(picked: Picked[]) {
  const docs: Picked[] = [], zips: Picked[] = [], skipped: Skip[] = []; let unsupported = 0, ignored = 0, bytes = 0;
  for (const p of picked) {
    if (ignoredDocumentPath(p.path)) { ignored++; continue; }
    if (zipFileName(p.path)) { if (p.file.size > ONE_STEP_IMPORT_LIMITS.zipBytes) skipped.push({ name: importNameFromPath(p.path), reason: `压缩包超过 ${MB(ONE_STEP_IMPORT_LIMITS.zipBytes)}，请解压后拖文件夹` }); else zips.push(p); continue; }
    if (!supportedDocumentName(p.path)) { unsupported++; continue; }
    if (!p.file.size) { skipped.push({ name: importNameFromPath(p.path), reason: '空文件' }); continue; }
    if (p.file.size > FILE_BYTES) { skipped.push({ name: importNameFromPath(p.path), reason: `超过 ${MB(FILE_BYTES)}` }); continue; }
    if (docs.length >= ONE_STEP_IMPORT_LIMITS.files || bytes + p.file.size > ONE_STEP_IMPORT_LIMITS.totalBytes) { skipped.push({ name: importNameFromPath(p.path), reason: `这次先读前 ${ONE_STEP_IMPORT_LIMITS.files} 份（合计 ${MB(ONE_STEP_IMPORT_LIMITS.totalBytes)} 以内），剩下的再丢一次` }); continue; }
    bytes += p.file.size; docs.push(p);
  }
  return { docs, zips, skipped, unsupported, ignored, bytes };
}

/**
 * 一股脑丢进来: 第一步 put everything in (files, folders, ZIPs, links, text) → 第二步 咔哒 reads and organizes each file on its own
 * (a file it cannot read is listed, never stops the run) → 第三步 try a question and start receiving customers.
 * With 自主进化 on, the service enables what it can right away; otherwise the owner confirms the list here.
 */
export default function QuickImport({ state, perform, notify, onDone }: PageProps & { onDone: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [picked, setPicked] = useState<Picked[]>([]); const [links, setLinks] = useState(''); const [text, setText] = useState('');
  const [busy, setBusy] = useState(false); const [progress, setProgress] = useState(''); const [ratio, setRatio] = useState(0);
  const [outcome, setOutcome] = useState<Outcome>(); const [chosen, setChosen] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<string, { answer?: string; busy: boolean; error?: string }>>({});
  const [drag, setDrag] = useState(false); const [reading, setReading] = useState(false);
  const stopRef = useRef(false); const folderRef = useRef<HTMLInputElement>(null);
  const auto = state.preferences.autoEnableKnowledge !== false;
  const health = knowledgeHealth(state.knowledge);
  // The free trial model organizes too; only warn when we know there is neither an own key nor the trial.
  const [trialModel, setTrialModel] = useState<boolean>();
  useEffect(() => { if (state.provider.hasKey) return; let active = true; void api<{ trial: boolean; available: boolean }>('GET', '/model/live').then(v => { if (active) setTrialModel(v.trial && v.available); }).catch(() => {}); return () => { active = false; }; }, [state.provider.hasKey]);

  const basket = plan(picked);
  const allLinks = [...new Set(links.split(/\r?\n/).map(l => l.trim()).filter(Boolean))];
  const linkList = allLinks.slice(0, 100);
  const add = (more: Picked[]) => setPicked(cur => { const seen = new Set(cur.map(p => `${p.path}|${p.file.size}`)); return [...cur, ...more.filter(p => !seen.has(`${p.path}|${p.file.size}`) && (seen.add(`${p.path}|${p.file.size}`), true))]; });
  const addFiles = (list: FileList | null) => add(Array.from(list ?? []).map(file => ({ file, path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name })));
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDrag(false); if (busy) return;
    // Entries must be taken while the drop event lasts; reading them can happen afterwards.
    const entries = Array.from(e.dataTransfer.items ?? []).map(item => item.kind === 'file' ? item.webkitGetAsEntry?.() ?? null : null);
    if (!entries.some(Boolean)) { addFiles(e.dataTransfer.files); return; }
    setReading(true);
    void (async () => { const out: Picked[] = [], budget = { left: 20000 }; for (const entry of entries) if (entry) await walkEntry(entry, '', out, budget); add(out); if (budget.left <= 0) notify('文件太多了：先读了前 20000 个，建议挑业务资料的文件夹拖进来。', true); })().finally(() => setReading(false));
  };
  const reset = () => { setStep(1); setPicked([]); setLinks(''); setText(''); setOutcome(undefined); setChosen([]); setAnswers({}); setProgress(''); setRatio(0); };

  const run = async () => {
    if (!basket.docs.length && !basket.zips.length && !linkList.length && !text.trim()) return notify('先把资料拖进来，或粘贴链接、文字。', true);
    setBusy(true); setStep(2); stopRef.current = false; setRatio(0);
    const skipped: Skip[] = [...basket.skipped], notes: string[] = [], created: Knowledge[] = [], approved: string[] = [], conflicts: KnowledgeReviewConflict[] = [];
    let duplicates = 0, bytes = basket.bytes, autoRan = false;
    const fatal = (error: unknown) => /持续回复|知识库最多|已接近一万/.test((error as Error).message);
    const jobs: Job[] = basket.docs.map(p => ({ name: importNameFromPath(p.path), size: p.file.size, file: p.file }));
    try {
      // ZIPs and links are opened by the service and come back as ordinary files.
      const expand = async (label: string, body: Record<string, unknown>) => {
        const room = { maxFiles: Math.max(0, ONE_STEP_IMPORT_LIMITS.files - jobs.length), maxBytes: Math.max(0, ONE_STEP_IMPORT_LIMITS.totalBytes - bytes) };
        if (!room.maxFiles || !room.maxBytes) { skipped.push({ name: label, reason: '这次资料已经够多了，剩下的再丢一次' }); return; }
        try {
          const result = await api<{ files: KnowledgeImportFile[]; skipped: Skip[] }>('POST', '/knowledge/import/expand', { ...body, ...room });
          for (const f of result.files) { jobs.push({ name: f.name, size: f.size, encoded: f }); bytes += f.size; }
          skipped.push(...result.skipped);
          if (!result.files.length && !result.skipped.length) skipped.push({ name: label, reason: '里面没有能读的资料（支持 PDF、Word、Excel、CSV、TXT、Markdown、网页）' });
        } catch (error) { skipped.push({ name: label, reason: (error as Error).message }); }
      };
      for (const [i, z] of basket.zips.entries()) {
        if (stopRef.current) break;
        setProgress(`正在打开压缩包 ${i + 1}/${basket.zips.length}：${z.file.name}`);
        try { await expand(z.file.name, { zip: { name: z.file.name, size: z.file.size, base64: await readFile(z.file) } }); }
        catch (error) { skipped.push({ name: z.file.name, reason: (error as Error).message }); }
      }
      if (allLinks.length > linkList.length) notes.push(`链接一次最多读 ${linkList.length} 个，还有 ${allLinks.length - linkList.length} 个这次没读；这批完成后再贴一次剩下的就行。`);
      for (const [i, url] of linkList.entries()) {
        if (stopRef.current) break;
        setProgress(`正在读取链接 ${i + 1}/${linkList.length}…`);
        await expand(`链接 ${url}`, { url });
      }

      const live = state.provider.hasKey ? undefined : await api<{ trial: boolean; available: boolean }>('GET', '/model/live').catch(() => undefined);
      let organizeOn = state.provider.hasKey || !!(live?.trial && live.available), organized = 0;
      if (!organizeOn) notes.push('还没接好回复模型：资料按原文导入，没有改写成客户问答。到「设置」一键配置后再导，效果更好。');
      const total = jobs.length + (text.trim() ? 1 : 0); let done = 0;

      /** Preview → organize (capped per run) → commit. A preview failure is the caller's to handle; a commit failure stops the run. */
      const importPreview = async (preview: KnowledgeImportPreview) => {
        let p = preview;
        const ids = p.rows.filter(r => !r.errors.length && !r.duplicateOf).map(r => r.rowId);
        for (let i = 0; organizeOn && i < ids.length && organized < ONE_STEP_IMPORT_LIMITS.organizedRows && !stopRef.current; i += 20) {
          const batch = ids.slice(i, i + Math.min(20, ONE_STEP_IMPORT_LIMITS.organizedRows - organized));
          setProgress(`正在整理成客户问答… 已整理 ${organized + batch.length} 条`);
          try { p = await api<KnowledgeImportPreview>('POST', '/knowledge/import/organize', { previewId: p.previewId, rowIds: batch, allowModel: true }); organized += batch.length; }
          catch (error) {
            // A row this file could not organize keeps its original text; only a model problem stops organizing the rest.
            if (/知识条目无效|所选资料无效/.test((error as Error).message)) break;
            organizeOn = false; notes.push(`自动整理没成功，后面的资料按原文导入：${(error as Error).message}`);
          }
        }
        if (organizeOn && organized >= ONE_STEP_IMPORT_LIMITS.organizedRows && !notes.some(n => n.startsWith('资料很多'))) notes.push(`资料很多：前 ${ONE_STEP_IMPORT_LIMITS.organizedRows} 条整理成了客户问答，其余按原文导入，同样能用来回答。`);
        const rows = p.rows.filter(r => !r.errors.length && !r.duplicateOf);
        duplicates += p.rows.filter(r => r.duplicateOf).length;
        const payload = rows.map(r => ({ rowId: r.rowId, title: r.title, content: r.content, question: r.question ?? '', aliases: r.aliases ?? [], tags: withCategoryTag(r.tags.slice(0, 19), categorize(`${r.title} ${r.question ?? ''} ${r.content.slice(0, 200)}`, r.tags)), scenario: r.scenario ?? 'all' }));
        for (let i = 0; i < payload.length; i += KNOWLEDGE_IMPORT_LIMITS.rows) {
          const committed = await api<{ created: Knowledge[]; skipped: number; autoEnabled?: KnowledgeReviewResult }>('POST', '/knowledge/import/commit', { previewId: p.previewId, confirm: true, rows: payload.slice(i, i + KNOWLEDGE_IMPORT_LIMITS.rows), ...(p.replaces?.length ? { replacePrevious: true } : {}) });
          created.push(...committed.created); duplicates += committed.skipped;
          if (committed.autoEnabled) { autoRan = true; approved.push(...committed.autoEnabled.approved); conflicts.push(...committed.autoEnabled.conflicts); }
        }
      };
      const preview = async (body: Record<string, unknown>) => {
        try { return await api<KnowledgeImportPreview>('POST', '/knowledge/import/preview', body); }
        catch (error) { if (!/正在解析/.test((error as Error).message)) throw error; await wait(1500); return api<KnowledgeImportPreview>('POST', '/knowledge/import/preview', body); }
      };
      const encode = async (job: Job): Promise<KnowledgeImportFile> => job.encoded ?? { name: job.name, size: job.size, base64: await readFile(job.file!) };
      const one = async (job: Job) => {
        try { await importPreview(await preview({ files: [await encode(job)] })); }
        catch (error) { if (fatal(error)) throw error; skipped.push({ name: job.name, reason: reasonOf(job.name, (error as Error).message) }); }
      };

      // A few small files are read together; when such a group fails, each file is tried on its own so one bad file only skips itself.
      for (let i = 0; i < jobs.length && !stopRef.current;) {
        const group: Job[] = []; let chars = 0;
        while (i < jobs.length && group.length < GROUP_FILES && (!group.length || chars + Math.ceil(jobs[i].size / 3) * 4 <= GROUP_BASE64)) { chars += Math.ceil(jobs[i].size / 3) * 4; group.push(jobs[i++]); }
        setProgress(`正在读第 ${done + 1}${group.length > 1 ? `–${done + group.length}` : ''}/${total} 份：${shortName(group[0].name)}${group.length > 1 ? ' 等' : ''}`); setRatio(done / Math.max(1, total));
        if (group.length === 1) await one(group[0]);
        else {
          let files: KnowledgeImportFile[] | undefined;
          try { files = await Promise.all(group.map(encode)); } catch { files = undefined; }
          let p: KnowledgeImportPreview | undefined;
          if (files) try { p = await preview({ files }); } catch { p = undefined; }
          if (p) {
            try { await importPreview(p); }
            catch (error) { if (fatal(error)) throw error; for (const job of group) skipped.push({ name: job.name, reason: reasonOf(job.name, (error as Error).message) }); }
          } else for (const job of group) { if (stopRef.current) break; await one(job); }
        }
        done += group.length;
      }
      if (text.trim() && !stopRef.current) {
        setProgress(`正在读第 ${total}/${total} 份：粘贴的文字`);
        try { await importPreview(await preview({ text: text.trim(), textKind: 'document', sourceName: '粘贴资料' })); }
        catch (error) { if (fatal(error)) throw error; skipped.push({ name: '粘贴的文字', reason: reasonOf('粘贴的文字', (error as Error).message) }); }
      }
      setRatio(1);
      if (stopRef.current) notes.push('已经停下：读完的资料已保存，没读的这次没有导入。');
      // 自主进化 ran on the service: straight to 第三步. Otherwise (turned off, or it could not run) the owner confirms here.
      const result: Outcome = { created, approved, conflicts, duplicates, skipped, notes, auto: autoRan };
      setOutcome(result); onDone(); await perform('GET', '/state');
      if (!created.length) { setStep(2); return; }
      if (!autoRan) { setChosen(created.filter(k => k.reviewStatus === 'pending' && selectable(k)).map(k => k.id)); setStep(2); return; }
      finish(result);
    } catch (error) {
      notify(`${created.length ? `已保存 ${created.length} 条；` : ''}${(error as Error).message}`, true);
      setOutcome({ created, approved, conflicts, duplicates, skipped, notes, auto: autoRan }); setChosen(created.filter(k => k.reviewStatus === 'pending' && selectable(k)).map(k => k.id)); setStep(2);
    } finally { setBusy(false); setProgress(''); }
  };
  /** 【】 not filled or 内部资料: not preselected when the owner confirms by hand. */
  const selectable = (k: Knowledge) => !/【[^】]*】/.test(`${k.title}\n${k.question ?? ''}\n${k.content}`) && categorize(`${k.title} ${k.question ?? ''}`, k.tags) !== '内部资料';
  const samplesOf = (items: Knowledge[], ids: string[]) => [...new Set(items.filter(k => ids.includes(k.id) && categorize(`${k.title} ${k.question ?? ''}`, k.tags) !== '内部资料').map(k => (k.question || k.title).trim()))].filter(q => q.length >= 4).slice(0, 3);
  const finish = (result: Outcome) => {
    setOutcome(result); setAnswers({}); setStep(3);
    // 惊喜时刻: answer up to three customer questions right away, so the owner sees it knows the business.
    void (async () => { for (const q of samplesOf(result.created, result.approved)) await ask(q); })();
  };
  const confirmChosen = async () => {
    if (!outcome || !chosen.length) return notify('至少选一条。', true);
    setBusy(true); setProgress('正在启用…');
    const approved: string[] = [], conflicts: KnowledgeReviewConflict[] = [];
    try {
      for (let i = 0; i < chosen.length; i += KNOWLEDGE_IMPORT_LIMITS.rows) {
        const reviewed = await api<{ review: KnowledgeReviewResult }>('POST', '/knowledge/review', { ids: chosen.slice(i, i + KNOWLEDGE_IMPORT_LIMITS.rows), approved: true, partial: true });
        approved.push(...reviewed.review.approved); conflicts.push(...reviewed.review.conflicts);
      }
      await perform('GET', '/state'); finish({ ...outcome, approved, conflicts });
    } catch (error) { notify((error as Error).message, true); } finally { setBusy(false); setProgress(''); }
  };
  /** 停用旧条目并启用新条目: the owner decides the new answer replaces the one in use. */
  const resolve = async (conflict: KnowledgeReviewConflict) => {
    try {
      const reviewed = await api<{ review: KnowledgeReviewResult }>('POST', '/knowledge/review', { ids: [conflict.id], approved: true, partial: true, retireIds: conflict.conflictIds });
      const left = reviewed.review.conflicts[0];
      setOutcome(cur => cur && ({ ...cur, approved: [...cur.approved, ...reviewed.review.approved], conflicts: left ? cur.conflicts.map(c => c.id === conflict.id ? left : c) : cur.conflicts.filter(c => c.id !== conflict.id) }));
      if (left) notify(left.reason, true); await perform('GET', '/state');
    } catch (error) { notify((error as Error).message, true); }
  };
  const replaceable = (conflict: KnowledgeReviewConflict) => conflict.conflictIds.length > 0 && conflict.conflictIds.every(id => state.knowledge.some(k => k.id === id && k.enabled && k.reviewStatus !== 'pending'));
  const ask = async (question: string) => {
    setAnswers(cur => ({ ...cur, [question]: { busy: true } }));
    try { const view = await api<{ records: Array<{ question: string; answer: string }> }>('POST', '/knowledge/training/answer', { question, history: [], allowModel: true }); const hit = view.records.find(r => r.question === question) ?? view.records[0]; setAnswers(cur => ({ ...cur, [question]: { busy: false, answer: hit?.answer || '（没有生成回答）' } })); }
    catch (error) { setAnswers(cur => ({ ...cur, [question]: { busy: false, error: (error as Error).message } })); }
  };

  const stepClass = (n: number) => step === n ? 'active' : step > n ? 'done' : '';
  const skippedList = (list: Skip[]) => list.length > 0 && <details className="qi-health" open={list.length <= 5}><summary className="muted">跳过了 {list.length} 份（其他的照常导入）</summary>{list.slice(0, 50).map((s, i) => <div key={i} className="muted" style={{ overflowWrap: 'anywhere' }}>跳过：{shortName(s.name)}（{s.reason}）</div>)}{list.length > 50 && <div className="muted">……还有 {list.length - 50} 份</div>}</details>;
  const enabledCount = outcome?.approved.length ?? 0;
  const samples = outcome ? samplesOf(outcome.created, outcome.approved) : [];
  const folderAttrs = { webkitdirectory: '', directory: '' } as Record<string, string>;
  return <section className="panel quick-import">
    <div className="qi-steps">{[[1, '第一步 把资料丢进来'], [2, '第二步 咔哒自己整理'], [3, '第三步 试问一句']].map(([n, label]) => <span key={n} className={stepClass(n as number)}><b>{step > (n as number) ? '✓' : n}</b>{label}</span>)}</div>
    {step === 1 && <>
      <Tutorial id="knowledge" />
      <label className={`qi-drop ${drag ? 'drag' : ''}`} onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
        <input aria-label="选择资料文件" type="file" multiple disabled={busy} onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
        <strong>{reading ? '正在看文件夹里有什么…' : picked.length ? `已放进 ${basket.docs.length} 份资料${basket.zips.length ? `、${basket.zips.length} 个压缩包` : ''}` : '把所有资料一股脑拖到这里'}</strong>
        <span>{picked.length ? `${basket.docs.slice(0, 3).map(p => p.file.name).join('、')}${basket.docs.length > 3 ? ' 等' : ''}${basket.unsupported ? ` · ${basket.unsupported} 个不认识的文件会跳过` : ''} · 还可以继续拖` : '文件、整个文件夹、ZIP 压缩包都行 · 产品介绍、价格表、常见问题、聊天记录…'}</span>
      </label>
      <div className="qi-actions" style={{ marginTop: 8 }}>
        <Button variant="secondary" disabled={busy} onClick={() => folderRef.current?.click()}>选文件夹</Button>
        <input ref={folderRef} type="file" multiple hidden {...folderAttrs} onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
        {picked.length > 0 && <Button variant="ghost" disabled={busy} onClick={() => setPicked([])}>清空重选</Button>}
        <span className="muted">支持 PDF、Word、Excel、CSV、TXT、Markdown、网页；一次最多 {ONE_STEP_IMPORT_LIMITS.files} 份、{MB(ONE_STEP_IMPORT_LIMITS.totalBytes)}</span>
      </div>
      {skippedList(basket.skipped)}
      <div className="qi-link" style={{ marginTop: 12 }}>
        <label htmlFor="qi-links" style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>有 GitHub 仓库或网页？把链接贴在这里</label>
        <textarea id="qi-links" className="qi-text" aria-label="粘贴链接" rows={2} placeholder="https://github.com/用户名/仓库名 或网页地址，一行一个" value={links} onChange={e => setLinks(e.target.value)} disabled={busy} />
        <span className="muted" style={{ fontSize: 12 }}>这里读一次公开的仓库或网页。私有仓库、或者资料会不定期更新的：用下面的「自动更新的知识来源」，咔哒会自己定期更新。</span>
      </div>
      <details style={{ marginTop: 8 }} open={!!text}>
        <summary className="muted">或者直接粘贴文字</summary>
        {/【[^】]*】/.test(text) && <p className="muted" style={{ textAlign: 'center', margin: '6px 0' }}>还有 {(text.match(/【[^】]*】/g) ?? []).length} 处【】没填。用不上的问答可以整段删掉。</p>}
        <textarea className="qi-text" aria-label="快速导入正文" rows={/【[^】]*】/.test(text) ? 16 : 4} placeholder="把资料内容粘贴到这里…" value={text} onChange={e => setText(e.target.value)} disabled={busy} />
      </details>
      <div className="qi-actions"><Button busy={busy} disabled={reading} onClick={() => void run()}>开始整理</Button><span className="muted">{auto ? '咔哒会自己拆成客户问答、分好类，整理完就能用。' : '整理完你点确认后才会用来回复客户。'}不对客户说的内容会归到「内部资料」，不会启用。</span></div>
      {!state.provider.hasKey && trialModel === false && <p className="dr-warning" style={{ marginTop: 10 }}>还没接好回复模型：会按原文导入，不会自动改写成问答。到「设置」一键配置后再导，效果更好。</p>}
      <div className="intake-or">没有现成资料？选个行业样板，把【】换成你的信息</div>
      {/* 样板 goes in as 待审核 and is never enabled automatically: unfilled 【】 must never reach a customer. */}
      <IndustryTemplates perform={perform} notify={notify} collapsed={state.knowledge.some(k => !k.id.startsWith('knowledge_demo_'))} />
      {health.secrets.length > 0 && <p className="dr-warning" role="status">有 {health.secrets.length} 条资料里有像密钥、密码、验证码或证件号的内容（比如「{health.secrets[0]}」）。咔哒回复时会自动隐藏、绝不发给客户，但建议到「管理资料」里删掉这部分</p>}
      {health.total > 0 && health.gaps.length > 0 && <p className="muted qi-health">知识体检：已启用 {health.total} 条，还缺 {health.gaps.map(g => `「${g.category}」（${g.hint}）`).join('、')}。</p>}
    </>}
    {step === 2 && <>
      {busy && !outcome && <>
        <p><strong>{progress || '正在准备…'}</strong></p>
        <progress value={ratio} max={1} style={{ width: '100%' }} aria-label="整理进度" />
        <div className="qi-actions"><Button variant="secondary" onClick={() => { stopRef.current = true; setProgress('正在停下…'); }}>停下</Button><span className="muted">资料多的话要几分钟，可以先去做别的，别关咔哒。</span></div>
      </>}
      {outcome && <>
        {outcome.created.length === 0
          ? <p><strong>这次没有导入新内容。</strong>{outcome.duplicates ? `${outcome.duplicates} 条和已有内容一样，已跳过。` : '看看下面跳过的原因，换一份资料再试。'}</p>
          : outcome.auto ? <p><strong>已保存 {outcome.created.length} 条，其中 {outcome.approved.length} 条已启用。</strong>剩下的可以勾选后启用，或到「管理资料」里处理。</p>
          : <p><strong>整理好了 {outcome.created.length} 条。</strong>确认后才会用来回复客户。不想要的取消勾选；【】没填和内部资料默认不选。</p>}
        {outcome.notes.map(n => <p key={n} className="muted qi-health">{n}</p>)}
        {skippedList(outcome.skipped)}
        {outcome.created.length > 0 && <div className="dr-knowledge-list" style={{ maxHeight: 420 }}>{outcome.created.map(k => <label key={k.id} style={{ display: 'grid', gridTemplateColumns: '24px 1fr 110px', gap: 8, alignItems: 'center', padding: '6px 0', borderTop: '1px solid #f0f2f5' }}>
          <input type="checkbox" checked={chosen.includes(k.id)} disabled={busy || k.reviewStatus !== 'pending'} onChange={e => setChosen(cur => e.target.checked ? [...cur, k.id] : cur.filter(id => id !== k.id))} />
          <div><strong style={{ fontSize: 13 }}>{k.question || k.title}</strong><div className="muted" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.content.slice(0, 80)}</div></div>
          <small className="muted">{k.reviewStatus !== 'pending' ? '已启用' : categorize(`${k.title} ${k.question ?? ''}`, k.tags)}</small>
        </label>)}</div>}
        <div className="qi-actions">
          {outcome.created.length > 0 && <Button busy={busy} disabled={!chosen.length} onClick={() => void confirmChosen()}>启用选中的 {chosen.length} 条</Button>}
          <Button variant="secondary" disabled={busy} onClick={reset}>{outcome.created.length ? '先不启用，再丢一批' : '再丢一批资料'}</Button><span className="muted">{progress}</span>
        </div>
      </>}
    </>}
    {step === 3 && outcome && <>
      <p><strong>已启用 {enabledCount} 条</strong>{outcome.duplicates ? `，跳过重复 ${outcome.duplicates} 条` : ''}。现在客户问到这些，咔哒就按它们回答。</p>
      {outcome.notes.map(n => <p key={n} className="muted qi-health">{n}</p>)}
      {skippedList(outcome.skipped)}
      {outcome.conflicts.length > 0 && <div className="dr-warning"><p style={{ margin: '0 0 6px' }}>还有 {outcome.conflicts.length} 条没有启用，等你决定：</p>{outcome.conflicts.slice(0, 20).map(c => <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0' }}><span style={{ flex: 1 }}>{c.reason}</span>{replaceable(c) && <Button variant="secondary" onClick={() => void resolve(c)}>停用旧条目并启用新条目</Button>}</div>)}{outcome.conflicts.length > 20 && <p className="muted" style={{ margin: 0 }}>……还有 {outcome.conflicts.length - 20} 条</p>}<p className="muted" style={{ margin: '6px 0 0' }}>其他的可以到「管理资料」里修改后再启用。</p></div>}
      {samples.length > 0 && <div className="qi-samples"><p style={{ margin: '6px 0' }}>试问一句：咔哒已经在用你的资料回答了，看看答得怎么样（只在这里试，不会发给客户）：</p>{samples.map(q => <div key={q} className="qi-sample"><div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span style={{ flex: 1 }}>{q}</span><Button variant="secondary" busy={answers[q]?.busy} onClick={() => void ask(q)}>{answers[q]?.answer ? '再试' : '试答'}</Button></div>{answers[q]?.answer && <p className="muted" style={{ whiteSpace: 'pre-wrap', margin: '4px 0 8px' }}>{answers[q].answer}</p>}{answers[q]?.error && <p className="dr-warning">{answers[q].error}</p>}</div>)}</div>}
      {health.gaps.length > 0 && <p className="muted">下一步补齐：{health.gaps.map(g => `「${g.category}」（${g.hint}）`).join('、')}。</p>}
      <div className="qi-actions">
        {/* The setup guide checks the chat window, model and license before it starts receiving customers. */}
        <Button onClick={() => navigate('setup')}>开始接待</Button>
        <Button variant="secondary" onClick={reset}>再丢一批资料</Button>
        <Button variant="ghost" onClick={() => { const el = document.getElementById('coach-practice'); el?.scrollIntoView({ behavior: 'smooth', block: 'start' }); el?.querySelector('textarea')?.focus({ preventScroll: true }); }}>自己再问几个</Button>
      </div>
    </>}
  </section>;
}
