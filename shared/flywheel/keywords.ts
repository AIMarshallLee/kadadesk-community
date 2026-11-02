/**
 * 扣词匹配引擎与上下文生成
 */

import type { FlywheelKeywordItem } from './types';

export function normalizeKeywordText(text: string): string {
  if (!text) return '';
  let s = text.replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)).replace(/\u3000/g, ' ');
  s = s.toLowerCase();
  s = s.replace(/[\s\r\n\t~`!@#$%^&*()_\-+={}\[\]|\\:;"'<>,.?/，。！？、；：""''（）《》【】…—]+/gu, '');
  return s;
}

export function platformDisplayName(platform?: string): string {
  switch (platform?.toLowerCase()) {
    case 'xhs':
    case 'xiaohongshu':
      return '小红书';
    case 'douyin':
      return '抖音';
    case 'shipinhao':
    case 'channels':
      return '视频号';
    case 'bilibili':
    case 'b站':
      return 'B站';
    case 'kuaishou':
      return '快手';
    case 'wechat_article':
      return '公众号';
    case 'moments':
      return '朋友圈';
    default:
      return platform || '线上内容';
  }
}

export interface KeywordMatchResult {
  matched: true;
  keyword: string;
  item: FlywheelKeywordItem;
  contextPrompt: string;
  sourceFactValue: string;
}

export interface KeywordNoMatch {
  matched: false;
}

export type KeywordCheckResult = KeywordMatchResult | KeywordNoMatch;

export function matchKeywords(text: string, keywords: FlywheelKeywordItem[]): KeywordCheckResult {
  if (!text || !keywords || keywords.length === 0) return { matched: false };

  const normInput = normalizeKeywordText(text);
  if (!normInput) return { matched: false };

  const sorted = [...keywords].sort((a, b) => b.keyword.length - a.keyword.length);

  for (const item of sorted) {
    const normKw = normalizeKeywordText(item.keyword);
    if (!normKw) continue;
    if (normInput === normKw) {
      const pName = platformDisplayName(item.platform);
      return {
        matched: true,
        keyword: item.keyword,
        item,
        contextPrompt: `这位客户是看了《${item.title}》（${pName}）来的，发了扣词「${item.keyword}」`,
        sourceFactValue: `《${item.title}》/扣词`,
      };
    }
  }

  for (const item of sorted) {
    const normKw = normalizeKeywordText(item.keyword);
    if (!normKw || normKw.length < 2) continue;
    if (normInput.includes(normKw)) {
      const pName = platformDisplayName(item.platform);
      return {
        matched: true,
        keyword: item.keyword,
        item,
        contextPrompt: `这位客户是看了《${item.title}》（${pName}）来的，发了扣词「${item.keyword}」`,
        sourceFactValue: `《${item.title}》/扣词`,
      };
    }
  }

  return { matched: false };
}
