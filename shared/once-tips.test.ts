import test from 'node:test';
import assert from 'node:assert/strict';
import { TIP_KINDS, TIPS_MAX, cleanTipList, skipConfirm, validTipKey } from './once-tips';
import { NOTICE_KINDS } from './notices';

test('tip keys are short, plain and unique; labels are plain and never name the chat app', () => {
  const keys = TIP_KINDS.map(k => k.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const kind of TIP_KINDS) {
    assert.ok(validTipKey(kind.key), kind.key);
    assert.doesNotMatch(kind.label, /聊天软件|。$/);
    assert.equal(kind.confirm === true, kind.key.startsWith('confirm-'), `${kind.key}: confirm keys start with confirm-`);
  }
  for (const kind of NOTICE_KINDS) assert.doesNotMatch(kind.label, /聊天软件|。$/);
  for (const key of ['moments', 'plugins', 'license', 'storage', 'authenticator', 'reply-failed']) assert.ok(NOTICE_KINDS.some(k => k.key === key), key);
});

test('stored tip lists keep valid unique keys, newest last, capped', () => {
  assert.deepEqual(cleanTipList(undefined), []);
  assert.deepEqual(cleanTipList({ a: 1 }), []);
  assert.deepEqual(cleanTipList(['reception-mouse', 'Bad Key', '', 42, 'x'.repeat(61), 'reception-mouse', 'emergency-stop']), ['reception-mouse', 'emergency-stop']);
  assert.deepEqual(cleanTipList(['a', 'b', 'a']), ['b', 'a'], 'a repeated key moves to the end');
  const many = Array.from({ length: TIPS_MAX + 5 }, (_, i) => `k${i}`);
  const kept = cleanTipList(many);
  assert.equal(kept.length, TIPS_MAX);
  assert.equal(kept.at(-1), `k${TIPS_MAX + 4}`);
  assert.equal(validTipKey('-start'), false);
  assert.equal(validTipKey('../etc'), false);
});

test('a confirmation is skipped only when its own 「以后不再问」 key was ticked', () => {
  const muted = (key: string) => key === 'confirm-auto-mode';
  assert.equal(skipConfirm({ remember: 'confirm-auto-mode' }, muted), true);
  assert.equal(skipConfirm({ remember: 'confirm-review-off' }, muted), false);
  assert.equal(skipConfirm({}, () => true), false, 'a confirmation without a key always asks (e.g. deleting a rule)');
});
