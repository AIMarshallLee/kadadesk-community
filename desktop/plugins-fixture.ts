import assert from 'node:assert/strict';
import type { McpClient } from './mcp-client';
import type { ApiRequest } from '../shared/types';

/** In-memory stand-in for the local workspace service: the endpoints plugins use, nothing else. */
export function fakeWorkspace() {
  const knowledge: Array<{ id: string; title: string; content: string; question?: string; tags: string[]; enabled: boolean; reviewStatus: 'pending' | 'approved' }> = [];
  const workflows: Array<{ id: string; name: string; instructions: string; enabled: boolean }> = [];
  const calls: ApiRequest[] = []; let n = 0; const previews = new Map<string, Array<{ rowId: string; title: string; content: string; question: string }>>();
  const request = async (req: ApiRequest): Promise<unknown> => {
    calls.push(req); const body = (req.body ?? {}) as any;
    if (req.method === 'GET' && req.path === '/state') return structuredClone({ knowledge, workflows });
    if (req.method === 'POST' && req.path === '/knowledge/import/preview') {
      const rows = (JSON.parse(Buffer.from(body.files[0].base64, 'base64').toString('utf8')) as Array<Record<string, string>>).map((r, i) => ({ rowId: `row${i}`, title: r['标题']!, content: r['答案']!, question: r['问题']!, errors: [] as string[], ...(knowledge.some(k => k.question === r['问题']) ? { duplicateOf: 'x' } : {}) }));
      const previewId = `p${++n}`; previews.set(previewId, rows); return { previewId, rows };
    }
    if (req.method === 'POST' && req.path === '/knowledge/import/commit') {
      assert.equal(body.confirm, true);
      const created = body.rows.map((r: any) => { const k = { id: `k${++n}`, title: r.title, content: r.content, question: r.question, tags: r.tags, enabled: false, reviewStatus: 'pending' as const }; knowledge.push(k); return k; });
      return { created, skipped: 0 };
    }
    if (req.method === 'POST' && req.path === '/knowledge') { const k = { id: `k${++n}`, title: body.title, content: body.content, question: body.question, tags: body.tags, enabled: false, reviewStatus: 'pending' as const }; knowledge.push(k); return k; }
    if (req.method === 'POST' && req.path === '/workflows') { const w = { id: `w${++n}`, name: body.name, instructions: body.instructions, enabled: body.enabled !== false }; workflows.push(w); return w; }
    const del = req.path.match(/^\/(knowledge|workflows)\/(.+)$/);
    if (req.method === 'DELETE' && del) { const list = del[1] === 'knowledge' ? knowledge : workflows; const i = list.findIndex(x => x.id === decodeURIComponent(del[2]!)); if (i >= 0) list.splice(i, 1); return { ok: true }; }
    throw new Error(`unexpected ${req.method} ${req.path}`);
  };
  return { knowledge, workflows, calls, request };
}

/** A scripted MCP client: records calls, answers from `answers`, and can be told to fail. */
export function fakeClient(tools: Array<{ name: string; inputSchema?: unknown }>, answer: (name: string, args: Record<string, unknown>) => string | Promise<string> = (name, a) => `${name}:${JSON.stringify(a)}`) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const state = { fail: false, created: 0 };
  const factory = (): McpClient => { state.created++; return {
    listTools: async () => { if (state.fail) throw new Error('连不上'); return tools; },
    callTool: async (name, args) => { calls.push({ name, args }); if (state.fail) throw new Error('工具坏了'); return { text: await answer(name, args), isError: false }; },
    close: () => {},
  }; };
  return { calls, state, factory };
}

export const ORDER_TOOLS = [
  { name: 'lookup_order', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'create_booking', inputSchema: { type: 'object', properties: { date: { type: 'string' }, name: { type: 'string' } }, required: ['date', 'name'] } },
  { name: 'cancel_order', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
];
export const toolManifest = (extra: object = {}) => JSON.stringify({ id: 'order-tool', name: '订单查询', version: '1.0.0', author: '测试', description: '查订单', kind: 'tool', permissions: ['tools.read', 'tools.write'], server: { transport: 'stdio', command: 'fake-mcp' }, ...extra });
