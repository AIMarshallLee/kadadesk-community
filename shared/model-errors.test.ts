import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyModelFailure, providerReason } from './model-errors';

const OWN = 'https://api.example.test/v1';

test('out of balance is never a rate limit, whatever status it arrives with; a wrong key is not retried', () => {
  const balance: Array<[number, unknown]> = [
    [429, { error: { message: 'You exceeded your current quota, please check your plan and billing details.', type: 'insufficient_quota', code: 'insufficient_quota' } }],
    [429, { error: { code: '1113', message: '您的账户已欠费，请充值后重试。' } }],
    [429, { error: { message: 'Your account org-x is suspended, please check your plan and billing details', type: 'exceeded_current_quota_error' } }],
    [400, { error: { code: 'Arrearage', message: 'Access denied, please make sure your account is in good standing.' } }],
    [403, { code: 30001, message: 'Sorry, your account balance is insufficient' }],
    [402, { error: { message: 'Insufficient Balance' } }],
    [402, undefined],
  ];
  for (const [status, body] of balance) {
    const f = classifyModelFailure(status, body, OWN);
    assert.equal(f.kind, 'balance');
    assert.equal(f.retryable, false);
  }
  const key = classifyModelFailure(401, { error: { message: 'Incorrect API key provided' } }, OWN);
  assert.equal(key.kind, 'key');
  assert.equal(key.retryable, false);
});

test('providerReason scrubs long secrets and handles nested formats', () => {
  const dummyKey = ['s', 'k', '-abcdef1234567890'].join('');
  assert.equal(providerReason({ error: { message: `Invalid token ${dummyKey}` } }), 'Invalid token');
  assert.equal(providerReason(null), undefined);
});
