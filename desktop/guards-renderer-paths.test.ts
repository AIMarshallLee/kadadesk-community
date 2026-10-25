import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isAllowedRequest } from './guards';

// Every API call the pages make must pass the desktop request guard; otherwise the feature only fails in the installed
// app with 「Request is not allowed.」 (问咔哒, 客资看板, 知识包 and the free-model check did, until 0.8.22).
test('every request path the pages use is allowed by the desktop guard', () => {
  const dir = join(import.meta.dirname, '..', 'src'); const blocked: string[] = [];
  for (const f of readdirSync(dir).filter(n => /\.tsx?$/.test(n))) {
    const s = readFileSync(join(dir, f), 'utf8');
    for (const m of s.matchAll(/(?:api|perform)(?:<[^()]*>)?\(\s*(?:'(GET|POST|PUT|DELETE)'|[^,()]*\?\s*'(GET|POST|PUT|DELETE)'\s*:\s*'(GET|POST|PUT|DELETE)')\s*,\s*[`'"](\/[^`'"]*)[`'"]/g)) {
      const path = m[4].replace(/\$\{[^}]+\}/g, 'x');
      for (const method of [m[1], m[2], m[3]].filter(Boolean)) if (!isAllowedRequest({ method: method as 'GET', path })) blocked.push(`${method} ${path} (${f})`);
    }
  }
  assert.deepEqual(blocked, []);
});
