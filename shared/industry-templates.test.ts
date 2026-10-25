import test from 'node:test';
import assert from 'node:assert/strict';
import { industryTemplates, industryToneLabels, placeholderCount } from './industry-templates';

const banned = ['聊天软件', 'WeChat', '公众号', '朋友圈', '通讯录', '保证', '包过', '最低价', '100%'];

test('six industry templates with unique ids and a known tone', () => {
  assert.equal(industryTemplates.length, 6);
  assert.equal(new Set(industryTemplates.map(t => t.id)).size, 6);
  for (const t of industryTemplates) assert.ok(t.tone in industryToneLabels, t.id);
});

test('every template has 12–20 filled, placeholder-marked pairs and no banned words', () => {
  for (const t of industryTemplates) {
    assert.ok(t.id.trim() && t.label.trim() && t.description.trim(), `${t.id}: empty field`);
    assert.ok(t.pairs.length >= 12 && t.pairs.length <= 20, `${t.id}: ${t.pairs.length} pairs`);
    assert.equal(new Set(t.pairs.map(p => p.q)).size, t.pairs.length, `${t.id}: duplicate question`);
    for (const p of t.pairs) {
      assert.ok(p.q.trim() && p.a.trim(), `${t.id}: empty pair`);
      assert.ok(placeholderCount(p.a) > 0, `${t.id}: no 【】 in answer to ${p.q}`);
    }
    const all = JSON.stringify(t);
    for (const word of banned) assert.ok(!all.includes(word), `${t.id} contains ${word}`);
  }
});
