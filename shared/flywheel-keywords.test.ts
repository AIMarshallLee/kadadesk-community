import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeKeywordText,
  platformDisplayName,
  matchKeywords,
} from './flywheel/keywords';
import type { FlywheelKeywordItem } from './flywheel/types';

test('normalizeKeywordText handles whitespace, casing, and full-width characters', () => {
  assert.equal(normalizeKeywordText('  ＫＡＤＡ  '), 'kada');
  assert.equal(normalizeKeywordText('领 取！【资料】'), '领取资料');
  assert.equal(normalizeKeywordText('hello, WORLD.'), 'helloworld');
  assert.equal(normalizeKeywordText('3D　展厅'), '3d展厅');
});

test('platformDisplayName maps known identifiers and falls back cleanly', () => {
  assert.equal(platformDisplayName('xhs'), '小红书');
  assert.equal(platformDisplayName('xiaohongshu'), '小红书');
  assert.equal(platformDisplayName('douyin'), '抖音');
  assert.equal(platformDisplayName('shipinhao'), '视频号');
  assert.equal(platformDisplayName('channels'), '视频号');
  assert.equal(platformDisplayName('bilibili'), 'B站');
  assert.equal(platformDisplayName('kuaishou'), '快手');
  assert.equal(platformDisplayName('wechat_article'), '公众号');
  assert.equal(platformDisplayName('moments'), '朋友圈');
  assert.equal(platformDisplayName('other-channel'), 'other-channel');
  assert.equal(platformDisplayName(undefined), '线上内容');
});

test('matchKeywords prefers exact matches and longer keywords', () => {
  const keywords: FlywheelKeywordItem[] = [
    {
      keyword: '设计',
      title: '普通设计咨询',
      platform: 'xhs',
      content_id: 'xhs-1',
    },
    {
      keyword: 'AI设计方案',
      title: 'AI全屋设计大师课',
      platform: 'douyin',
      content_id: 'douyin-101',
    },
    {
      keyword: 'VIP',
      title: 'VIP会员权益',
      platform: 'kuaishou',
      content_id: 'ks-1',
    },
  ];

  // Longest match wins
  const m1 = matchKeywords('你好，我想要一份AI设计方案，谢谢', keywords);
  assert.equal(m1.matched, true);
  if (m1.matched) {
    assert.equal(m1.keyword, 'AI设计方案');
    assert.equal(m1.item.title, 'AI全屋设计大师课');
    assert.match(m1.contextPrompt, /《AI全屋设计大师课》/);
    assert.match(m1.contextPrompt, /抖音/);
    assert.equal(m1.sourceFactValue, '《AI全屋设计大师课》/扣词');
  }

  // Short match when long does not match
  const m2 = matchKeywords('请问你们有室内设计服务吗？', keywords);
  assert.equal(m2.matched, true);
  if (m2.matched) {
    assert.equal(m2.keyword, '设计');
    assert.match(m2.contextPrompt, /小红书/);
  }

  // Exact match with punctuation / whitespace
  const m3 = matchKeywords('【vip】', keywords);
  assert.equal(m3.matched, true);
  if (m3.matched) {
    assert.equal(m3.keyword, 'VIP');
    assert.match(m3.contextPrompt, /快手/);
  }

  // No match
  const m4 = matchKeywords('今天天气真好，去散步', keywords);
  assert.equal(m4.matched, false);
});
