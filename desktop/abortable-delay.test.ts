import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { waitForAbortOrTimeout } from './abortable-delay';

test('长期回复正常等待结束后不积累 abort 监听器', async () => {
  const controller = new AbortController();
  for (let i = 0; i < 30; i++) {
    await waitForAbortOrTimeout(1, controller.signal);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  }
});
test('停止会立即结束等待且清理定时器和监听器', { timeout: 1000 }, async () => {
  const controller = new AbortController();
  const waiting = waitForAbortOrTimeout(60000, controller.signal);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 1);
  controller.abort(); await waiting;
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  await waitForAbortOrTimeout(60000, controller.signal);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});
