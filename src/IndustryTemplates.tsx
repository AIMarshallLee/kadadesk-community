import { useEffect, useState } from 'react';
import { LayoutTemplate, TriangleAlert } from 'lucide-react';
import type { KnowledgeImportPreview } from '../shared/knowledge';
import { industryTemplates, industryToneLabels, placeholderCount, type IndustryTemplate, type IndustryTone } from '../shared/industry-templates';
import type { ReplyPersona } from '../shared/desktop-replies';
import { categorize, withCategoryTag } from '../shared/knowledge-categories';
import type { PageProps } from './App';
import { api, navigate } from './api';
import { Button } from './components';

/** The server checks the declared size against the decoded bytes, so size is the UTF-8 byte length, not text.length. */
const asFile = (name: string, text: string) => { const bytes = new TextEncoder().encode(text); let bin = ''; for (const b of bytes) bin += String.fromCharCode(b); return { name, size: bytes.length, base64: btoa(bin) }; };
type Pair = { q: string; a: string; use: boolean };
const pairsOf = (t: IndustryTemplate): Pair[] => t.pairs.map(p => ({ ...p, use: true }));
/** Same hash does not fire hashchange, so scroll to the spot instead. */
/** Only for an owner who never picked a voice, and never while reception is running: returns whether the tone was set. */
const personaTone: Record<IndustryTone, ReplyPersona['tone']> = { friendly: 'friendly', professional: 'professional', concise: 'brief' };
const applyTone = async (tone: IndustryTone) => { try { const bridge = window.flowdesk?.desktopReplies as any; if (!bridge) return false; const current = await bridge.state(); if (current.status === 'running' || current.config?.persona) return false; await bridge.saveConfig?.({ ...current.config, persona: { tone: personaTone[tone] } }); return true; } catch { return false; } };
const go = (route: string, selector: string) => { if (window.location.hash === `#${route}`) document.querySelector(selector)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); else navigate(route); };

/**
 * 新手样板：选行业 → 看一眼问答（可以当场改【】） → 「用这个样板开始」。
 * Goes through the same preview → commit import the file import uses, so every entry lands PENDING (停用、待审核) until the owner reviews it.
 */
export default function IndustryTemplates({ perform, notify, collapsed = false }: Pick<PageProps, 'perform' | 'notify'> & { collapsed?: boolean }) {
  const [open, setOpen] = useState(!collapsed || window.location.hash === '#knowledge/templates');
  useEffect(() => { const fn = () => { if (window.location.hash === '#knowledge/templates') setOpen(true); }; window.addEventListener('hashchange', fn); return () => window.removeEventListener('hashchange', fn); }, []);
  const [picked, setPicked] = useState<IndustryTemplate>(), [pairs, setPairs] = useState<Pair[]>([]);
  const [busy, setBusy] = useState(false), [done, setDone] = useState<{ created: number; skipped: number; blanks: number; tone?: boolean }>();
  const choose = (t: IndustryTemplate) => { if (picked && picked.id !== t.id && pairs.some((p, i) => p.a !== picked.pairs[i]?.a) && !window.confirm('换行业会丢掉你刚才改过的内容，继续吗？')) return; setPicked(t); setPairs(pairsOf(t)); setDone(undefined); };
  const chosen = pairs.filter(p => p.use && p.q.trim() && p.a.trim()), blanks = chosen.reduce((n, p) => n + placeholderCount(p.a), 0);
  const start = async () => {
    if (!picked || !chosen.length) return notify('至少保留一条问答。', true);
    setBusy(true);
    try {
      const json = JSON.stringify(chosen.map(p => ({ 问题: p.q.trim(), 标题: p.q.trim(), 答案: p.a.trim() })));
      const preview = await api<KnowledgeImportPreview>('POST', '/knowledge/import/preview', { files: [asFile(`行业样板-${picked.label.replace(/[\\/]/g, '、')}.json`, json)] });
      const rows = preview.rows.filter(r => !r.errors.length && !r.duplicateOf);
      if (!rows.length) { setDone({ created: 0, skipped: preview.rows.length, blanks: 0 }); return; }
      const committed = await api<{ created: unknown[]; skipped: number }>('POST', '/knowledge/import/commit', { previewId: preview.previewId, confirm: true, rows: rows.map(r => ({ rowId: r.rowId, title: r.title, content: r.content, question: r.question ?? '', aliases: r.aliases ?? [], tags: withCategoryTag(['行业样板'], categorize(`${r.question ?? ''} ${r.content}`)), scenario: r.scenario ?? 'all' })) });
      const tone = committed.created.length > 0 && await applyTone(picked.tone);
      setDone({ created: committed.created.length, skipped: committed.skipped + preview.rows.length - rows.length, blanks, tone });
      await perform('GET', '/state');
    } catch (error) { notify((error as Error).message, true); } finally { setBusy(false); }
  };
  if (!open) return <div className="industry-templates-closed" id="industry-templates" style={{ textAlign: 'center', margin: '4px 0 10px' }}><Button variant="secondary" onClick={() => setOpen(true)}><LayoutTemplate size={15} />没有现成资料？用行业样板开始</Button></div>;
  return <section className="industry-templates" id="industry-templates" aria-label="新手样板" style={{ margin: '4px 0 14px', padding: 14, border: '1px solid hsl(var(--a-h) calc(var(--a-s) * 22%) 86.5%)', borderRadius: 12, background: 'hsl(var(--a-h) calc(var(--a-s) * 44%) 97.5%)' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}><strong style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}><LayoutTemplate size={16} />新手样板：没有资料就先选个行业</strong>{collapsed && <Button variant="ghost" onClick={() => setOpen(false)}>收起</Button>}</div>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '10px 0' }} role="group" aria-label="选择行业">{industryTemplates.map(t => <button key={t.id} type="button" disabled={busy} aria-pressed={picked?.id === t.id} className={`btn ${picked?.id === t.id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => choose(t)}>{t.label}</button>)}</div>
    {!picked && <p className="muted" style={{ margin: 0 }}>选一个最接近你生意的行业，先看看里面有哪些问答。不确定就选「通用小店」。</p>}
    {picked && !done && <>
      <p style={{ margin: '0 0 6px' }}>{picked.description} 共 {picked.pairs.length} 条，建议回复语气：{industryToneLabels[picked.tone]}（还没设过语气的话，会自动用这个）。</p>
      <div className="notice"><TriangleAlert size={16} />这是样板，里面【】的地方要换成你自己的信息，确认后咔哒才会用。可以现在就在下面改，也可以导入后再改；用不上的取消勾选。</div>
      <div style={{ maxHeight: 380, overflowY: 'auto', margin: '8px 0', borderTop: '1px solid hsl(var(--a-h) calc(var(--a-s) * 22%) 90%)' }}>{pairs.map((p, i) => <label key={i} style={{ display: 'grid', gridTemplateColumns: '22px 1fr', gap: 8, padding: '8px 0', borderBottom: '1px solid hsl(var(--a-h) calc(var(--a-s) * 22%) 90%)', opacity: p.use ? 1 : .55 }}>
        <input type="checkbox" checked={p.use} disabled={busy} aria-label={`使用：${p.q}`} onChange={e => setPairs(cur => cur.map((x, j) => j === i ? { ...x, use: e.target.checked } : x))} />
        <span style={{ minWidth: 0 }}><strong style={{ fontSize: 13 }}>{p.q}</strong>
          <textarea rows={2} value={p.a} disabled={busy || !p.use} aria-label={`回答：${p.q}`} maxLength={2000} onChange={e => setPairs(cur => cur.map((x, j) => j === i ? { ...x, a: e.target.value } : x))} style={{ display: 'block', width: '100%', marginTop: 4, boxSizing: 'border-box', fontSize: 13 }} />
          {p.use && placeholderCount(p.a) > 0 && <small className="muted">还有 {placeholderCount(p.a)} 处【】要换成你的信息</small>}</span>
      </label>)}</div>
      <div className="qi-actions"><Button busy={busy} disabled={!chosen.length} onClick={() => void start()}>用这个样板开始（{chosen.length} 条）</Button><span className="muted">{blanks ? `还有 ${blanks} 处【】没填，导入后也能改。` : '都填好了。'}导入后先放在「待审核」，不会直接回复客户。</span></div>
    </>}
    {picked && done && <div>
      <p style={{ margin: '0 0 6px' }}><strong>{done.created ? `已放进待审核：${done.created} 条` : '这些样板之前已经导入过了'}</strong>{done.created > 0 && done.skipped > 0 ? `（${done.skipped} 条之前已导入，已跳过）` : ''}。现在咔哒还不会用它们回复客户。</p>
      {done.tone && <p className="muted" style={{ margin: '0 0 6px' }}>回复语气已按这个行业设成「{industryToneLabels[picked.tone]}」，可以在「接待 → 人设与语气」改。</p>}
      <ol style={{ margin: '6px 0 10px', paddingLeft: 20, lineHeight: 1.8 }}>
        <li>{done.blanks ? `还有 ${done.blanks} 处【】没填：` : ''}到「管理资料」把【】换成你自己的信息，再点「批量审核」启用。</li>
        <li>审核启用后去「试答」，问一句客户常问的话，看咔哒答得对不对。试答不会发给客户。</li>
      </ol>
      <div className="qi-actions"><Button onClick={() => go('knowledge/import', '.review-strip, .knowledge-library')}>去修改并审核</Button><Button variant="secondary" onClick={() => go('knowledge/practice', '#coach-practice')}>去试答</Button><Button variant="ghost" onClick={() => { setPicked(undefined); setDone(undefined); }}>换个行业</Button></div>
    </div>}
  </section>;
}
