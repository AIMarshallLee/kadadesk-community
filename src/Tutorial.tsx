import { useState } from 'react';
import { ArrowUpRight, BookOpen, MessageCircleQuestion } from 'lucide-react';
import { featureById, type FeatureOpen } from '../shared/feature-index';
import { tutorialById, type TutorialId } from '../shared/tutorials';
import { goToFeature } from './HelpAssistant';

/**
 * Opens 「问咔哒」. App owns the assistant's state; a page reaches it the way goToFeature reaches the topbar:
 * a cancelable `kadadesk:ask` event first (App may handle it and prefill the question), else the floating button.
 */
export function openHelpAssistant(question?: string) {
  const event = new CustomEvent('kadadesk:ask', { detail: { question }, cancelable: true });
  if (!window.dispatchEvent(event)) return;
  const fab = document.querySelector<HTMLElement>('.help-fab');
  if (fab) { fab.click(); return; }
  document.querySelector<HTMLTextAreaElement>('.help-assistant textarea')?.focus();
}
/** Windows without a route: the licence window is the topbar crown, the assistant is the floating button. */
function openWindow(open: FeatureOpen) {
  if (open === 'license') document.querySelector<HTMLElement>('.app-topbar .topbar-license')?.click();
  else if (open === 'assistant') openHelpAssistant();
}

const box: React.CSSProperties = { margin: '10px 0', border: '1px solid hsl(var(--a-h) calc(var(--a-s) * 33%) 88%)', background: 'hsl(var(--a-h) calc(var(--a-s) * 56%) 98.5%)', borderRadius: 10, padding: '8px 12px', fontSize: 12.5, lineHeight: 1.7 };
const chip: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid hsl(var(--a-h) calc(var(--a-s) * 33%) 82%)', background: '#fff', color: 'hsl(var(--a-h) calc(var(--a-s) * 45%) 36%)', borderRadius: 999, padding: '3px 10px', fontSize: 11.5, cursor: 'pointer' };

/**
 * 小教程: a collapsible block of numbered steps from shared/tutorials.ts, with 「去这里」 buttons (feature index) and
 * 「还不行？问咔哒」. `onLeave` runs before navigating away, e.g. to close the dialog the block sits in.
 */
export default function Tutorial({ id, open = false, onLeave }: { id: TutorialId; open?: boolean; onLeave?: () => void }) {
  const t = tutorialById(id);
  const [expanded, setExpanded] = useState(open);
  if (!t) return null;
  const links = (t.links ?? []).map(featureById).filter((f): f is NonNullable<typeof f> => !!f);
  const go = (featureId: string) => { const f = featureById(featureId); if (!f) return; onLeave?.(); void goToFeature(f, openWindow); };
  const ask = () => { onLeave?.(); openHelpAssistant(`「${t.title}」按小教程做了还是不行`); };
  return <details className="tutorial" data-tutorial={t.id} style={box} open={expanded} onToggle={e => setExpanded((e.currentTarget as HTMLDetailsElement).open)}>
    <summary style={{ cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}><BookOpen size={14} aria-hidden />小教程：{t.title}</summary>
    <ol style={{ margin: '8px 0 6px', paddingLeft: 20 }}>{t.steps.map((s, i) => <li key={i} style={{ marginBottom: 3 }}>{s}</li>)}</ol>
    {!!t.faq?.length && <div style={{ margin: '6px 0' }}><strong style={{ fontSize: 12 }}>常见情况</strong><ul style={{ margin: '4px 0', paddingLeft: 18 }}>{t.faq.map(f => <li key={f.q}><strong style={{ fontWeight: 600 }}>{f.q}</strong>：{f.a}</li>)}</ul></div>}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
      {links.map(f => <button type="button" key={f.id} style={chip} onClick={() => go(f.id)}>去这里：{f.label}<ArrowUpRight size={12} aria-hidden /></button>)}
      <button type="button" style={{ ...chip, fontWeight: 600 }} onClick={ask}><MessageCircleQuestion size={13} aria-hidden />还不行？问咔哒</button>
    </div>
  </details>;
}
