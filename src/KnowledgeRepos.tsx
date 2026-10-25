import { useEffect, useRef, useState } from 'react';
import type { PageProps } from './App';
import { api } from './api';
import { Button, formatTime } from './components';
import { useConfirm } from './OnceTip';
import { REPO_PURPOSES, REPO_SYNC_LIMITS, type RepoFolder, type RepoPurpose, type RepoRules, type RepoSourceView, type RepoView } from '../shared/knowledge-repos';

const PURPOSES = Object.entries(REPO_PURPOSES) as Array<[RepoPurpose, { label: string; hint: string }]>;
const row: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' };

/**
 * 自动更新的知识来源: a GitHub repository or a folder on this computer. kadadesk checks it for changes when it is not busy
 * (every few hours) and organizes only new and changed files. The owner picks which folders go in and what each is for.
 */
export default function KnowledgeRepos({ notify, perform }: PageProps) {
  const [view, setView] = useState<RepoView>();
  const [adding, setAdding] = useState(false); const [url, setUrl] = useState(''); const [working, setWorking] = useState(false);
  const [open, setOpen] = useState<string>(); const [drafts, setDrafts] = useState<Record<string, RepoRules>>({});
  const wasRunning = useRef(false);
  const [confirmDialog, ask] = useConfirm();
  const load = () => api<RepoView>('GET', '/knowledge/repos').then(next => { setView(next); return next; });
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try { const next = await load(); if (!active) return; if (wasRunning.current && !next.running) void perform('GET', '/state'); wasRunning.current = !!next.running; timer = setTimeout(tick, next.running || next.sources.some(s => s.status === 'preparing') ? 2000 : 15000); }
      catch { if (active) timer = setTimeout(tick, 15000); }
    };
    void tick(); return () => { active = false; if (timer) clearTimeout(timer); };
  }, []);
  const run = async (action: () => Promise<RepoView | null>, done?: string) => {
    setWorking(true);
    try { const next = await action(); if (next) { setView(next); wasRunning.current = !!next.running; } if (done) notify(done); }
    catch (error) { notify((error as Error).message, true); } finally { setWorking(false); }
  };
  const addRepo = () => run(async () => { const next = await api<RepoView>('POST', '/knowledge/repos', { url }); setUrl(''); setAdding(false); const added = next.sources[next.sources.length - 1]; if (added) setOpen(added.id); return next; });
  const addFolder = () => run(async () => { const next = await window.flowdesk!.knowledgeRepos!.pickFolder(); if (next) { const added = next.sources.find(s => !view?.sources.some(o => o.id === s.id)); if (added) setOpen(added.id); } return next; });
  const rulesOf = (s: RepoSourceView) => drafts[s.id] ?? s.rules;
  const setRule = (s: RepoSourceView, path: string, value: RepoPurpose | 'skip' | undefined) => setDrafts(cur => { const next = { ...(cur[s.id] ?? s.rules) }; if (value === undefined) delete next[path]; else next[path] = value; return { ...cur, [s.id]: next }; });
  const saveRules = (s: RepoSourceView) => run(async () => { const next = await api<RepoView>('POST', '/knowledge/repos/folders', { id: s.id, rules: rulesOf(s) }); setDrafts(cur => { const n = { ...cur }; delete n[s.id]; return n; }); setOpen(undefined); return next; }, s.confirmed ? '已保存，正在按新的选择更新。' : '开始导入了，可以先去做别的。');
  const running = view?.running;
  const desktop = !!window.flowdesk?.knowledgeRepos;

  return <section className="panel" id="knowledge-repos" style={{ padding: '14px 16px' }}>{confirmDialog}
    <h2 style={{ margin: '0 0 4px', fontSize: 16 }}>自动更新的知识来源</h2>
    <p className="muted" style={{ margin: '0 0 10px' }}>资料放在 GitHub 仓库或电脑上的文件夹里、而且会不定期更新：添加一次，咔哒在你不忙的时候每 {view?.intervalHours ?? REPO_SYNC_LIMITS.intervalHours} 小时检查一次，只整理新增和改过的文件。也可以随时点「立即更新」。</p>
    <div style={row}>
      <Button disabled={working} onClick={() => setAdding(a => !a)}>添加 GitHub 仓库</Button>
      <Button variant="secondary" disabled={working || !desktop} onClick={() => void addFolder()}>添加本地文件夹</Button>
    </div>
    {adding && <div style={{ ...row, marginTop: 8 }}>
      <input aria-label="GitHub 仓库地址" style={{ flex: '1 1 320px', minWidth: 0 }} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://github.com/用户名/仓库名" onKeyDown={e => { if (e.key === 'Enter' && url.trim()) void addRepo(); }} />
      <Button busy={working} disabled={!url.trim()} onClick={() => void addRepo()}>添加</Button>
    </div>}
    <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>私有仓库也行：咔哒用这台电脑已经登录的 GitHub 账号读取，不会问你要密码或令牌。看着像内部资料的文件夹默认不导入；资料里像密钥、密码的内容会自动隐藏。</p>
    {view?.sources.map(s => <SourceCard key={s.id} source={s} running={running?.id === s.id ? running : undefined} busy={working || (!!running && running.id !== s.id)} stopRequested={!!view.stopRequested}
      open={open === s.id || (!s.confirmed && s.status === 'ready' && s.folders.length > 0)} rules={rulesOf(s)} dirty={!!drafts[s.id]}
      onToggle={() => setOpen(cur => cur === s.id ? undefined : s.id)} onRule={(path, value) => setRule(s, path, value)} onSave={() => void saveRules(s)}
      onReset={() => setDrafts(cur => { const n = { ...cur }; delete n[s.id]; return n; })}
      onSync={() => void run(() => api<RepoView>('POST', '/knowledge/repos/sync', { id: s.id }))}
      onStop={() => void run(() => api<RepoView>('POST', '/knowledge/repos/stop', {}))}
      onAuto={on => void run(() => api<RepoView>('POST', '/knowledge/repos/auto', { id: s.id, on }))}
      onRemove={() => void (async () => { if (await ask({ title: `移除「${s.name}」？`, lines: ['已经导入的知识会保留', '以后不再自动更新这个来源'], confirmLabel: '移除' })) await run(() => api<RepoView>('DELETE', '/knowledge/repos', { id: s.id }), '已移除，导入的知识保留。'); })()} />)}
  </section>;
}

function SourceCard({ source: s, running, busy, stopRequested, open, rules, dirty, onToggle, onRule, onSave, onReset, onSync, onStop, onAuto, onRemove }: {
  source: RepoSourceView; running?: RepoView['running']; busy: boolean; stopRequested: boolean; open: boolean; rules: RepoRules; dirty: boolean;
  onToggle: () => void; onRule: (path: string, value: RepoPurpose | 'skip' | undefined) => void; onSave: () => void; onReset: () => void; onSync: () => void; onStop: () => void; onAuto: (on: boolean) => void; onRemove: () => void;
}) {
  const progress = running && running.total ? { done: running.done, total: running.total } : s.progress;
  const chosen = s.folders.reduce((n, f) => n + filesChosen(f, rules), 0);
  return <article style={{ borderTop: '1px solid var(--border, #eceef2)', marginTop: 12, paddingTop: 10 }}>
    <div style={row}>
      <strong style={{ flex: '1 1 200px', overflowWrap: 'anywhere' }}>{s.name}</strong>
      <label className="muted" style={{ display: 'inline-flex', gap: 4, alignItems: 'center', fontSize: 12 }}><input type="checkbox" aria-label={`自动更新 ${s.name}`} checked={s.autoSync} disabled={busy} onChange={e => onAuto(e.target.checked)} />自动更新</label>
    </div>
    <small className="muted" style={{ display: 'block', overflowWrap: 'anywhere' }}>{s.kind === 'github' ? s.location : `本地文件夹 · ${s.location}`}</small>
    {s.confirmed && progress.total > 0 && <div style={{ margin: '6px 0' }}><progress value={progress.done} max={progress.total} style={{ width: '100%' }} aria-label="整理进度" /><small className="muted">已整理 {progress.done} / 共 {progress.total} 份{s.remaining && !running ? ` · 还有 ${s.remaining} 份下次继续` : ''}</small></div>}
    <p role={s.status === 'error' ? 'alert' : 'status'} className={s.status === 'error' ? 'dr-warning' : undefined} style={{ margin: '6px 0', overflowWrap: 'anywhere' }}>{running ? `${running.phase}…` : s.detail}</p>
    <small className="muted" style={{ display: 'block' }}>{s.lastCheckAt ? `上次检查：${formatTime(s.lastCheckAt)}` : '还没检查过'}{s.confirmed && s.autoSync && s.nextCheckAt && !running ? ` · 下次自动检查：${formatTime(s.nextCheckAt)} 以后（咔哒不忙时）` : ''}{s.confirmed && !s.autoSync ? ' · 自动更新已关，只在点「立即更新」时更新' : ''}</small>
    <div style={{ ...row, marginTop: 6 }}>
      {running ? <Button variant="secondary" disabled={stopRequested} onClick={onStop}>{stopRequested ? '正在停下…' : '停下'}</Button>
        : <Button variant="secondary" disabled={busy || s.status === 'preparing'} onClick={onSync}>{s.confirmed ? '立即更新' : '重新读取'}</Button>}
      {s.folders.length > 0 && <Button variant="ghost" disabled={!!running} onClick={onToggle}>{open ? '收起文件夹' : '选文件夹'}</Button>}
      <Button variant="ghost" disabled={!!running} onClick={onRemove}>移除（保留知识）</Button>
    </div>
    {open && s.folders.length > 0 && <div style={{ marginTop: 8, padding: 10, background: 'var(--surface-muted, #f7f8fa)', borderRadius: 8 }}>
      <p className="muted" style={{ margin: '0 0 6px', fontSize: 12 }}>勾选要导入的文件夹，再选用途：「回复客户用」整理成客户问答；「写法参考」只学写法和语气，不当事实告诉客户；「内部参考」存成内部资料，不用来回复客户。看着像内部资料的（架构、技术、复盘、决策、索引、规范…）默认不选。</p>
      <div style={{ maxHeight: 360, overflow: 'auto' }}>{s.folders.map(f => <FolderRow key={f.path} folder={f} rules={rules} onRule={onRule} disabled={!!running} />)}</div>
      <div style={{ ...row, marginTop: 8 }}>
        <Button disabled={!!running || busy || !chosen} onClick={onSave}>{s.confirmed ? '保存并按新选择更新' : '按这个选择开始导入'}</Button>
        {dirty && <Button variant="ghost" onClick={onReset}>撤销修改</Button>}
        <span className="muted" style={{ fontSize: 12 }}>已选 {chosen} 份{chosen > REPO_SYNC_LIMITS.organizeFilesPerSync ? `：要整理的文件每次最多 ${REPO_SYNC_LIMITS.organizeFilesPerSync} 份，剩下的自动接着来` : ''}</span>
      </div>
    </div>}
  </article>;
}

function filesChosen(f: RepoFolder, rules: RepoRules): number {
  const own = rules[f.path];
  if (!f.children?.length) return own && own !== 'skip' ? f.files : 0;
  const childSum = f.children.reduce((n, c) => { const r = rules[c.path] ?? own; return n + (r && r !== 'skip' ? c.files : 0); }, 0);
  const direct = f.files - f.children.reduce((n, c) => n + c.files, 0);
  return childSum + (own && own !== 'skip' ? direct : 0);
}

function FolderRow({ folder: f, rules, onRule, disabled, child, parentRule }: { folder: RepoFolder; rules: RepoRules; onRule: (path: string, value: RepoPurpose | 'skip' | undefined) => void; disabled: boolean; child?: boolean; parentRule?: RepoPurpose | 'skip' }) {
  const own = rules[f.path];
  const effective = own ?? parentRule ?? 'skip';
  const on = effective !== 'skip';
  return <div style={{ paddingLeft: child ? 22 : 0 }}>
    <div style={{ ...row, padding: '3px 0' }}>
      <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flex: '1 1 220px', minWidth: 0 }}>
        <input type="checkbox" aria-label={`导入 ${f.name}`} checked={on} disabled={disabled} onChange={e => onRule(f.path, e.target.checked ? (f.suggested ?? (parentRule && parentRule !== 'skip' ? parentRule : 'reply')) : 'skip')} />
        <span style={{ overflowWrap: 'anywhere' }}>{f.name}</span><small className="muted">{f.files} 份</small>
      </label>
      {on && <select aria-label={`${f.name} 的用途`} value={effective} disabled={disabled} onChange={e => onRule(f.path, e.target.value as RepoPurpose)}>{PURPOSES.map(([key, p]) => <option key={key} value={key} title={p.hint}>{p.label}</option>)}</select>}
      {child && own !== undefined && <button type="button" className="text-link" disabled={disabled} onClick={() => onRule(f.path, undefined)} style={{ fontSize: 12 }}>跟上一级一样</button>}
    </div>
    {!child && f.children?.length ? <details><summary className="muted" style={{ fontSize: 12, paddingLeft: 22 }}>里面的 {f.children.length} 个子文件夹（可以单独选）</summary>{f.children.map(c => <FolderRow key={c.path} folder={c} rules={rules} onRule={onRule} disabled={disabled} child parentRule={effective} />)}</details> : null}
  </div>;
}
