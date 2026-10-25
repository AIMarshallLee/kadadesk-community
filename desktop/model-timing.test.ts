import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelTimingBuffer, receptionModelTiming } from './model-timing';
import { safeModelTiming } from '../shared/model-timing';
import { createReplyModel } from './reply-model';

test('timing buffer bounds memory, returns copies, and resets its process marker', () => {
  const clock = () => new Date('2026-09-27T14:40:00Z');
  const buffer = createModelTimingBuffer(clock);
  for (let i = 0; i < 65; i++) {
    buffer.record({ stage: 'CHAT_REPLY', elapsedMs: i, result: 'response', httpStatus: 200, raw: 'PRIVATE' } as never);
  }
  const first = buffer.read();
  assert.equal(first.completedRequests, 65);
  assert.equal(first.samples.length, 30);
  assert.equal(first.samples[0].elapsedMs, 35);
  first.samples[0].elapsedMs = 999;
  assert.equal(buffer.read().samples[0].elapsedMs, 35);
  assert(!JSON.stringify(first).includes('PRIVATE'));
  const restarted = createModelTimingBuffer(() => new Date('2026-09-27T15:00:00Z')).read();
  assert.equal(restarted.completedRequests, 0);
  assert.notEqual(restarted.startedAt, first.startedAt);
});

test('ordinary model calls generate replies or fail with error', async () => {
  let calls = 0;
  const model = createReplyModel(
    { baseUrl: 'http://localhost:9000/v1', model: 'MOCK-MODEL' },
    async () => {
      calls++;
      return calls === 1
        ? Response.json({ choices: [{ message: { content: 'fictional reply' } }] })
        : new Response('SERVICE_UNAVAILABLE', { status: 503 });
    }
  );
  const input = { system: 'system prompt', messages: [{ role: 'user' as const, content: 'hi' }] };
  assert.equal(await model.generate(input), 'fictional reply');
  await assert.rejects(model.generate(input));
});
