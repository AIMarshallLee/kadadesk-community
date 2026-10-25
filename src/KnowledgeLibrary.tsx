import { useCallback, useEffect, useState } from 'react';
import { FolderOpen, FolderPlus, HardDriveDownload, RefreshCw } from 'lucide-react';
import type { LibraryStatus } from '../desktop/knowledge-library-ipc';
import { Button } from './components';

const size = (b?: number) => b === undefined ? '未知' : b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : b >= 1024 ** 2 ? `${Math.max(1, Math.round(b / 1024 ** 2))} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
const clean = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const FOLDERS: Array<{ key: 'source' | 'pending' | 'live' | 'old'; name: string; what: string }> = [
  { key: 'source', name: '01 原始资料', what: '你放文件的地方，咔哒只读不改' },
  { key: 'pending', name: '02 新整理', what: '咔哒拆好的问答，等你确认' },
  { key: 'live', name: '03 在用的知识库', what: '正在用来回复客户，按类别分好' },
  { key: 'old', name: '04 旧版本', what: '被替换或停用的旧说法，随时可查' },
];

/** 本地资料库: the first step of 知识 — make the folder, drop files in 01, 咔哒 sorts the rest. */
export function KnowledgeLibrary({ notify, onReview }: { notify: (message: string, error?: boolean) => void; onReview?: () => void }) {
  const bridge = window.flowdesk?.knowledgeLibrary;
  const [s, setS] = useState<LibraryStatus>(); const [busy, setBusy] = useState('');
  const load = useCallback(async () => { try { setS(await bridge?.status()); } catch { /* next poll */ } }, [bridge]);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 15000); return () => clearInterval(t); }, [load]);
  if (!bridge || !s) return null;
  const act = async (key: string, run: () => Promise<unknown>, done?: string) => { setBusy(key); try { const r = await run(); if (r && typeof r === 'object' && 'configured' in (r as object)) setS(r as LibraryStatus); else await load(); if (done) notify(done); } catch (e) { notify(clean(e), true); } finally { setBusy(''); } };
  const lowSpace = s.freeBytes !== undefined && s.freeBytes < 1024 ** 3;
  if (!s.configured) return <section className="panel" aria-label="本地资料库" style={{ marginBottom: 16 }}>
    <h3 style={{ margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 8 }}><FolderPlus size={18} />第一步：在电脑上建一个「咔哒资料库」文件夹</h3>
    <p className="muted" style={{ margin: '0 0 10px', fontSize: 13 }}>以后你的产品介绍、价目表、常见问题都放这个文件夹里。咔哒会自动读取、整理，并分成「原始资料 / 新整理 / 在用的知识库 / 旧版本 / 朋友圈图片」五个子文件夹，你随时能翻看。</p>
    <div style={{ display: 'grid', gap: 4, fontSize: 13, marginBottom: 12 }}>
      <div>建在：<code style={{ overflowWrap: 'anywhere' }}>{s.suggested}</code></div>
      <div>占用空间：一般几十 MB，资料多的也很少超过 1 GB（咔哒只读文字资料，不读视频）。这块磁盘还剩 <b>{size(s.freeBytes)}</b>。{lowSpace && <span style={{ color: '#b42318' }}> 空间有点紧，建议换到空间大的磁盘。</span>}</div>
    </div>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Button busy={busy === 'create'} disabled={!!busy} onClick={() => void act('create', () => bridge.create(), '资料库建好了：把文件放进「01 原始资料」，咔哒 2 分钟内自动整理。')}><FolderPlus size={15} />就建在这里</Button>
      <Button variant="secondary" busy={busy === 'choose'} disabled={!!busy} onClick={() => void act('choose', () => bridge.choose(), undefined)}>换个位置</Button>
    </div>
  </section>;
  return <section className="panel" aria-label="本地资料库" style={{ marginBottom: 16 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <h3 style={{ margin: 0, marginRight: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}><FolderOpen size={18} />咔哒资料库</h3>
      <Button variant="secondary" busy={busy === 'sync'} disabled={!!busy || s.syncing} onClick={() => void act('sync', () => bridge.sync(), '已重新读取「01 原始资料」。')}><RefreshCw size={14} />{s.syncing ? '正在整理…' : '现在整理'}</Button>
      <Button busy={busy === 'open'} disabled={!!busy} onClick={() => void act('open', () => bridge.open('source'))}>打开「01 原始资料」放文件</Button>
    </div>
    <p className="muted" style={{ margin: '6px 0 10px', fontSize: 12, overflowWrap: 'anywhere' }}>{s.root} · 原始资料 {s.sourceFiles} 个文件、{size(s.sourceBytes)} · 磁盘剩余 {size(s.freeBytes)}。把文件放进「01 原始资料」，咔哒每 2 分钟自动整理；价格变了直接用新文件替换旧文件。</p>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
      {FOLDERS.map(f => { const n = f.key === 'source' ? `${s.sourceFiles} 个文件` : `${s.counts[f.key]} 条`; return <button key={f.key} type="button" onClick={() => void act('open', () => bridge.open(f.key))} disabled={!!busy}
        style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 10, border: '1px solid #ece8f0', background: '#fbfaff', cursor: 'pointer' }}>
        <b style={{ fontSize: 13 }}>{f.name}</b> <span style={{ fontSize: 12, color: '#6b4fd8' }}>{n}</span><div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{f.what}</div></button>; })}
    </div>
    {s.lastResult && <p style={{ margin: '10px 0 0', fontSize: 12, color: s.error ? '#b42318' : '#536170' }}>{s.lastSyncAt ? `上次整理 ${new Date(s.lastSyncAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}：` : ''}{s.lastResult}</p>}
    {s.counts.pending > 0 && onReview && <div style={{ marginTop: 8 }}><Button variant="secondary" onClick={onReview}>有 {s.counts.pending} 条新整理等你确认，去确认</Button></div>}
    <p className="muted" style={{ margin: '10px 0 0', fontSize: 12 }}>常用图片（产品图、活动照片）放进「05 朋友圈图片」，以后起草朋友圈和群消息时只从这里挑图。<button type="button" className="btn btn-ghost" style={{ padding: '2px 6px', fontSize: 12 }} disabled={!!busy} onClick={() => void act('open', () => bridge.open('images'))}>打开</button></p>
    <BackupRow s={s} busy={busy} act={act} />
  </section>;
}

const when = (iso?: string) => iso ? new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
/** 备份: one daily copy to a cloud-drive sync folder or a USB stick, and a reminder after a week without one. */
function BackupRow({ s, busy, act }: { s: LibraryStatus; busy: string; act: (key: string, run: () => Promise<unknown>, done?: string) => Promise<void> }) {
  const bridge = window.flowdesk?.knowledgeLibrary; const b = s.backup;
  if (!bridge?.backupNow || !b) return null;
  const warn = b.due || b.error;
  return <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, border: `1px solid ${warn ? '#fde68a' : '#ece8f0'}`, background: warn ? '#fffbeb' : '#fbfaff' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <b style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, marginRight: 'auto' }}><HardDriveDownload size={16} />备份</b>
      {b.dir && <Button variant="secondary" busy={busy === 'backup' || b.running} disabled={!!busy} onClick={() => void act('backup', () => bridge.backupNow())}>现在备份</Button>}
      {b.dir && <Button variant="ghost" disabled={!!busy} onClick={() => void act('backup-choose', () => bridge.backupChoose())}>换位置</Button>}
    </div>
    {!b.dir ? <>
      <p style={{ margin: '6px 0 8px', fontSize: 12, color: warn ? '#92400e' : '#536170' }}>{warn ? '你的知识还没有备份过。' : ''}电脑坏了或误删时，知识库会跟着丢。选一个网盘的同步文件夹（百度网盘同步空间、坚果云、iCloud、OneDrive）或 U 盘，咔哒每天自动备份一次，保留最近 14 天。</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {b.suggestions.map(x => <Button key={x.path} disabled={!!busy} onClick={() => void act('backup-use', () => bridge.backupUse(x.path), `以后每天备份到「${x.label}」。`)}>备份到 {x.label}</Button>)}
        <Button variant="secondary" disabled={!!busy} onClick={() => void act('backup-choose', () => bridge.backupChoose())}>{b.suggestions.length ? '选择其他位置' : '选择备份位置'}</Button>
      </div>
    </> : <p style={{ margin: '6px 0 0', fontSize: 12, color: b.error ? '#b42318' : warn ? '#92400e' : '#536170', overflowWrap: 'anywhere' }}>
      备份到 {b.dir}。{b.lastAt ? `上次 ${when(b.lastAt)}。` : ''}{b.result ?? ''}{b.due && !b.error ? ' 已经一周多没备份了：用 U 盘的话记得插上。' : ''}</p>}
  </div>;
}
