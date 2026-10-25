import { Fragment, type ReactNode } from 'react';
import { parseMarkdown, type Block, type Inline } from '../shared/markdown';

/**
 * Renders the 使用手册's Markdown subset (shared/markdown.ts) as React elements: text is always escaped by React and inner
 * HTML is never set. Links are in-app routes only; clicking one calls onLink with the route ('manual/faq').
 */
function inline(nodes: Inline[], onLink: (route: string) => void, key = ''): ReactNode[] {
  return nodes.map((n, i) => {
    const k = `${key}${i}`;
    if (n.type === 'text') return <Fragment key={k}>{n.text}</Fragment>;
    if (n.type === 'code') return <code key={k}>{n.text}</code>;
    if (n.type === 'strong') return <strong key={k}>{inline(n.children, onLink, k + '.')}</strong>;
    return <a key={k} href={n.href} onClick={e => { e.preventDefault(); onLink(n.href.slice(1)); }}>{inline(n.children, onLink, k + '.')}</a>;
  });
}

function block(b: Block, i: number, onLink: (route: string) => void): ReactNode {
  if (b.type === 'heading') {
    const Tag = (`h${Math.min(4, b.level + 1)}`) as 'h2' | 'h3' | 'h4';
    return <Tag key={i} id={b.id ? `manual-${b.id}` : undefined}>{inline(b.children, onLink)}</Tag>;
  }
  if (b.type === 'list') {
    const items = b.items.map((item, j) => <li key={j}>{inline(item, onLink, `${j}.`)}</li>);
    return b.ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>;
  }
  if (b.type === 'quote') return <aside key={i} className="manual-tip">{inline(b.children, onLink)}</aside>;
  return <p key={i}>{inline(b.children, onLink)}</p>;
}

export default function ManualMarkdown({ markdown, onLink }: { markdown: string; onLink: (route: string) => void }) {
  return <>{parseMarkdown(markdown).map((b, i) => block(b, i, onLink))}</>;
}
