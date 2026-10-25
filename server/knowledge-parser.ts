import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker, type WorkerOptions } from 'node:worker_threads';
import type { KnowledgeDraft, KnowledgeImportInput } from '../shared/knowledge';

export interface KnowledgeImportIsolationOptions { workerPath?: string; timeoutMs?: number }
const defaultTimeoutMs = 8_000;

function defaultWorkerPath() {
  const directory = typeof __dirname === 'string' ? __dirname : dirname(fileURLToPath(import.meta.url));
  const bundled = join(directory, 'knowledge-import-worker.cjs');
  return existsSync(bundled) ? bundled : join(directory, 'knowledge-import-worker.ts');
}

/**
 * A `.ts` worker cannot rely on `execArgv: ['--import', 'tsx']`: tsx only registers its loader hooks
 * inside worker threads on Node versions it knows support per-thread hooks (e.g. Node 22.22.2 is skipped),
 * and Node's built-in type stripping then loads the entry without tsx's extensionless resolution.
 * Registering tsx explicitly through its API inside the worker works on every supported Node version.
 */
const typeScriptWorkerBootstrap = [
  "const { workerData } = require('node:worker_threads');",
  'require(workerData.tsxApi).register();',
  'import(workerData.entry);',
].join('\n');

function workerSource(workerPath: string): { source: string; options: WorkerOptions } {
  if (extname(workerPath) !== '.ts') return { source: workerPath, options: {} };
  const tsxApi = createRequire(workerPath).resolve('tsx/esm/api');
  return { source: typeScriptWorkerBootstrap, options: { eval: true, execArgv: [], workerData: { tsxApi, entry: pathToFileURL(workerPath).href } } };
}

/**
 * Runs untrusted document parsing off the desktop's main thread.
 * Packaged callers use the default sibling `knowledge-import-worker.cjs`.
 * Source callers may pass the `.ts` worker path explicitly when their runner does not inherit tsx.
 */
export function parseKnowledgeImportIsolated(input: KnowledgeImportInput, options: KnowledgeImportIsolationOptions = {}): Promise<{ rows: KnowledgeDraft[]; warnings: string[] }> {
  const workerPath = options.workerPath ?? defaultWorkerPath();
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) return Promise.reject(new Error('知识导入隔离超时必须在 100 至 60000 毫秒之间'));
  let source: ReturnType<typeof workerSource>;
  try { source = workerSource(workerPath); } catch (error) { return Promise.reject(new Error(`知识导入解析 worker 无法启动：${error instanceof Error ? error.message : '未知错误'}`)); }
  const worker = new Worker(source.source, { resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 }, ...source.options });
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (callback: () => void) => { if (done) return; done = true; clearTimeout(timer); callback(); };
    const timer = setTimeout(() => finish(() => { void worker.terminate(); reject(new Error(`知识导入解析超过 ${timeoutMs}ms，已终止隔离 worker`)); }), timeoutMs);
    worker.once('message', (message: { ok?: boolean; result?: { rows: KnowledgeDraft[]; warnings: string[] }; error?: string }) => finish(() => {
      void worker.terminate();
      if (message?.ok && message.result) resolve(message.result);
      else reject(new Error(message?.error || '知识导入解析 worker 返回无效结果'));
    }));
    worker.once('error', error => finish(() => reject(new Error(`知识导入解析 worker 异常：${error instanceof Error ? error.message : '未知错误'}`))));
    worker.once('exit', code => { if (!done) finish(() => reject(new Error(`知识导入解析 worker 未返回结果即退出（${code}）`))); });
    worker.postMessage(input);
  });
}
