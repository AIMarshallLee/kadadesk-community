import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { inlineText, markdownText, parseInline, parseMarkdown, safeHref, type Inline } from './markdown';
import ManualMarkdown from '../src/ManualMarkdown';

const render = (markdown: string) => renderToStaticMarkup(createElement(ManualMarkdown, { markdown, onLink: () => {} }));

test('headings, lists, bold, code, tips and heading ids are parsed', () => {
  const blocks = parseMarkdown('# 标题\n\n## 怎么暂停 {#pause}\n\n第一行\n第二行\n\n- **加粗** 和 `代码`\n- 第二项\n\n1. 一\n2. 二\n\n> 提示一\n> 提示二');
  assert.deepEqual(blocks.map(b => b.type), ['heading', 'heading', 'paragraph', 'list', 'list', 'quote']);
  assert.deepEqual(blocks[1], { type: 'heading', level: 2, id: 'pause', children: [{ type: 'text', text: '怎么暂停' }], text: '怎么暂停' });
  assert.equal(inlineText((blocks[2] as { children: Inline[] }).children), '第一行第二行', 'Chinese lines join without a space');
  const list = blocks[3] as { ordered: boolean; items: unknown[][] };
  assert.equal(list.ordered, false); assert.equal(list.items.length, 2);
  assert.deepEqual(list.items[0], [{ type: 'strong', children: [{ type: 'text', text: '加粗' }] }, { type: 'text', text: ' 和 ' }, { type: 'code', text: '代码' }]);
  assert.equal((blocks[4] as { ordered: boolean }).ordered, true);
  assert.equal(markdownText('> 提示一\n> 提示二'), '提示一提示二');
});

test('only in-app routes become links; javascript:, http:, mailto: and data: stay plain text', () => {
  assert.equal(safeHref('#manual/faq/stop-now'), '#manual/faq/stop-now');
  assert.equal(safeHref('#settings'), '#settings');
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'https://evil.example', 'http://x', 'mailto:a@b.c', 'data:text/html,<b>x</b>', '#"onmouseover=alert(1)', '//evil', 'vbscript:x']) assert.equal(safeHref(bad), undefined, bad);
  assert.deepEqual(parseInline('[点我](javascript:alert(1)) 和 [手册](#manual/faq)'), [
    { type: 'text', text: '点我 和 ' },
    { type: 'link', href: '#manual/faq', children: [{ type: 'text', text: '手册' }] },
  ]);
});

test('the renderer escapes raw HTML and never emits script, handlers or unsafe links', () => {
  const html = render('# <img src=x onerror=alert(1)>\n\n<script>alert(1)</script>\n\n- <b onclick="x()">粗</b>\n\n[去](javascript:alert(1)) [外链](https://evil.example) [手册](#manual/faq)\n\n> <iframe src="https://evil.example"></iframe>');
  assert.ok(!/<script|<img|<iframe|<b /i.test(html), html);
  assert.ok(!/<[^>]*\son\w+=/i.test(html), 'no element carries an event handler');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('javascript:') && !html.includes('evil.example"'), 'no unsafe href');
  assert.match(html, /<a href="#manual\/faq">手册<\/a>/);
  assert.match(html, /<aside class="manual-tip">/);
  const source = readFileSync(new URL('../src/ManualMarkdown.tsx', import.meta.url), 'utf8') + readFileSync(new URL('../src/ManualPage.tsx', import.meta.url), 'utf8');
  assert.ok(!source.includes('dangerouslySetInnerHTML'), 'manual UI never injects HTML');
});

test('links call back with the route, without the #', () => {
  let followed = '';
  const el = ManualMarkdown({ markdown: '[暂停](#manual/pause-stop)', onLink: route => { followed = route; } }) as { props: { children: Array<{ props: { children: Array<{ props: { onClick: (e: { preventDefault(): void }) => void } }> } }> } };
  el.props.children[0].props.children[0].props.onClick({ preventDefault() {} });
  assert.equal(followed, 'manual/pause-stop');
});
