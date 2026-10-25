import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, BookOpen, LifeBuoy, ListTodo, LoaderCircle, MessageCircleQuestion, Search, Send, Sparkles, X } from 'lucide-react';
import type { Task } from '../shared/types';
import { featureById, searchFeatures, type FeatureEntry, type FeatureOpen } from '../shared/feature-index';
import { manualRoute, parseManualRoute, searchManual, type ManualHit } from '../shared/manual';
import { api, navigate } from './api';
import { Modal } from './components';
import './help-assistant.css';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function waitFor<T>(find: () => T | null | undefined, ms: number): Promise<T | undefined> {
  const end = Date.now() + ms;
  for (;;) { const found = find(); if (found) return found; if (Date.now() > end) return undefined; await sleep(80); }
}
const squash = (s: string) => s.replace(/\s+/g, '');
const textOf = (el: Element) => squash(el.textContent || '');
const shown = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 || r.height > 0; };
const pageRoot = () => document.querySelector('.app-content') ?? document.body;

function clickable(text: string): HTMLElement | undefined {
  const wanted = squash(text), els = [...pageRoot().querySelectorAll<HTMLElement>('[role=tab], button, summary')].filter(shown);
  return els.find(e => textOf(e) === wanted) ?? els.find(e => textOf(e).startsWith(wanted));
}
const isOpen = (el: HTMLElement) => el.tagName === 'SUMMARY' ? !!(el.parentElement as HTMLDetailsElement | null)?.open
  : el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-expanded') === 'true' || el.classList.contains('active') || el.classList.contains('selected');

const GROUPS = ['h1, h2, h3, h4', 'summary', '.field > span, legend, label', 'button, [role=tab]'];
function locate(entry: FeatureEntry): HTMLElement | undefined {
  if (entry.target) { const el = document.getElementById(entry.target); if (el) return el; }
  if (!entry.find) return undefined;
  const root = pageRoot();
  for (const alt of entry.find.split('|').map(squash)) {
    const candidates = GROUPS.flatMap(sel => [...root.querySelectorAll<HTMLElement>(sel)]);
    const hit = candidates.find(e => textOf(e) === alt) ?? candidates.find(e => textOf(e).startsWith(alt));
    if (hit) return hit;
  }
  return undefined;
}
function highlight(el: HTMLElement) {
  for (let p = el.parentElement; p; p = p.parentElement) if (p instanceof HTMLDetailsElement && !p.open) p.open = true;
  const box = /^H[1-4]$/.test(el.tagName) ? el.closest<HTMLElement>('section, .panel') ?? el : el.tagName === 'SUMMARY' ? el.parentElement ?? el : el.closest<HTMLElement>('.field') ?? el;
  box.scrollIntoView({ block: 'center', behavior: 'smooth' });
  box.classList.add('feature-focus');
  setTimeout(() => box.classList.remove('feature-focus'), 2600);
}

/** Opens a feature-index entry: route → open tabs / collapsed parts → scroll and highlight. Never changes a setting. */
export async function goToFeature(entry: FeatureEntry, onOpen: (open: FeatureOpen) => void): Promise<boolean> {
  if (entry.open) {
    if (entry.open === 'diagnostics' || entry.open === 'feedback') {
      const label = entry.open === 'diagnostics' ? '帮助与日志' : '反馈问题';
      const button = [...document.querySelectorAll<HTMLElement>('.app-topbar button')].find(b => textOf(b) === label);
      if (button) { button.click(); return true; }
      navigate(entry.route);
      return false;
    }
    onOpen(entry.open); return true;
  }
  try { await window.flowdesk?.setWindowMode?.('expanded'); } catch { /* browser build */ }
  if (window.location.hash.slice(1) !== entry.route) { navigate(entry.route); await sleep(250); }
  // Lazy pages show a plain 「正在加载…」 first; wait until the page has its own headings.
  await waitFor(() => pageRoot().querySelector('h1, h2'), 3000);
  for (const raw of entry.steps ?? []) {
    const optional = raw.startsWith('?'), step = optional ? raw.slice(1) : raw;
    const el = optional ? clickable(step) : await waitFor(() => clickable(step), 1500);
    if (el && !isOpen(el)) { el.click(); await sleep(160); }
  }
  window.dispatchEvent(new CustomEvent('kadadesk:focus', { detail: { id: entry.id, target: entry.target, find: entry.find } }));
  const el = (entry.target || entry.find) ? await waitFor(() => locate(entry), 3000) : undefined;
  if (el) { await sleep(entry.route.startsWith('settings/') ? 250 : 0); highlight(el); return true; }
  if (!entry.target && !entry.find) { window.scrollTo({ top: 0, behavior: 'smooth' }); return true; }
  return false;
}

const POPULAR = ['settings.backup-model', 'settings.theme', 'settings.model', 'help.manual', 'help.diagnostics', 'knowledge.repos'];
const isMac = () => /macintosh|mac os x/i.test(navigator.userAgent);
export const searchShortcut = () => isMac() ? '⌘K' : 'Ctrl K';

type Row = { kind: 'feature'; entry: FeatureEntry } | { kind: 'manual'; hit: ManualHit } | { kind: 'task'; task: Task };
/** ⌘K: every feature and setting, plus the existing task search. */
export function FeatureSearch({ tasks, onClose, onOpen, onAsk, onMissed }: { tasks: Task[]; onClose: () => void; onOpen: (open: FeatureOpen) => void; onAsk: (question: string) => void; onMissed?: (entry: FeatureEntry) => void }) {
  const [query, setQuery] = useState(''); const [active, setActive] = useState(0);
  const q = query.trim();
  const rows = useMemo<Row[]>(() => {
    const features = q ? searchFeatures(q, 8) : POPULAR.map(featureById).filter((f): f is FeatureEntry => !!f);
    const lower = q.toLowerCase();
    const taskRows = q ? tasks.filter(t => `${t.title} ${t.input} ${t.reply}`.toLowerCase().includes(lower)).slice(0, 6) : [];
    const manualRows = q ? searchManual(q, 3) : [];
    return [...features.map(entry => ({ kind: 'feature' as const, entry })), ...manualRows.map(hit => ({ kind: 'manual' as const, hit })), ...taskRows.map(task => ({ kind: 'task' as const, task }))];
  }, [q, tasks]);
  useEffect(() => setActive(0), [q]);
  const pick = (row: Row) => {
    if (row.kind === 'task') { navigate(`task/${row.task.id}`); onClose(); return; }
    if (row.kind === 'manual') { navigate(manualRoute(row.hit.chapterId, row.hit.sectionId || undefined)); onClose(); return; }
    onClose();
    void goToFeature(row.entry, onOpen).then(ok => { if (!ok) onMissed?.(row.entry); });
  };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(rows.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (rows[active]) pick(rows[active]); else if (q) { onClose(); onAsk(q); } }
  };
  const firstTask = rows.findIndex(r => r.kind === 'task'), firstManual = rows.findIndex(r => r.kind === 'manual');
  const rowKey = (row: Row) => row.kind === 'task' ? row.task.id : row.kind === 'manual' ? `manual:${row.hit.chapterId}/${row.hit.sectionId}` : row.entry.id;
  return <Modal title="搜索功能" subtitle="写你想做的事，比如「换颜色」「被限流了」「导入资料」" onClose={onClose}>
    <div className="search-box"><Search size={18} /><input autoFocus aria-label="搜索功能和任务" placeholder="搜索功能、设置或任务…" maxLength={100} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={keys} /></div>
    <div className="search-results feature-results" role="listbox" aria-label="搜索结果">
      {!q && <p className="feature-results-head">常用</p>}
      {rows.map((row, i) => <div key={rowKey(row)}>
        {i === firstManual && <p className="feature-results-head">使用手册</p>}
        {i === firstTask && <p className="feature-results-head">任务</p>}
        <button type="button" role="option" aria-selected={i === active} className={i === active ? 'is-active' : ''} onMouseEnter={() => setActive(i)} onClick={() => pick(row)}>
          {row.kind === 'task' ? <><ListTodo size={18} /><span><strong>{row.task.title}</strong><small>{row.task.input.slice(0, 70)}</small></span><ArrowUpRight size={16} /></>
            : row.kind === 'manual' ? <><BookOpen size={17} /><span><strong>{row.hit.title}</strong><small>使用手册 · {row.hit.chapterTitle} · {row.hit.snippet}</small></span><em className="feature-go">看说明<ArrowUpRight size={14} /></em></>
            : <><Sparkles size={17} /><span><strong>{row.entry.label}</strong><small>{row.entry.where} · {row.entry.summary}</small></span><em className="feature-go">去这里<ArrowUpRight size={14} /></em></>}
        </button>
      </div>)}
      {q && !rows.length && <div className="feature-empty"><p>没找到「{q}」相关的功能。</p><button type="button" className="btn btn-primary" onClick={() => { onClose(); onAsk(q); }}><MessageCircleQuestion size={16} />问问 AI</button></div>}
    </div>
    {q && rows.length > 0 && <button type="button" className="feature-ask-link" onClick={() => { onClose(); onAsk(q); }}>没找到想要的？问问 AI：「{q.slice(0, 30)}」</button>}
  </Modal>;
}

type Turn = { role: 'user' | 'assistant'; text: string; actions?: string[]; manual?: { route: string; title: string }; error?: boolean };
const EXAMPLES = ['模型被限流了怎么办', '怎么从私有仓库同步知识', '客户档案怎么分类', '怎么配置备用模型'];
const MAX_QUESTION = 300;
/** Only a route that names a real manual chapter becomes a link. */
function manualLink(value?: { route?: unknown; title?: unknown }): Turn['manual'] {
  if (!value || typeof value.route !== 'string' || typeof value.title !== 'string' || !parseManualRoute(value.route).chapter) return undefined;
  return { route: value.route, title: value.title.slice(0, 60) };
}

async function helpContext() {
  const bridge = window.flowdesk;
  const context: Record<string, unknown> = { platform: bridge ? (isMac() ? 'mac' : 'windows') : 'browser', page: window.location.hash.slice(1) };
  return context;
}

/** 问咔哒怎么用: answers from the product handbook; suggested actions only navigate. */
export function HelpAssistant({ open, question, onClose, onOpen }: { open: boolean; question?: { text: string; at: number }; onClose: () => void; onOpen: (open: FeatureOpen) => void }) {
  const [turns, setTurns] = useState<Turn[]>([]); const [draft, setDraft] = useState(''); const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null); const input = useRef<HTMLTextAreaElement>(null);
  const ask = async (text: string) => {
    const q = text.replace(/\s+/g, ' ').trim();
    if (!q || busy) return;
    if (q.length > MAX_QUESTION) { setTurns(t => [...t, { role: 'assistant', text: `问题太长了，请用 ${MAX_QUESTION} 个字以内说清楚。`, error: true }]); return; }
    setTurns(t => [...t, { role: 'user', text: q }]); setDraft(''); setBusy(true);
    try {
      const r = await api<{ answer: string; actions: string[]; manual?: { route?: unknown; title?: unknown } }>('POST', '/help/ask', { question: q, context: await helpContext() });
      setTurns(t => [...t, { role: 'assistant', text: r.answer, actions: (r.actions ?? []).filter(id => featureById(id)), manual: manualLink(r.manual) }]);
    } catch (e) {
      setTurns(t => [...t, { role: 'assistant', text: (e as Error).message || '暂时回答不了，请稍后再问。', actions: ['help.diagnostics'], error: true }]);
    } finally { setBusy(false); }
  };
  useEffect(() => { if (open && question?.text) void ask(question.text); }, [question?.at]);
  useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 50); }, [open]);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' }); }, [turns, busy]);
  useEffect(() => { if (!open) return; const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', fn); return () => document.removeEventListener('keydown', fn); }, [open, onClose]);
  if (!open) return null;
  return <aside className="help-assistant" role="dialog" aria-label="问咔哒怎么用">
    <header><span><MessageCircleQuestion size={18} /></span><div><strong>问咔哒怎么用</strong><small>只回答怎么用咔哒；不会替你改设置</small></div><button type="button" className="icon-button" aria-label="关闭问咔哒" onClick={onClose}><X size={17} /></button></header>
    <div className="help-turns" ref={list}>
      {!turns.length && <div className="help-intro"><p>用一句话问，比如：</p>{EXAMPLES.map(x => <button type="button" key={x} onClick={() => void ask(x)}>{x}</button>)}<p className="help-manual-hint">想从头看？<button type="button" className="manual-link" onClick={() => navigate('manual')}><BookOpen size={13} />打开使用手册</button></p></div>}
      {turns.map((t, i) => <div key={i} className={`help-turn is-${t.role}${t.error ? ' is-error' : ''}`}><p>{t.text}</p>
        {t.manual && <button type="button" className="manual-link help-manual-link" onClick={() => navigate(t.manual!.route)}><BookOpen size={13} />在使用手册里看完整说明：{t.manual.title}</button>}
        {!!t.actions?.length && <div className="help-actions">{t.actions.map(id => { const f = featureById(id)!; return <button type="button" key={id} onClick={() => void goToFeature(f, onOpen)}>{f.id === 'help.diagnostics' ? <LifeBuoy size={14} /> : <ArrowUpRight size={14} />}{f.label}</button>; })}</div>}
      </div>)}
      {busy && <div className="help-turn is-assistant help-thinking"><LoaderCircle size={15} className="spin" />正在查使用手册…</div>}
    </div>
    <form onSubmit={e => { e.preventDefault(); void ask(draft); }}>
      <textarea ref={input} rows={2} aria-label="你想问什么" placeholder="例如：怎么让咔哒每条回复先给我看？" maxLength={MAX_QUESTION} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void ask(draft); } }} />
      <div><small>{draft.length}/{MAX_QUESTION} · 回答只供参考，按钮只会带你过去</small><button type="submit" className="btn btn-primary" disabled={busy || !draft.trim()} aria-label="发送问题"><Send size={15} /></button></div>
    </form>
  </aside>;
}

/** 「问咔哒」 in the top bar of every page, in the theme colour: the first place a new user looks when stuck
 *  (the old bottom-right bubble was easy to miss). */
export function HelpButton({ onClick, active }: { onClick: () => void; active?: boolean }) {
  return <button type="button" className={`help-topbar${active ? ' is-open' : ''}`} onClick={onClick} aria-label="问咔哒怎么用" title="不会用？直接问咔哒"><MessageCircleQuestion size={17} /><span>问咔哒</span><small>不会用就问</small></button>;
}
