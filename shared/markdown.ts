/**
 * A small, safe Markdown subset for the 使用手册: headings (#–####), paragraphs, - / 1. lists, > tips, **bold**,
 * `code` and [links](#manual/…). It produces plain data; the renderer (src/ManualMarkdown.tsx) turns it into React
 * elements, so raw HTML in the text is only ever shown as text. Links keep only in-app routes (`#…`): the desktop
 * window refuses other navigation, so anything else (javascript:, http:, mailto:, data: …) becomes plain text.
 */
export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: Inline[] };
export type Block =
  | { type: 'heading'; level: 1 | 2 | 3 | 4; id?: string; children: Inline[]; text: string }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'quote'; children: Inline[] };

/** `## 标题 {#id}` → { text: '标题', id: 'id' }. */
export function splitHeadingId(raw: string): { text: string; id?: string } {
  const m = /^(.*?)\s*\{#([a-z0-9][a-z0-9-]*)\}\s*$/.exec(raw);
  return m ? { text: m[1].trim(), id: m[2] } : { text: raw.trim() };
}

/** In-app hash routes only (#manual/faq, #settings). */
export function safeHref(href: string): string | undefined {
  const h = href.trim();
  return /^#[a-z][a-z0-9/_-]*$/i.test(h) ? h : undefined;
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const push = (node: Inline) => { const last = out[out.length - 1]; if (node.type === 'text' && last?.type === 'text') last.text += node.text; else if (node.type !== 'text' || node.text) out.push(node); };
  let i = 0, plain = '';
  const flush = () => { if (plain) { push({ type: 'text', text: plain }); plain = ''; } };
  while (i < text.length) {
    const rest = text.slice(i);
    if (rest.startsWith('**')) {
      const end = text.indexOf('**', i + 2);
      if (end > i + 2) { flush(); push({ type: 'strong', children: parseInline(text.slice(i + 2, end)) }); i = end + 2; continue; }
    }
    if (rest.startsWith('`')) {
      const end = text.indexOf('`', i + 1);
      if (end > i + 1) { flush(); push({ type: 'code', text: text.slice(i + 1, end) }); i = end + 1; continue; }
    }
    if (rest.startsWith('[')) {
      const m = /^\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/.exec(rest);
      if (m) {
        flush();
        const href = safeHref(m[2]);
        if (href) push({ type: 'link', href, children: parseInline(m[1]) });
        else for (const node of parseInline(m[1])) push(node);
        i += m[0].length; continue;
      }
    }
    plain += text[i]; i++;
  }
  flush();
  return out;
}

const HEADING = /^(#{1,4})\s+(.+)$/, BULLET = /^\s*[-*]\s+(.*)$/, NUMBERED = /^\s*\d+[.、]\s+(.*)$/, QUOTE = /^>\s?(.*)$/;

export function parseMarkdown(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  let para: string[] = [];
  const join = (parts: string[]) => parts.reduce((all, part) => !all ? part : /[　-鿿＀-￯]$/.test(all) || /^[　-鿿＀-￯]/.test(part) ? all + part : `${all} ${part}`, '');
  const flushPara = () => { if (para.length) { blocks.push({ type: 'paragraph', children: parseInline(join(para)) }); para = []; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { flushPara(); continue; }
    const h = HEADING.exec(line);
    if (h) { flushPara(); const { text, id } = splitHeadingId(h[2]); blocks.push({ type: 'heading', level: h[1].length as 1 | 2 | 3 | 4, ...(id ? { id } : {}), children: parseInline(text), text }); continue; }
    const listMatch = BULLET.exec(line) ?? NUMBERED.exec(line);
    if (listMatch) {
      flushPara();
      const ordered = !BULLET.test(line), items: Inline[][] = [];
      for (; i < lines.length; i++) {
        const m = ordered ? NUMBERED.exec(lines[i]) : BULLET.exec(lines[i]);
        if (!m) { i--; break; }
        items.push(parseInline(m[1]));
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }
    const q = QUOTE.exec(line);
    if (q) {
      flushPara();
      const parts = [q[1]];
      while (i + 1 < lines.length && QUOTE.test(lines[i + 1])) parts.push(QUOTE.exec(lines[++i])![1]);
      blocks.push({ type: 'quote', children: parseInline(join(parts)) });
      continue;
    }
    para.push(line.trim());
  }
  flushPara();
  return blocks;
}

/** Visible text of inline nodes (for search and summaries). */
export function inlineText(nodes: Inline[]): string {
  return nodes.map(n => n.type === 'text' || n.type === 'code' ? n.text : inlineText(n.children)).join('');
}

/** Visible text of a Markdown fragment: link targets, ** and {#ids} removed. */
export function markdownText(markdown: string): string {
  return parseMarkdown(markdown).map(b => b.type === 'list' ? b.items.map(inlineText).join('\n') : b.type === 'heading' ? b.text : inlineText(b.children)).join('\n');
}
