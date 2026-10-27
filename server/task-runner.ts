import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TaskRecord, WorkflowInfo, WorkflowId } from '../sdk/workflow-contracts.ts';
import { ApiError } from './autopilot.ts';

/**
 * V1: only source-reviewed, bundled workflows are executable.
 * No arbitrary uploaded code, dynamic plugin installation, platform sending or retries.
 */
type Dependencies = {
  requireEnabled(id: string): void;
  knowledge: {
    search(query: string, limit?: number): { id: string; title: string; excerpt: string }[];
  };
  moments: {
    handle(method: string, route: string, body?: Record<string, unknown>): Promise<unknown>;
  };
};
type Store = { schema: 1; tasks: TaskRecord[] };
type Input = { title: string; query: string };
const workflows: readonly WorkflowInfo[] = [{
  id: 'knowledge-to-content',
  name: '已审核知识 → 待审核内容草稿',
  requiredPlugins: ['com.kadadesk.knowledge', 'com.kadadesk.content-ops'],
  externalSend: false,
}];
const allowedStatuses = new Set(['running', 'completed', 'blocked', 'interrupted']);

function validateStore(input: unknown): asserts input is Store {
  const data = input as Store;
  if (!data || data.schema !== 1 || !Array.isArray(data.tasks) || data.tasks.length > 100 ||
    data.tasks.some(t => !t || typeof t.id !== 'string' ||
      t.workflowId !== 'knowledge-to-content' || !allowedStatuses.has(t.status) ||
      typeof t.title !== 'string' || typeof t.createdAt !== 'string' ||
      typeof t.updatedAt !== 'string')) {
    throw Error('任务记录数据异常；原文件已保留，请检查备份');
  }
}
function required(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new ApiError(400, label + '不能为空或超出长度限制');
  }
  return value.trim();
}

export async function createTaskRunner(dataDir: string, deps: Dependencies) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const path = join(dataDir, 'trusted-tasks-v1.json');
  let store: Store;
  try { store = JSON.parse(await readFile(path, 'utf8')) as Store; }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    store = { schema: 1, tasks: [] };
  }
  validateStore(store);
  async function persist(next: Store) {
    const temp = path + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(temp, JSON.stringify(next, null, 2), { mode: 0o600, flag: 'wx' });
      await rename(temp, path);
      store = next;
    } catch (e) {
      await unlink(temp).catch(() => {});
      throw e;
    }
  }
  // No auto-replay after a crash: a content draft may have been written before
  // the final task status, and blindly retrying could duplicate business data.
  if (store.tasks.some(t => t.status === 'running')) {
    await persist({
      schema: 1,
      tasks: store.tasks.map(t => t.status === 'running' ? {
        ...t, status: 'interrupted' as const,
        error: '任务曾中断，请人工检查内容草稿后决定是否重做',
        updatedAt: new Date().toISOString(),
      } : t),
    });
  }
  let tail: Promise<unknown> = Promise.resolve();
  const queue = <T>(fn: () => Promise<T>) => {
    const job = tail.then(fn);
    tail = job.catch(() => {});
    return job;
  };
  function list() {
    return {
      workflows: workflows.map(w => ({ ...w, requiredPlugins: [...w.requiredPlugins] })),
      tasks: structuredClone(store.tasks),
      automaticExternalSend: false,
    };
  }
  async function start(workflowId: WorkflowId, input: Record<string, unknown>) {
    if (workflowId !== 'knowledge-to-content') throw new ApiError(404, '未知的可信任务类型');
    const title = required(input.title, '草稿标题', 120);
    const query = required(input.query, '知识查询', 500);
    return queue(async () => {
      const now = new Date().toISOString();
      const task: TaskRecord = {
        id: randomUUID(), workflowId, title, status: 'running',
        createdAt: now, updatedAt: now,
      };
      await persist({ schema: 1, tasks: [task, ...store.tasks].slice(0, 100) });
      try {
        // Check both modules at task boundaries. A disabled module cannot run.
        for (const id of workflows[0].requiredPlugins) deps.requireEnabled(id);
        const hits = deps.knowledge.search(query, 5);
        if (!hits.length) throw new ApiError(409, '没有找到已审核、已启用的相关知识；未生成内容');
        deps.requireEnabled('com.kadadesk.content-ops');
        const lines = hits.map((hit, i) => {
          return String(i + 1) + '．' + hit.title + '\n' + hit.excerpt;
        });
        const text = '【待人工审查的资料整理稿；非自动生成的营销承诺】\n' +
          lines.join('\n\n') + '\n\n【来源】\n' +
          hits.map(h => h.title + '（' + h.id + '）').join('\n') +
          '\n\n请核对事实、授权、文案与发布渠道。此任务不会向外部平台发送任何内容。';
        // This is the only business write. It creates an ordinary unapproved draft.
        const created = await deps.moments.handle('POST', '/moments/content', {
          title, text, assetIds: [],
        }) as { id: string };
        if (!created || typeof created.id !== 'string') {
          throw Error('内容插件未返回草稿 ID');
        }
        const done: TaskRecord = {
          ...task, status: 'completed', updatedAt: new Date().toISOString(),
          result: {
            contentId: created.id,
            sourceIds: hits.map(h => h.id),
            manualReviewRequired: true,
            automaticExternalSend: false,
          },
        };
        await persist({ ...store, tasks: store.tasks.map(t => t.id === task.id ? done : t) });
        return structuredClone(done);
      } catch (e) {
        const blocked: TaskRecord = {
          ...task, status: 'blocked', updatedAt: new Date().toISOString(),
          error: e instanceof ApiError ? e.message : '任务执行出现异常，请检查草稿和本机日志',
        };
        await persist({ ...store, tasks: store.tasks.map(t => t.id === task.id ? blocked : t) });
        return structuredClone(blocked);
      }
    });
  }
  function handle(method: string, path: string, body: Record<string, unknown> = {}) {
    if (method === 'GET' && path === '/tasks') return list();
    if (method === 'POST' && path === '/tasks/knowledge-to-content') {
      return start('knowledge-to-content', body);
    }
    throw new ApiError(404, '任务接口不存在');
  }
  return { handle, list, start };
}
