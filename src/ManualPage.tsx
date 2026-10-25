import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, ChevronRight, CircleHelp, History, MessageCircleQuestion, Search, X } from 'lucide-react';
import { MANUAL, MANUAL_CHANGELOG, MANUAL_FAQ, MANUAL_VERSION, manualChapter, manualRoute, parseManualRoute, searchManual } from '../shared/manual';
import { navigate } from './api';
import { PageHead } from './components';
import ManualMarkdown from './ManualMarkdown';
import './manual.css';

/** Where a section is on the page (scroll target). */
const sectionDomId = (chapter: string, section: string) => `manual-${chapter}-${section}`;
const followLink = (route: string) => navigate(route);

/**
 * 使用手册: 常见问题 first (also the page that opens by default), then the chapters in beginner order, then 更新记录.
 * Routes: #manual, #manual/<chapter>, #manual/<chapter>/<section> — other pages and 「问咔哒」 link straight to a section.
 */
export default function ManualPage({ route, onAsk }: { route: string; onAsk: (question?: string) => void }) {
  const { chapter: routeChapter, section } = parseManualRoute(route);
  const chapter = manualChapter(routeChapter ?? MANUAL_FAQ)!;
  const [query, setQuery] = useState('');
  const [appVersion, setAppVersion] = useState('');
  useEffect(() => { void window.flowdesk?.version?.().then(v => setAppVersion(String(v))).catch(() => {}); }, []);
  const q = query.trim();
  const hits = useMemo(() => q ? searchManual(q, 12) : [], [q]);
  useEffect(() => {
    const timer = setTimeout(() => {
      const el = section ? document.getElementById(sectionDomId(chapter.id, section)) : undefined;
      if (el) {
        if (el instanceof HTMLDetailsElement) el.open = true;
        el.scrollIntoView({ block: 'start', behavior: 'smooth' });
        el.classList.add('manual-focus'); setTimeout(() => el.classList.remove('manual-focus'), 2200);
      } else window.scrollTo({ top: 0 });
    }, 60);
    return () => clearTimeout(timer);
  }, [chapter.id, section]);
  const learn = MANUAL.filter(c => c.id !== MANUAL_FAQ && c.id !== MANUAL_CHANGELOG);
  const at = MANUAL.indexOf(chapter), prev = MANUAL[at - 1], next = MANUAL[at + 1];
  const open = (chapterId: string, sectionId?: string) => { setQuery(''); navigate(manualRoute(chapterId, sectionId)); };
  const shownVersion = appVersion || MANUAL_VERSION;
  return <div className="manual-page">
    <PageHead title="使用手册" description="第一次用、遇到问题，都先来这里看。看不懂就点「问咔哒」，用一句话问。"
      actions={<><span className="manual-version" title="手册跟着每个版本一起更新">当前版本 v{shownVersion}{appVersion && MANUAL_VERSION && appVersion !== MANUAL_VERSION ? ` · 手册对应 v${MANUAL_VERSION}` : ''}</span><button type="button" className="btn btn-secondary" onClick={() => onAsk()}><MessageCircleQuestion size={16} />问咔哒</button></>} />
    <div className="manual-search"><Search size={18} aria-hidden /><input type="search" aria-label="搜索使用手册" placeholder="搜问题，比如：鼠标自己在动、怎么暂停、试用用完了" maxLength={60} value={query} onChange={e => setQuery(e.target.value)} />{q && <button type="button" className="icon-button" aria-label="清空搜索" onClick={() => setQuery('')}><X size={16} /></button>}</div>
    <div className="manual-layout">
      <nav className="manual-toc" aria-label="使用手册目录">
        <button type="button" className={`manual-toc-faq${chapter.id === MANUAL_FAQ && !q ? ' is-active' : ''}`} onClick={() => open(MANUAL_FAQ)}><CircleHelp size={18} /><span><strong>常见问题</strong><small>先看这里</small></span></button>
        <p className="manual-toc-head">从头学起</p>
        {learn.map((c, i) => <button type="button" key={c.id} className={chapter.id === c.id && !q ? 'is-active' : ''} onClick={() => open(c.id)}><em>{i + 1}</em><span>{c.title}</span></button>)}
        <p className="manual-toc-head">版本</p>
        <button type="button" className={chapter.id === MANUAL_CHANGELOG && !q ? 'is-active' : ''} onClick={() => open(MANUAL_CHANGELOG)}><History size={15} /><span>更新记录</span></button>
      </nav>
      <article className="manual-body" aria-live="polite">
        {q ? <section className="manual-results">
          <h2>搜「{q}」</h2>
          {hits.length ? <ul>{hits.map(h => <li key={`${h.chapterId}/${h.sectionId}`}><button type="button" onClick={() => open(h.chapterId, h.sectionId || undefined)}>
            <span><small>{h.chapterTitle}</small><strong>{h.title}</strong><em>{h.snippet}</em></span><ChevronRight size={16} /></button></li>)}</ul>
            : <div className="manual-empty"><p>手册里没找到「{q}」。换个说法试试，或者直接问咔哒。</p><button type="button" className="btn btn-primary" onClick={() => onAsk(q)}><MessageCircleQuestion size={16} />问咔哒：「{q.slice(0, 20)}」</button></div>}
        </section> : <>
          <header className="manual-chapter-head">{chapter.id === MANUAL_FAQ ? <CircleHelp size={22} /> : chapter.id === MANUAL_CHANGELOG ? <History size={22} /> : <BookOpen size={22} />}<h2>{chapter.title}</h2></header>
          {chapter.sections.filter(s => !s.id).map(s => <div key="intro" className="manual-intro"><ManualMarkdown markdown={s.markdown} onLink={followLink} /></div>)}
          {chapter.id === MANUAL_FAQ
            ? <div className="manual-faq">{chapter.sections.filter(s => s.id).map(s => <details key={s.id} id={sectionDomId(chapter.id, s.id)} open={s.id === section}>
                <summary>{s.title}</summary><div><ManualMarkdown markdown={s.markdown} onLink={followLink} /></div></details>)}</div>
            : chapter.sections.filter(s => s.id).map(s => <section key={s.id} id={sectionDomId(chapter.id, s.id)} className="manual-section">
                <h3>{s.title}</h3><ManualMarkdown markdown={s.markdown} onLink={followLink} /></section>)}
          <footer className="manual-pager">
            {prev ? <button type="button" className="btn btn-ghost" onClick={() => open(prev.id)}><ArrowLeft size={15} />{prev.title}</button> : <span />}
            {next ? <button type="button" className="btn btn-secondary" onClick={() => open(next.id)}>下一章：{next.title}<ArrowRight size={15} /></button> : <span />}
          </footer>
        </>}
      </article>
    </div>
  </div>;
}

/** 「使用手册」 in the top bar, next to 「问咔哒」. */
export function ManualButton({ active, onClick }: { active?: boolean; onClick?: () => void }) {
  return <button type="button" className={`manual-topbar${active ? ' is-open' : ''}`} onClick={() => navigate('manual')} aria-label="打开使用手册" title="像说明书一样，从头教你用咔哒"><BookOpen size={16} /><span>使用手册</span></button>;
}
