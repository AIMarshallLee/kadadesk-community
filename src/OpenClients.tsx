import { useEffect, useState } from 'react';
import { Button } from './components';
import type { OpenMcpBridgeState } from '../shared/types';

const TOOLS: Array<[string, string]> = [['hermes', 'Hermes'], ['codex', 'Codex'], ['claude-code', 'Claude Code'], ['cursor', 'Cursor'], ['antigravity', 'Antigravity'], ['workbuddy', 'WorkBuddy'], ['gemini-cli', 'Gemini CLI'], ['vscode', 'VS Code'], ['claude-desktop', 'Claude Desktop'], ['other', '其他工具']];
const when = (at?: string) => at ? new Date(at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

/** 客户端 on the 开放 page: one key per AI tool, so calls can be told apart and one tool can be cut off alone.
 *  App operation is granted per client (Touch ID where available); the default key never gets it. */
export default function OpenClients({ state, disabled, onChange, onSelect, notify }: { state?: OpenMcpBridgeState; disabled: boolean; onChange: (next: OpenMcpBridgeState) => void; onSelect: (id: string) => void; notify: (message: string, error?: boolean) => void }) {
  const bridge = window.flowdesk?.open;
  const [tool, setTool] = useState('hermes');
  const [label, setLabel] = useState('');
  const [acting, setActing] = useState('');
  // Two-step delete: the confirm button appears elsewhere in the row, ignores clicks for a moment (a double-click on
  // 删除 must not confirm), and disarms itself after a few seconds.
  const [removing, setRemoving] = useState<{ id: string; at: number }>();
  useEffect(() => { if (!removing) return; const timer = window.setTimeout(() => setRemoving(undefined), 6000); return () => window.clearTimeout(timer); }, [removing]);
  if (!bridge || !state) return null;
  const act = async (id: string, action: () => Promise<OpenMcpBridgeState>, done: string, after?: (next: OpenMcpBridgeState) => void) => {
    setActing(id);
    try { const next = await action(); onChange(next); after?.(next); notify(done); } catch (e) { notify((e as Error).message, true); } finally { setActing(''); setRemoving(undefined); }
  };
  const add = () => {
    // Without a typed name, use the tool's name, numbered when another client already has it (names must be unique).
    const base = TOOLS.find(([id]) => id === tool)?.[1] ?? tool;
    const taken = (name: string) => state.clients.some(client => client.label.toLowerCase() === name.toLowerCase());
    let name = label.trim();
    for (let n = 1; !name || (!label.trim() && taken(name)); n++) name = n === 1 ? base : `${base} ${n}`;
    void act('add', () => bridge.addClient({ label: name, tool }), `已添加「${name}」，下面的接入配置已切换到它`, next => { onSelect(next.clients.at(-1)?.id ?? ''); setLabel(''); });
  };
  const busy = disabled || acting !== '';
  return <section className="panel dr-panel">
    <div className="dr-section-head"><div><h2>客户端</h2><p>给每个 AI 工具单独一把密钥：能看出是谁在调用，也能只停掉其中一个。原来的默认密钥照常可用，但不能提交应用任务。</p></div></div>
    {state.clients.length ? <table className="open-tools"><tbody>{state.clients.map(client => <tr key={client.id}>
      <td><strong>{client.label}</strong><div className="muted"><code>{client.id}</code> · 密钥末四位 {client.keyHint} · 调用 {client.calls} 次 · 最近 {when(client.lastCallAt)}</div></td>
      <td>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><input id={`open-client-app-${client.id}`} type="checkbox" disabled={busy} checked={client.appTasks} onChange={e => { const allowed = e.target.checked; void act(client.id, () => bridge.setClientAppTasks(client.id, allowed), allowed ? `已允许「${client.label}」提交应用任务` : `已收回「${client.label}」的应用操作权限，它的任务已撤销`); }} />可以提交应用任务</label>
        <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
          <Button variant="secondary" disabled={busy} onClick={() => onSelect(client.id)}>看接入配置</Button>
          <Button variant="ghost" disabled={busy} onClick={() => void act(client.id, () => bridge.regenerateClientKey(client.id), `已更换「${client.label}」的密钥；经本机桥的工具会自动跟随，直连的工具要重新复制密钥`)}>换密钥</Button>
          <Button variant="ghost" disabled={busy} onClick={() => void bridge.copyClientKey(client.id).then(() => notify(`已复制「${client.label}」的密钥（只给不能用本机桥的工具用）`)).catch(e => notify((e as Error).message, true))}>复制密钥</Button>
          {removing?.id === client.id
            ? <>
              <Button variant="secondary" disabled={busy} onClick={() => setRemoving(undefined)}>取消</Button>
              <Button variant="danger" disabled={busy} onClick={() => { if (Date.now() - removing.at < 600) return; void act(client.id, () => bridge.removeClient(client.id), `已删除「${client.label}」`, () => onSelect('')); }}>确认删除（配置立即失效）</Button>
            </>
            : <Button variant="ghost" disabled={busy} onClick={() => setRemoving({ id: client.id, at: Date.now() })}>删除</Button>}
        </div>
      </td>
    </tr>)}</tbody></table> : <p className="muted">还没有单独的客户端。</p>}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 10 }}>
      <select id="open-client-tool" aria-label="AI 工具" value={tool} disabled={busy} onChange={e => setTool(e.target.value)}>{TOOLS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
      <input id="open-client-label" aria-label="客户端名称" placeholder="名称（可不填）" maxLength={30} value={label} disabled={busy} onChange={e => setLabel(e.target.value)} />
      <Button disabled={busy} onClick={add}>添加客户端</Button>
    </div>
  </section>;
}
