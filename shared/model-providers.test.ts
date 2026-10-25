import test from 'node:test';
import assert from 'node:assert/strict';
import { findProvider, modelProviders, providerForBaseUrl, providerGroups, searchProviders } from './model-providers';

test('provider catalogue: unique ids and aliases, valid OpenAI-compatible URLs, https signup links', () => {
  const names = modelProviders.flatMap(p => [p.id, ...(p.aliases ?? [])]);
  assert.equal(new Set(names).size, names.length, 'ids and aliases are unique');
  for (const p of modelProviders) {
    assert.ok(['cn', 'global'].includes(p.region), p.id);
    assert.ok(['direct', 'relay', 'local', 'custom'].includes(p.kind), p.id);
    assert.ok(p.label && p.keyHint, p.id);
    if (p.signupUrl) assert.equal(new URL(p.signupUrl).protocol, 'https:', p.id);
    if (p.baseUrl) {
      const u = new URL(p.baseUrl);
      assert.ok(u.protocol === 'https:' || (p.kind === 'local' && u.hostname === '127.0.0.1'), p.id);
      assert.doesNotMatch(p.baseUrl, /\/chat\/completions|\/$|[?#]/, p.id);
    } else assert.ok(p.kind === 'relay' || p.kind === 'custom', `${p.id} without URL must let the user type it`);
    assert.equal(p.needsKey, p.kind !== 'local', p.id);
  }
  assert.equal(findProvider('deepseek')!.visionCapable, false);
  for (const id of ['zhipu-cn', 'qwen-cn', 'doubao-cn', 'deepseek', 'kimi-cn', 'minimax-cn', 'hunyuan-cn', 'qianfan-cn', 'siliconflow-cn', 'openrouter', 'gemini', 'openai', 'anthropic', 'xai', 'groq', 'together', 'ollama-local', 'lmstudio-local', 'relay-other', 'custom']) {
    assert.ok(findProvider(id), id);
  }
  for (const p of modelProviders) {
    assert.equal(providerGroups.filter(g => g.match(p)).length, 1, p.id);
  }
});

test('legacy ids still resolve', () => {
  assert.equal(findProvider('custom-global')!.id, 'relay-other');
  assert.equal(providerForBaseUrl('https://dashscope.aliyuncs.com/compatible-mode/v1')!.id, 'qwen-cn');
  assert.equal(providerForBaseUrl('https://unknown.example/v1'), undefined);
  assert.deepEqual(searchProviders('kimi').map(p => p.id), ['kimi-cn']);
  assert.ok(searchProviders('openrouter.ai').some(p => p.id === 'openrouter'));
});
