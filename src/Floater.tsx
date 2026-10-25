import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, ExternalLink, LoaderCircle, Minus, Pause, Play } from 'lucide-react';
import { plainTalk } from '../shared/plain-talk';
import type { FloaterDock, FloaterView } from '../shared/types';
import './floater.css';
import { useMascotSrc } from './mascot';

type Summary = FloaterView;

function Mark() {
  const kadaMascot = useMascotSrc();
  return <img className="fl-mascot" src={kadaMascot} alt="" draggable={false} />;
}

const timeOf = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

type Form = 'icon' | 'capsule' | 'panel';

/** 小浮窗: shown while the main window is closed. A round icon with a status dot, a capsule with status and pause/continue,
 * or the capsule with today's details. Shortcuts are written on it, so the emergency stop is findable while kadadesk types. */
export default function Floater() {
  const bridge = window.flowdesk?.floater;
  const [s, setS] = useState<Summary>();
  const [form, setFormState] = useState<Form>();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const seenHandoffs = useRef(0);
  const [pulse, setPulse] = useState(false);
  const drag = useRef<{ x: number; y: number; moved: boolean } | undefined>(undefined);
  const [dock, setDock] = useState<FloaterDock>({ tucked: false });
  // 审核：正在修改的那条回复（id、文字、是否存进知识库）和处理完的一句话结果。
  const [editing, setEditing] = useState<{ id: string; text: string; save: boolean }>();
  const [notice, setNotice] = useState('');
  useEffect(() => bridge?.onDock(setDock), [bridge]);
  const refresh = useCallback(async () => { try { const next = await bridge?.summary(); if (next) { setS(next); setFormState(f => f ?? (next.form === 'icon' ? 'icon' : 'capsule')); } } catch { /* next tick */ } }, [bridge]);
  useEffect(() => {
    document.documentElement.classList.add('floater-view');
    void refresh(); const t = setInterval(() => void refresh(), 2000); return () => clearInterval(t);
  }, [refresh]);
  useEffect(() => {
    const n = (s?.handoffs.length ?? 0) + (s?.reviews?.length ?? 0);
    if (n > seenHandoffs.current) { setPulse(true); const t = setTimeout(() => setPulse(false), 6000); seenHandoffs.current = n; return () => clearTimeout(t); }
    seenHandoffs.current = n;
  }, [s?.handoffs.length, s?.reviews?.length]);
  const act = async (key: string, run: () => Promise<Summary | undefined | void>) => {
    setBusy(key); setError('');
    try { const next = await run(); if (next) setS(next); }
    catch (e) { setError(plainTalk(String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))); }
    finally { setBusy(''); }
  };
  // Resize the window first, then render the new form, so nothing is drawn clipped.
  const go = (next: Form) => { void bridge?.setForm(next).then(() => setFormState(next)).catch(() => setFormState(next)); };
  if (!bridge || !form) return null;
  const status = s?.status ?? 'stopped';
  const running = status === 'running', resuming = status === 'resuming';
  const handoffs = s?.handoffs ?? [];
  const reviews = s?.reviews ?? [];
  const waiting = handoffs.length + reviews.length;
  const startEdit = (id: string, text: string) => { setNotice(''); setEditing({ id, text, save: true }); void bridge.editing(true).catch(() => {}); };
  const stopEdit = () => { setEditing(undefined); void bridge.editing(false).catch(() => {}); };
  const review = (id: string, action: 'send' | 'skip', edited?: string, save?: boolean) => void act('r:' + id, async () => {
    const next = await bridge.review(id, action, edited, save);
    setEditing(undefined); void bridge.editing(false).catch(() => {});
    // While reception is off nothing goes out yet: the approval is kept and sent once reception starts.
    const sent = next.status === 'running' ? '已确认，咔哒马上发出去' : '已批准，开始接待后发出';
    setNotice(action === 'skip' ? '已跳过，这位客户留给你自己回。'
      : next.saved === 'approved' ? `${sent}；改过的回答也存进知识库了，下次同样的问题咔哒就这样回。`
      : next.saved === 'pending' ? `${sent}。这条回答和知识库里已有的说法不一样，请到「知识」页确认用哪条。`
      : next.saved === 'failed' ? `${sent}。存进知识库没成功，可以在「知识」页手动添加。`
      : `${sent}。`);
    return next;
  });
  const keys = s?.shortcuts ?? { pause: '', stop: '' };
  const second = s?.acting && keys.stop ? `咔哒正在操作 · 按 ${keys.stop} 急停`
    : running && s?.label === '等你停手' ? s.detail
    : running ? (keys.pause ? `今日 ${s?.repliedToday ?? 0} 条 · ${keys.pause} 暂停` : `${s?.detail} · 今日 ${s?.repliedToday ?? 0} 条`)
    : (status === 'paused' || status === 'stopped') && keys.pause ? `点 ▶ 或按 ${keys.pause} 继续`
    : s?.detail ?? '正在连接…';
  const hint = [keys.pause && `${keys.pause} 暂停/继续`, keys.stop && `${keys.stop} 急停`].filter(Boolean).join(' · ');
  const dot = <i className="fl-dot" />;
  // 贴边隐藏: only a thin tab with the status colour stays on screen; the pointer reaching it slides the capsule out.
  if (dock.tucked && dock.edge) return <div className={`fl-tab fl-tab-${dock.edge} fl-${status}`} title={`咔哒 · ${s?.label ?? ''}`}><i />{handoffs.length > 0 && <b />}</div>;

  if (form === 'icon') {
    // The page drags the icon itself: a window drag region would swallow the click that opens it.
    const down = (e: React.PointerEvent<HTMLButtonElement>) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.screenX, y: e.screenY, moved: false }; };
    const move = (e: React.PointerEvent<HTMLButtonElement>) => {
      const d = drag.current; if (!d) return;
      const dx = e.screenX - d.x, dy = e.screenY - d.y;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      d.moved = true; d.x = e.screenX; d.y = e.screenY; void bridge.moveBy(dx, dy);
    };
    const up = () => { const d = drag.current; drag.current = undefined; if (!d) return; if (d.moved) void bridge.endDrag(); else go('capsule'); };
    return <div className="fl fl-iconwrap">
      <button className={`fl-icon fl-${status} ${pulse ? 'fl-pulse' : ''}`} title={`咔哒 · ${s?.label ?? ''}${hint ? ' · ' + hint : ''}（点一下展开，可拖动）`}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        // Keyboard and accessibility presses carry no pointer events (detail 0); a mouse click is handled on pointer up.
        onClick={e => { if (e.detail === 0) go('capsule'); }}>
        <Mark />{dot}{waiting > 0 && <span className="fl-ibadge">{waiting}</span>}
      </button>
    </div>;
  }
  return <div className={`fl ${form === 'panel' ? 'fl-open' : ''}`}>
    <div className={`fl-capsule fl-${status} ${pulse ? 'fl-pulse' : ''}`}>
      <button className="fl-mark" title="打开咔哒" onClick={() => void bridge.openMain()}><Mark />{dot}</button>
      <div className="fl-text"><b title={`咔哒 · ${s?.label ?? '…'}`}>咔哒 · {s?.label ?? '…'}</b><small className={s?.acting ? 'fl-urgent' : ''} title={hint && !second.includes(hint) ? `${second}\n${hint}` : second}>{second}</small></div>
      {waiting > 0 && <button className="fl-badge" title={reviews.length ? '有回复等你确认' : '有客户需要你看一眼'} onClick={() => go('panel')}>{waiting}</button>}
      <button className="fl-round" title={(running ? '暂停接待（正在发的这条发完再停）' : resuming ? '取消恢复' : status === 'paused' || status === 'stopped' || (status as any) === 'needs_attention' ? '继续接待' : '开始接待') + (keys.pause ? `　${keys.pause}` : '')} disabled={!!busy || !s} onClick={() => void act('toggle', () => bridge.toggle())}>
        {busy === 'toggle' ? <LoaderCircle size={16} className="fl-spin" /> : running || resuming ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <div className="fl-tools">
      <button className="fl-round fl-ghost" title="打开咔哒" aria-label="打开咔哒" onClick={() => void bridge.openMain()}><ExternalLink size={14} /></button>
      <button className="fl-round fl-ghost" title="缩成图标" aria-label="缩成图标" onClick={() => go('icon')}><Minus size={15} /></button>
      <button className="fl-round fl-ghost" title={form === 'panel' ? '收起详情' : '展开详情'} aria-label={form === 'panel' ? '收起详情' : '展开详情'} onClick={() => go(form === 'panel' ? 'capsule' : 'panel')}>{form === 'panel' ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
      </div>
    </div>
    {form === 'panel' && <div className="fl-panel">
      <div className="fl-stat"><span>今日已回复</span><strong>{s?.repliedToday ?? 0}</strong><span>条</span></div>
      {s?.alert && <p className="fl-alert">{s.alert}</p>}
      {error && <p className="fl-alert">{error}</p>}
      {notice && <p className="fl-note">{notice}</p>}
      {reviews.length > 0 && <><h4>等你确认的回复 <small className="fl-hot">{reviews.length} 条</small></h4>
        {reviews.map(r => <div className="fl-review" key={r.id}>
          <b><span title={r.name}>{r.name}</span>{r.reason === 'risky' && <em>退款/投诉/议价</em>}{r.reason === 'new' && <em>新客户</em>}</b>
          <p className="fl-q">{r.question}</p>
          {editing?.id === r.id ? <>
            <textarea aria-label="修改回复" value={editing.text} maxLength={4096} autoFocus onChange={e => setEditing({ ...editing, text: e.target.value })} />
            <label className="fl-save"><input type="checkbox" checked={editing.save} onChange={e => setEditing({ ...editing, save: e.target.checked })} />存进知识库，以后同样的问题就这样回</label>
            <div className="fl-actions"><button className="fl-primary" disabled={!!busy || !editing.text.trim()} onClick={() => review(r.id, 'send', editing.text, editing.save)}>{busy === 'r:' + r.id ? '…' : '发送修改后的'}</button><button disabled={!!busy} onClick={stopEdit}>取消</button></div>
          </> : <>
            <p className="fl-a">{r.reply}</p>
            <div className="fl-actions"><button className="fl-primary" disabled={!!busy} onClick={() => review(r.id, 'send')}>{busy === 'r:' + r.id ? '…' : '发送'}</button><button disabled={!!busy} onClick={() => startEdit(r.id, r.reply)}>改一下</button><button disabled={!!busy} onClick={() => review(r.id, 'skip')}>跳过</button></div>
          </>}
        </div>)}</>}
      <h4>需要你看一眼 <small className={handoffs.length ? 'fl-hot' : ''}>{handoffs.length} 位</small></h4>
      {handoffs.length ? handoffs.slice(0, 4).map(h => <div className="fl-row" key={h.name}>
        <div><b><span title={h.name}>{h.name}</span></b><small title={h.question || undefined}>{h.question || '客户发了图片或问到需要你拍板的事'}</small></div>
        <button disabled={!!busy} onClick={() => void act('h:' + h.name, () => bridge.markHandled(h.name))}>{busy === 'h:' + h.name ? '…' : '处理好了'}</button>
      </div>) : <p className="fl-empty">暂时没有，咔哒都接住了。</p>}
      {s?.recent.length ? <><h4>最近回复</h4>{s.recent.map(r => <div className="fl-row fl-recent" key={r.at + r.name}><div><b><span title={r.name}>{r.name}</span><em>{timeOf(r.at)}</em></b><small title={r.reply}>{r.reply}</small></div></div>)}</> : null}
      {hint && <p className="fl-keys">快捷键：{hint}（可在设置里修改）</p>}
    </div>}
  </div>;
}
