
const recordDiag = (_scope: string, _detail?: any) => {};
export const pluginHooks: Record<string, any> = {
  augmentContext: async (_ctx?: any, _q?: any, _sig?: any) => ({}),
  receptionEvent: async (_ev?: any) => {}
};
import { app, ipcMain } from 'electron';
import { showNotice } from './notice-center';
import { createPluginManager, type PluginManagerDeps } from './plugins';
import type { ApiRequest } from '../shared/types';

/**
 * 插件中心 IPC (`flowdesk:plugins:*`) and the two reception hooks. Registered once from main.ts after reception
 * exists; until then (or if loading fails) reception runs exactly as without plugins.
 */
export async function registerPlugins(options: {
  trusted(event: Electron.IpcMainInvokeEvent): void;
  directory: string;
  request(req: ApiRequest): Promise<unknown>;
  journal?: PluginManagerDeps['journal'];
  alertAdmin?: PluginManagerDeps['alertAdmin'];
}) {
  const notified = new Map<string, number>();
  const manager = await createPluginManager({
    directory: options.directory, request: options.request, journal: options.journal, alertAdmin: options.alertAdmin,
    // Same rule as reception alerts: one system notification per title and text within a minute.
    notify: (title, body) => { const key = title + body, t = Date.now(); if (t - (notified.get(key) ?? 0) < 60000) return; notified.set(key, t); if (notified.size > 200) notified.clear(); showNotice({ key: 'plugins', title, body, open: true, cooldownMs: 0 }); },
    log: (event, detail) => recordDiag(event, detail),
  });
  pluginHooks.augmentContext = (context: any, query: any, signal: any) => manager.augmentContext(context, query, signal);
  pluginHooks.receptionEvent = (event: any) => { void manager.onReceptionEvent(event).catch(() => {}); };
  const handle = (name: string, action: (...args: any[]) => unknown) => ipcMain.handle(`flowdesk:plugins:${name}`, (event, ...args) => { options.trusted(event); return action(...args); });
  handle('state', () => manager.view());
  handle('preview', (text: unknown) => manager.preview(text));
  handle('install', (text: unknown, consent: unknown) => manager.install(text, consent));
  handle('set-enabled', (id: unknown, enabled: unknown) => manager.setEnabled(id, enabled));
  handle('uninstall', (id: unknown) => manager.uninstall(id));
  handle('undo', () => manager.undo());
  handle('refresh-tools', (id: unknown) => manager.refreshTools(id));
  handle('set-tool', (id: unknown, tool: unknown, input: unknown) => manager.setTool(id, tool, input));
  handle('save-rules', (id: unknown, rules: unknown) => manager.saveRules(id, rules));
  handle('create-automation', (name: unknown) => manager.createAutomation(name));
  handle('answer-approval', (id: unknown, approve: unknown) => manager.answerApproval(id, approve));
  handle('evolution', () => manager.evolution());
  handle('adopt', (id: unknown) => manager.adopt(id));
  handle('dismiss', (id: unknown) => manager.dismiss(id));
  const clock = setInterval(() => { void manager.tick().catch(() => {}); }, 60000); clock.unref?.();
  // 每周进化建议: checked a few minutes after start and then hourly; runs at most once in 7 days.
  const weekly = () => { void manager.maybeWeekly().catch(() => {}); };
  const first = setTimeout(weekly, 5 * 60000); first.unref?.();
  const hourly = setInterval(weekly, 3600000); hourly.unref?.();
  app.once('will-quit', () => { clearInterval(clock); clearInterval(hourly); clearTimeout(first); manager.dispose(); });
  return manager;
}
