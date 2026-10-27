import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalServer } from './index.ts';

test('local task API requires session token and only creates reviewed draft', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kadadesk-task-http-'));
  const app = await createLocalServer({ dataDir });
  try {
    const url = app.url + '/api';
    const headers = { 'x-kadadesk-token': app.token, 'content-type': 'application/json' };
    const call = async (method: string, path: string, body?: object) => fetch(url + path, {
      method, headers, ...(body ? { body: JSON.stringify(body) } : {}),
    });

    assert.equal((await fetch(url + '/tasks')).status, 403);
    const noKnowledge = await call('POST', '/tasks/knowledge-to-content', {
      title: '草稿', query: '售后服务',
    });
    assert.equal(noKnowledge.status, 200);
    assert.equal((await noKnowledge.json()).status, 'blocked');

    const created = await call('POST', '/knowledge', {
      title: '售后服务说明', content: '问题请联系人工客服核实。',
    });
    assert.equal(created.status, 200);
    const entry = await created.json() as { id: string };
    const approve = await call('POST', '/knowledge/' + entry.id + '/approve', {});
    assert.equal(approve.status, 200);
    const run = await call('POST', '/tasks/knowledge-to-content', {
      title: '售后草稿', query: '售后服务',
    });
    assert.equal(run.status, 200);
    const task = await run.json() as { status: string; result: { contentId: string; automaticExternalSend: boolean } };
    assert.equal(task.status, 'completed');
    assert.equal(task.result.automaticExternalSend, false);

    const tasks = await call('GET', '/tasks');
    assert.equal(tasks.status, 200);
    assert.equal((await tasks.json()).tasks.length, 2);
    assert.equal((await call('GET', '/tasks/random')).status, 404);
    assert.equal((await call('POST', '/tasks/knowledge-to-content/execute', {})).status, 404);
    assert.equal((await call('GET', '/moments')).status, 200);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
