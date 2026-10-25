import assert from 'node:assert/strict';
import test from 'node:test';
import { categorize } from '../shared/knowledge-categories';

test('customer facts that merely mention 园区/展会/字幕/内部 are not hidden as 内部资料', () => {
  assert.equal(categorize('园区厂房出租价格 每平米每月25元'), '产品与价格');
  assert.equal(categorize('汽车内部清洁多少钱'), '产品与价格');
  assert.equal(categorize('展会搭建报价'), '产品与价格');
  assert.equal(categorize('视频加字幕怎么收费'), '产品与价格');
});

test('内部资料 only from an explicit tag or a 内部/仅内部 title prefix', () => {
  assert.equal(categorize('内部：底价表 进货价 30 元'), '内部资料');
  assert.equal(categorize('【仅内部】客服话术手册'), '内部资料');
  assert.equal(categorize('底价表', ['分类:内部资料']), '内部资料');
});
