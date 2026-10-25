/**
 * 使用手册: chapters parsed from docs/manual/*.md (bundled through the generated shared/manual-content.ts).
 * Used by the in-app 「使用手册」 page (src/ManualPage.tsx), ⌘K search and the 「问咔哒」 assistant
 * (server/help-assistant.ts), which retrieves the sections that match a question and links back to them.
 *
 * Chapter ids come from the file names (00-faq.md → faq). 常见问题 always comes first and 更新记录 last.
 * Sections are the `##` headings; `## 标题 {#id}` gives a section a stable id for deep links (#manual/faq/stop-now).
 */
import { MANUAL_FILES } from './manual-content';
import { markdownText, parseMarkdown, splitHeadingId } from './markdown';
import { normalize } from './feature-index';

export const MANUAL_FAQ = 'faq';
export const MANUAL_CHANGELOG = 'changelog';

export interface ManualSection {
  /** Unique within the chapter; '' is the chapter's own introduction. */
  id: string;
  title: string;
  markdown: string;
  text: string;
}
export interface ManualChapter {
  id: string;
  title: string;
  /** First paragraph, plain text. */
  summary: string;
  markdown: string;
  sections: ManualSection[];
}

export function chapterIdFromFile(file: string) {
  return file.replace(/^\d{2}-/, '').replace(/\.md$/, '');
}

export function parseChapter(file: string, markdown: string): ManualChapter {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const titleLine = lines.findIndex(l => /^#\s+/.test(l));
  const title = titleLine >= 0 ? splitHeadingId(lines[titleLine].replace(/^#\s+/, '')).text : chapterIdFromFile(file);
  const body = titleLine >= 0 ? lines.slice(titleLine + 1) : lines;
  const sections: ManualSection[] = [];
  let current = { id: '', title, lines: [] as string[] }, n = 0;
  const close = () => { const md = current.lines.join('\n').trim(); if (current.id || md) sections.push({ id: current.id, title: current.title, markdown: md, text: markdownText(md) }); };
  for (const line of body) {
    const h = /^##\s+(.+)$/.exec(line);
    if (h) { close(); n++; const { text, id } = splitHeadingId(h[1]); current = { id: id ?? `s${n}`, title: text, lines: [] }; continue; }
    current.lines.push(line);
  }
  close();
  const intro = sections.find(s => s.id === '');
  const firstPara = parseMarkdown(intro?.markdown ?? '').find(b => b.type === 'paragraph');
  return { id: chapterIdFromFile(file), title, summary: firstPara ? markdownText(intro!.markdown).split('\n')[0] : '', markdown, sections };
}

export function parseManual(files: ReadonlyArray<{ file: string; markdown: string }>): ManualChapter[] {
  const rank = (id: string) => id === MANUAL_FAQ ? 0 : id === MANUAL_CHANGELOG ? 2 : 1;
  return files.map(f => ({ f, chapter: parseChapter(f.file, f.markdown) }))
    .sort((a, b) => rank(a.chapter.id) - rank(b.chapter.id) || a.f.file.localeCompare(b.f.file))
    .map(x => x.chapter);
}

export const MANUAL: ManualChapter[] = parseManual(MANUAL_FILES);
export const manualChapter = (id: string) => MANUAL.find(c => c.id === id);
export const manualSection = (chapterId: string, sectionId: string) => manualChapter(chapterId)?.sections.find(s => s.id === sectionId);

/** Versions with an entry in 更新记录, newest first. */
export function manualVersions(chapters: ManualChapter[] = MANUAL): string[] {
  const log = chapters.find(c => c.id === MANUAL_CHANGELOG);
  return (log?.sections ?? []).map(s => /^v?(\d+\.\d+\.\d+)$/.exec(s.title)?.[1]).filter((v): v is string => !!v);
}
/** The newest version the manual describes. */
export const MANUAL_VERSION = manualVersions()[0] ?? '';

/** The in-app route of a chapter or section: navigate(manualRoute('faq', 'stop-now')). */
export function manualRoute(chapterId: string, sectionId?: string) {
  return `manual/${chapterId}${sectionId ? `/${sectionId}` : ''}`;
}
/** 'manual/faq/stop-now' (with or without #) → { chapter: 'faq', section: 'stop-now' }. */
export function parseManualRoute(route: string): { chapter?: string; section?: string } {
  const parts = route.replace(/^#/, '').split('/');
  if (parts[0] !== 'manual') return {};
  const chapter = parts[1] && manualChapter(parts[1]) ? parts[1] : undefined;
  const section = chapter && parts[2] && manualSection(chapter, decodeURIComponent(parts[2])) ? decodeURIComponent(parts[2]) : undefined;
  return { chapter, section };
}

/** 常见问题 in manual order (pinned at the top of the page). */
export function manualFaq(): Array<{ id: string; q: string; a: string }> {
  return (manualChapter(MANUAL_FAQ)?.sections ?? []).filter(s => s.id).map(s => ({ id: s.id, q: s.title, a: s.text }));
}

// —— Search ——
const FILLER = /怎么样|怎么办|怎么回事|怎么|如何|为什么|为啥|在哪里|在哪儿|在哪|哪里|是哪个|哪个|是什么|一下|可以|能不能|是不是|我想|我要|想要|请问|帮我|咔哒|的|了|吗|呢|吧|啊/g;
const bigrams = (s: string) => { const out = new Set<string>(); for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2)); return out; };
export interface ManualHit { chapterId: string; chapterTitle: string; sectionId: string; title: string; snippet: string; score: number }

interface Indexed { chapter: ManualChapter; section: ManualSection; title: string; text: string; titleGrams: Set<string>; textGrams: Set<string> }
let index: Indexed[] | undefined;
/** How rare each two-character piece is across the manual: rare pieces (「急停」) count more than common ones (「咔哒」). */
let rarity: Map<string, number> | undefined;
const indexed = () => {
  if (index) return index;
  index = MANUAL.filter(c => c.id !== MANUAL_CHANGELOG).flatMap(chapter => chapter.sections.map(section => {
    const title = normalize(section.id ? section.title : chapter.title), text = normalize(`${section.title}${section.text}`);
    return { chapter, section, title, text, titleGrams: bigrams(title), textGrams: bigrams(text) };
  }));
  const df = new Map<string, number>();
  for (const item of index) for (const g of item.textGrams) df.set(g, (df.get(g) ?? 0) + 1);
  rarity = new Map([...df].map(([g, n]) => [g, Math.log(1 + index!.length / n)]));
  return index;
};

function snippetOf(text: string, words: string[]) {
  const flat = text.replace(/\s+/g, ' ').trim();
  const at = words.map(w => flat.indexOf(w)).filter(i => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, at - 16);
  return (start ? '…' : '') + flat.slice(start, start + 70) + (flat.length > start + 70 ? '…' : '');
}

function scoreTerm(term: string, item: Indexed): number {
  if (!term) return 0;
  let score = 0;
  if (item.title.includes(term)) score += 60;
  else if (item.text.includes(term)) score += 30;
  if (term.length >= 2) {
    // Pieces that appear nowhere in the manual (「是哪」) are ignored; the rest are weighted by rarity.
    let total = 0, inTitle = 0, inText = 0;
    for (const g of bigrams(term)) {
      const w = rarity!.get(g);
      if (!w) continue;
      total += w;
      if (item.titleGrams.has(g)) inTitle += w;
      if (item.textGrams.has(g)) inText += w;
    }
    if (total) score += 45 * inText / total + 30 * inTitle / total;
  }
  return score;
}

/**
 * Sections that match the words, best first. Every space-separated word must match something.
 * 常见问题 answers rank a little higher, so a beginner's question lands on the short answer first.
 */
export function searchManual(query: string, limit = 8): ManualHit[] {
  const raw = query.split(/\s+/).map(normalize).filter(Boolean);
  const words = raw.map(w => w.replace(FILLER, '') || w);
  if (!words.length) return [];
  const hits: ManualHit[] = [];
  for (const item of indexed()) {
    let total = 0;
    for (const w of words) { const s = scoreTerm(w, item); if (s < 18) { total = 0; break; } total += s; }
    if (!total) continue;
    if (item.chapter.id === MANUAL_FAQ) total *= 1.15;
    if (!item.section.id) total *= words.every(w => item.title.includes(w)) ? 1.3 : 0.8;
    hits.push({ chapterId: item.chapter.id, chapterTitle: item.chapter.title, sectionId: item.section.id, title: item.section.id ? item.section.title : item.chapter.title, snippet: snippetOf(item.section.text, query.split(/\s+/).filter(Boolean)), score: Math.round(total) });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** The sections 「问咔哒」 hands to the model for a question: `ref` is chapter/section, text is bounded. */
export function manualForQuestion(question: string, max = 3, maxChars = 700): Array<{ ref: string; title: string; text: string }> {
  return searchManual(question, max).filter(h => h.score >= 30).map(h => {
    const section = manualSection(h.chapterId, h.sectionId)!;
    const text = section.text.replace(/\n{2,}/g, '\n').trim();
    return { ref: h.sectionId ? `${h.chapterId}/${h.sectionId}` : h.chapterId, title: h.chapterId === MANUAL_FAQ ? `常见问题：${h.title}` : h.sectionId ? `${h.chapterTitle} · ${h.title}` : h.chapterTitle, text: text.length > maxChars ? text.slice(0, maxChars) + '…' : text };
  });
}
