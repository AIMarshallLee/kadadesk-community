import { platformLabel } from './channels';
import type { FlywheelKeywordItem } from './types';

/**
 * 扣词 matching for a conversation's first customer message. Width (全角/半角), case, spaces, punctuation and middle
 * dots are ignored. A keyword of 3+ characters matches when the message is it or contains it; a 2-character keyword
 * only when the message is (nearly) just that keyword, so 「资料」 does not fire on every sentence that mentions 资料.
 */
export function normalizeKeywordText(text: string): string {
  return String(text ?? '').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\p{Z}\s·・•‧∙⋅]+/gu, '');
}

export interface KeywordMatch { keyword: string; item: FlywheelKeywordItem; contextLine: string; sourceFact: string }

/** Strips what the hub sent to the fields kadadesk uses; drops anything malformed. */
export function cleanKeywordItems(raw: unknown): FlywheelKeywordItem[] {
  if (!Array.isArray(raw)) return [];
  const out: FlywheelKeywordItem[] = [];
  for (const r of raw.slice(0, 2000)) {
    if (!r || typeof r !== 'object') continue;
    const x = r as Record<string, unknown>;
    if (typeof x.keyword !== 'string' || typeof x.content_id !== 'string' || !normalizeKeywordText(x.keyword)) continue;
    out.push({ keyword: x.keyword.slice(0, 20), content_id: x.content_id.slice(0, 128), title: typeof x.title === 'string' ? x.title.slice(0, 120) : '', ...(typeof x.platform === 'string' ? { platform: x.platform.slice(0, 32) } : {}), ...(typeof x.published_at === 'string' ? { published_at: x.published_at.slice(0, 40) } : {}) });
  }
  return out;
}

export function matchKeyword(text: string, items: FlywheelKeywordItem[]): KeywordMatch | undefined {
  const input = normalizeKeywordText(text);
  if (!input || !items.length) return undefined;
  const sorted = items.map(item => ({ item, k: normalizeKeywordText(item.keyword) })).filter(x => x.k).sort((a, b) => b.k.length - a.k.length);
  const hit = sorted.find(x => x.k === input)
    ?? sorted.find(x => x.k.length >= 3 && input.includes(x.k))
    ?? sorted.find(x => x.k.length === 2 && input.length <= 4 && input.includes(x.k));
  if (!hit) return undefined;
  const title = hit.item.title || hit.item.content_id;
  return {
    keyword: hit.item.keyword, item: hit.item,
    contextLine: `这位客户是看了《${title}》（${platformLabel(hit.item.platform)}）来的，发了扣词「${hit.item.keyword}」。先接住这个来源：照内容里承诺的给到资料（资料里有对应回复就照常发），再接着聊。`,
    sourceFact: `《${title}》/扣词`.slice(0, 200),
  };
}
