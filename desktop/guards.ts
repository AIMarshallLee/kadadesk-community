import type { ApiRequest } from '../shared/types.ts';

const API_PATHS: Record<ApiRequest['method'], readonly string[]> = {
  GET: ['/model/live', '/tips', '/leads', '/knowledge/pack', '/knowledge/drives', '/knowledge/sources', '/knowledge/repos', '/knowledge/connections', '/knowledge/training', '/health', '/state', '/export', '/playbooks/presets', '/license/status'],
  POST: ['/model/live', '/help/ask', '/knowledge/pack', '/knowledge/drives/list', '/knowledge/drives/sources', '/knowledge/drives/code', '/knowledge/drives/cancel', '/knowledge/sources', '/knowledge/sources/sync', '/knowledge/sources/stop', '/knowledge/repos', '/knowledge/repos/folders', '/knowledge/repos/sync', '/knowledge/repos/stop', '/knowledge/repos/auto', '/knowledge/connections/preview', '/knowledge/training/answer', '/knowledge/training/review', '/import', '/knowledge', '/workflows', '/tasks', '/provider/test', '/learning/collect', '/knowledge/import/preview', '/knowledge/import/expand', '/knowledge/import/organize', '/knowledge/import/commit', '/knowledge/review', '/knowledge/search', '/knowledge/evaluate', '/playbooks/install', '/playbooks/extract', '/copilot/reply', '/psychology/candidates', '/leads/qualify'],
  PUT: ['/knowledge/drives', '/knowledge/settings', '/onboarding', '/tips', '/knowledge/connections', '/settings', '/learning/settings'],
  DELETE: ['/knowledge/drives', '/knowledge/sources', '/knowledge/connections', '/knowledge/', '/workflows/', '/provider/key']
};

export function isAllowedRequest(value: unknown): value is ApiRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as ApiRequest;
  if (!Object.hasOwn(API_PATHS, request.method) || typeof request.path !== 'string' || !request.path.startsWith('/')) return false;
  if (request.method === 'POST' && /^\/learning\/[^/]+\/(approve|reject)$/.test(request.path)) return true;
  if (request.method === 'POST' && /^\/tasks\/[^/]+\/(generate|approve|complete|archive|restore)$/.test(request.path)) return true;
  if (request.method === 'PUT' && /^\/(knowledge|workflows|tasks)\/[^/]+$/.test(request.path)) return true;
  return API_PATHS[request.method].some((path) => path.endsWith('/') ? request.path.startsWith(path) : request.path === path);
}

export function isAllowedRendererUrl(url: string, rendererUrl: string): boolean {
  try {
    const actual = new URL(url);
    const expected = new URL(rendererUrl);
    return ['file:', 'flowdesk:'].includes(actual.protocol) && actual.protocol === expected.protocol
      && actual.host === expected.host && actual.pathname === expected.pathname && !actual.username && !actual.password && !actual.search;
  } catch {
    return false;
  }
}
