import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPluginHost } from './plugin-host.ts';
import { createCommunityKnowledge } from './knowledge-community.ts';
import { createMomentsOperations } from './moments-campaign.ts';
import { createTaskRunner } from './task-runner.ts';

test('trusted workflow transfers only approved knowledge into a human-review content draft', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kadadesk-tasks-'));
  try {
    const plugins = await createPluginHost(dir);
    const knowledge = await createCommunityKnowledge(dir);
    const moments = await createMomentsOperations(dir);
    let tasks = await createTaskRunner(dir, { requireEnabled: plugins.requireEnabled, knowledge, moments });

    const entry = await knowledge.handle('POST', '/knowledge', {
      title: '测试售后政策', content: '退换货事项以商家人工确认为准。',
    }) as { id: string };
    const beforeApproval = await tasks.start('knowledge-to-content', { title: '审核前测试', query: '售后政策' });
    assert.equal(beforeApproval.status, 'blocked');
    assert.equal((await moments.handle('GET', '/moments') as { content: unknown[] }).content.length, 0);

    await knowledge.handle('POST', '/knowledge/' + entry.id + '/approve');
    const done = await tasks.start('knowledge-to-content', { title: '售后说明草稿', query: '售后政策' });
    assert.equal(done.status, 'completed');
    assert.deepEqual(done.result?.sourceIds, [entry.id]);
    assert.equal(done.result?.manualReviewRequired, true);
    assert.equal(done.result?.automaticExternalSend, false);
    const snapshot = await moments.handle('GET', '/moments') as {
      content: { id: string; text: string }[];
      jobs: unknown[];
      provider: { autoPublishEnabled: boolean };
    };
    assert.equal(snapshot.content.length, 1);
    assert.equal(snapshot.content[0].id, done.result?.contentId);
    assert.match(snapshot.content[0].text, /待人工审查/);
    assert.equal(snapshot.jobs.length, 0);
    assert.equal(snapshot.provider.autoPublishEnabled, false);

    await plugins.handle('POST', '/plugins/com.kadadesk.content-ops/disable');
    const disabled = await tasks.start('knowledge-to-content', { title: '不应生成', query: '售后政策' });
    assert.equal(disabled.status, 'blocked');
    assert.equal((await moments.handle('GET', '/moments') as { content: unknown[] }).content.length, 1);

    tasks = await createTaskRunner(dir, { requireEnabled: plugins.requireEnabled, knowledge, moments });
    assert.equal(tasks.list().tasks.length, 3);
    assert.equal(tasks.list().tasks.find(t => t.id === done.id)?.status, 'completed');
    assert.equal(tasks.list().automaticExternalSend, false);
    assert.equal((await readFile(join(dir, 'trusted-tasks-v1.json'), 'utf8')).includes(done.id), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('interrupted runs are never automatically retried after restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kadadesk-recovery-'));
  try {
    await writeFile(join(dir, 'trusted-tasks-v1.json'), JSON.stringify({
      schema: 1, tasks: [{
        id: 'existing', workflowId: 'knowledge-to-content', title: '中断的任务',
        status: 'running', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      }],
    }));
    const plugins = await createPluginHost(dir);
    const knowledge = await createCommunityKnowledge(dir);
    const moments = await createMomentsOperations(dir);
    const tasks = await createTaskRunner(dir, { requireEnabled: plugins.requireEnabled, knowledge, moments });
    assert.equal(tasks.list().tasks[0].status, 'interrupted');
    assert.equal((await moments.handle('GET', '/moments') as { content: unknown[] }).content.length, 0);
    await assert.rejects(
      tasks.start('knowledge-to-content', { title: '', query: '知识' }),
      /标题|草稿/,
    );
    await assert.rejects(tasks.handle('POST', '/tasks/unknown', {}), /不存在/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
