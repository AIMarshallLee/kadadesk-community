import test from 'node:test';
import assert from 'node:assert/strict';
import { addReceptionListener, emitReceptionEvent, pluginHooks, receptionListenerCount, setReceptionResolver } from './plugin-hooks';
import type { ReceptionEvent, ResolvedReceptionEvent } from './replies-contract';

const tick = () => new Promise(resolve => setImmediate(resolve));

test('events reach the plugin hook at once and every listener later, resolved; a failing listener changes nothing', async () => {
  const seen: string[] = [];
  const previous = pluginHooks.receptionEvent;
  pluginHooks.receptionEvent = event => { seen.push(`hook:${event.kind}`); };
  setReceptionResolver(event => ({ ...event, at: event.at ?? 'now', profileId: `p-${event.conversation}`, conversationKey: 'k' }) as ResolvedReceptionEvent);
  const offBad = addReceptionListener(() => { throw new Error('boom'); });
  const offAsync = addReceptionListener(async () => { throw new Error('async boom'); });
  const off = addReceptionListener(event => { seen.push(`listener:${event.kind}:${event.profileId}`); });
  try {
    assert.doesNotThrow(() => emitReceptionEvent({ kind: 'incoming', conversation: '王五', text: '你好', first: true }));
    // The caller never waits: listeners have not run yet when emit returns.
    assert.deepEqual(seen, ['hook:incoming']);
    await tick(); await tick();
    assert.deepEqual(seen, ['hook:incoming', 'listener:incoming:p-王五']);
    off();
    emitReceptionEvent({ kind: 'handoff', conversation: '王五', text: '人工', detail: '' });
    await tick(); await tick();
    assert.deepEqual(seen, ['hook:incoming', 'listener:incoming:p-王五', 'hook:handoff']);
  } finally {
    offBad(); offAsync(); off(); pluginHooks.receptionEvent = previous; setReceptionResolver(undefined);
  }
});

test('a chat without a profile (resolver says no) reaches no listener; without a resolver only events naming their profile pass', async () => {
  const seen: ReceptionEvent[] = [];
  setReceptionResolver(event => event.conversation === '家人群' ? undefined : ({ ...event, at: 'x', profileId: 'p', conversationKey: 'k' }) as ResolvedReceptionEvent);
  const off = addReceptionListener(e => { seen.push(e); });
  try {
    emitReceptionEvent({ kind: 'incoming', conversation: '家人群', text: 'hi', first: true, chatKind: 'group' });
    emitReceptionEvent({ kind: 'reply-sent', conversation: '客户', text: '', mode: 'auto', by: 'ai' });
    await tick(); await tick();
    assert.deepEqual(seen.map(e => e.kind), ['reply-sent']);
    setReceptionResolver(undefined);
    emitReceptionEvent({ kind: 'incoming', conversation: '无档案', text: 'hi', first: true });
    emitReceptionEvent({ kind: 'profile-updated', conversation: '有档案', profileId: 'c-1', conversationKey: 'k1', changedFacts: [] });
    await tick(); await tick();
    assert.deepEqual(seen.map(e => e.kind), ['reply-sent', 'profile-updated']);
  } finally { off(); setReceptionResolver(undefined); }
  assert.equal(receptionListenerCount(), 0);
});

test('nobody listening: emitting costs nothing and never calls the resolver', async () => {
  let resolved = 0;
  setReceptionResolver(event => { resolved++; return { ...event, at: 'x', profileId: 'p', conversationKey: 'k' } as ResolvedReceptionEvent; });
  try {
    emitReceptionEvent({ kind: 'incoming', conversation: '客户', text: 'hi', first: true });
    await tick(); await tick();
    assert.equal(resolved, 0);
  } finally { setReceptionResolver(undefined); }
});
