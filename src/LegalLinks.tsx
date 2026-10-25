import { useState, type CSSProperties, type MouseEvent } from 'react';
import { copyText } from './api';

/** The official copies of the legal pages (site/kadadesk/terms.html, privacy.html, published by scripts/publish-site.sh). */
export const LEGAL_LINKS = [
  { label: '《用户协议》', href: 'https://example.com/kadadesk/terms.html' },
  { label: '《隐私政策》', href: 'https://example.com/kadadesk/privacy.html' },
] as const;

/**
 * Links to the user agreement and privacy policy on the official site.
 * The browser build opens them in a new tab. The desktop window refuses every new window (desktop/main.ts
 * setWindowOpenHandler) and has no general "open in browser" bridge, so there a click copies the address instead.
 */
export default function LegalLinks({ prefix, style }: { prefix?: string; style?: CSSProperties }) {
  const [copied, setCopied] = useState(false);
  const click = async (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (!window.flowdesk) return;
    event.preventDefault();
    const open = (window.flowdesk as unknown as { openOfficial?: (url: string) => Promise<void> }).openOfficial;
    if (open) { try { await open(href); return; } catch { /* fall back to copying */ } }
    try { await copyText(href); setCopied(true); setTimeout(() => setCopied(false), 4000); } catch { /* the address is still shown on hover */ }
  };
  return <p className="settings-note" style={{ margin: '8px 0 0', ...style }}>
    {prefix}
    {LEGAL_LINKS.map(link => <a key={link.href} href={link.href} title={link.href} target="_blank" rel="noopener noreferrer" onClick={event => void click(event, link.href)}>{link.label}</a>)}
    {copied && <span role="status">（链接已复制，粘贴到浏览器打开即可）</span>}
  </p>;
}
