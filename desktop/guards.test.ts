import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedRequest, isAllowedRendererUrl } from './guards.ts';

test('isAllowedRequest validates supported community methods and endpoints', () => {
  assert.equal(isAllowedRequest({ method: 'GET', path: '/state' }), true);
  assert.equal(isAllowedRequest({ method: 'POST', path: '/knowledge' }), true);
  assert.equal(isAllowedRequest({ method: 'DELETE', path: '/knowledge/k1' }), true);
  assert.equal(isAllowedRequest({ method: 'POST', path: '/admin/shutdown' }), false);
  assert.equal(isAllowedRequest(null), false);
});

test('isAllowedRendererUrl validates safe local schemes', () => {
  assert.equal(isAllowedRendererUrl('file:///app/index.html', 'file:///app/index.html'), true);
  assert.equal(isAllowedRendererUrl('http://evil.com', 'file:///app/index.html'), false);
});
