import test from 'node:test';
import assert from 'node:assert/strict';
import { plainTalk, plainAction } from './plain-talk';

test('internal jargon never reaches the operator', () => {
  const samples = ['目标页面暂不可见；等待键鼠空闲后自动找回，并重新核对客户。', '输入文字阶段停止：执行或模型读取异常。请核对会话与草稿，勿重发。', '重启后已暂停，旧任务交人工并等待新基线', '消息连续性暂未确认（第 2 次），保留原检查点，稍后重新核对，未回复。', '存在同名会话，暂不按名称打开；有新未读时按联系账号区分后回复。', '识图模型返回的JSON格式无效 [VISION_JSON]', '模型协议无效。'];
  for (const s of samples) assert.doesNotMatch(plainTalk(s), /基线|检查点|连续性|核对|执行器|协议|JSON|草稿，勿重发/);
});
test('actions: wait, look, settings', () => {
  assert.equal(plainAction('你仍在使用键鼠，读取已让出'), 'none');
  assert.equal(plainAction('对方发来图片、文件或视频，需人工查看后回复。'), 'look');
  assert.equal(plainAction('图片测试未通过（HTTP 401）：密钥认证失败'), 'settings');
  assert.match(plainTalk('关键词「退款」命中，转人工'), /「退款」/);
  assert.equal(plainTalk(''), '');
});
