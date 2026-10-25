import { useEffect, useState } from 'react';
import { Button, PageHead } from './components';
import { openMcpClientSnippets } from '../shared/open-mcp-clients';
import type { OpenMcpBridgeState } from '../shared/types';
import OpenAppTasks from './OpenAppTasks';
import OpenClients from './OpenClients';
import Tutorial from './Tutorial';
import { useConfirm } from './OnceTip';
// The 开放 cards reuse the reception page's panel styles; load them even when 接待 was never opened.
import './open-page.css';
const TOOLS: Array<[string, string]> = [
  ['knowledge_search', '按客户问题检索已审核知识（只读）'],
  ['knowledge_answer', '用咔哒的知识和话术生成一条回复草稿（扣额度，不发送；每小时最多 30 次）'],
  ['reception_status', '工作台状态与统计（只读）'],
  ['reception_control', '查看工作台运行状态（只读）'],
  ['knowledge_add', '新增一条待审核知识（审核后才启用）'],
  ['settings_get', '读取全部设置、话术和模型（只读；密钥只显示是否已保存）'],
  ['models_get', '读取模型设置（只读；密钥只显示是否已保存）'],
  ['knowledge_list', '分页列出知识和审核状态（只读）'],
  ['settings_update', '修改工作台配置、人设语气、话术（需「可以修改设置」）'],
  ['models_set', '修改模型配置和密钥（需「可以修改设置」，密钥只写入）'],
  ['models_test', '测试模型连接（需「可以修改设置」）'],
  ['knowledge_review', '审核通过或驳回待审核知识（需「可以修改设置」，通过需你确认）'],
  ['knowledge_update', '修改知识，内容变化后回到待审核（需「可以修改设置」）'],
  ['knowledge_delete', '删除知识（需「可以修改设置」，需你确认）'],
  ['knowledge_import', '导入一段资料文本，全部进待审核（需「可以修改设置」）'],
];
const SETTINGS_TOOLS = new Set(['settings_get', 'models_get', 'knowledge_list', 'settings_update', 'models_set', 'models_test', 'knowledge_review', 'knowledge_update', 'knowledge_delete', 'knowledge_import']);
type Audit = { at: string; caller: string; tool: string; summary: string; outcome: 'ok' | 'refused' | 'failed' };
// The bridge type predates the settings scope; the main process already returns these fields.
type OpenState = Omit<OpenMcpBridgeState, 'clients'> & { settingsTools?: boolean; audit?: Audit[]; clients: Array<OpenMcpBridgeState['clients'][number] & { configWrite?: boolean; skipConfirm?: boolean }> };
type SaveInput = Parameters<NonNullable<typeof window.flowdesk>['open']['save']>[0] & { clientScope?: { id: string; configWrite?: boolean; skipConfirm?: boolean } };
const OUTCOME: Record<Audit['outcome'], string> = { ok: '已执行', refused: '被拒绝', failed: '失败' };

/** 开放：kadadesk as an MCP server for other AI tools (Claude, Cursor, Claude Code…). Loopback only, bearer token. */
export default function OpenPage({ notify }: { notify: (message: string, error?: boolean) => void }) {
  const bridge = window.flowdesk?.open;
  const [state, setState] = useState<OpenState>();
  const [port, setPort] = useState('');
  const [busy, setBusy] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [pick, setPick] = useState('claude-code');
  const [clientPick, setClientPick] = useState('');
  const [confirmDialog, ask] = useConfirm();
  const refresh = () => bridge?.state().then(s => { setState(s); setPort(String(s.port)); }).catch(() => {});
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 4000); return () => window.clearInterval(timer); }, []);
  if (!bridge) return <PageHead title="开放" description="此功能需要桌面客户端。" />;
  const save = async (input: SaveInput, done = '已保存') => { setBusy(true); try { setState(await bridge.save(input)); notify(done); } catch (e) { notify((e as Error).message, true); } finally { setBusy(false); } };
  const scope = (id: string, change: { configWrite?: boolean; skipConfirm?: boolean }, done: string) => void (async () => {
    // Giving an AI tool more power is asked once more, in plain words; taking it back never is.
    const label = state?.clients?.find(c => c.id === id)?.label ?? '这个工具';
    if (change.configWrite && !await ask({ title: `允许「${label}」修改设置？`, lines: ['它能改工作台设置、话术、模型和知识', '每次修改都要你在咔哒里点确认，改过的都记在下面', '随时可以取消勾选收回'], confirmLabel: '允许修改' })) return;
    if (change.skipConfirm && !await ask({ title: `「${label}」改设置不再问你？`, lines: ['它改工作台设置时，咔哒不再弹窗问你', '只给你自己在用、信得过的工具打开', '改过的仍记在下面的修改记录里'], confirmLabel: '不再逐次确认', danger: true })) return;
    await save({ clientScope: { id, ...change } }, done);
  })();
  const copy = (text: string, what: string) => void navigator.clipboard.writeText(text).then(() => notify(`${what}已复制`)).catch(() => notify('复制失败', true));
  const token = state?.token ?? '';
  const url = state?.url ?? '';
  const picked = state?.clients.find(client => client.id === clientPick);
  // The page never holds client keys: with the bridge every snippet is keyless; without it, the key is copied by the main process.
  const snippets = openMcpClientSnippets({ url, token, stdio: state?.stdio, ...(picked ? { client: { id: picked.id } } : {}) });
  const chosen = snippets.find(x => x.id === pick) ?? snippets[0];
  // Choosing a client also opens its tool's snippet when the client was added for a known tool (id hermes, hermes-2…).
  const selectClient = (id: string) => { setClientPick(id); const tool = snippets.find(x => id === x.id || id.startsWith(`${x.id}-`)); if (tool) setPick(tool.id); };
  const labels = Object.fromEntries((state?.clients ?? []).map(client => [client.id, client.label]));
  return <>
    <PageHead title="开放" description="把咔哒的知识库开放给其他 AI 工具（Claude、Codex、Cursor、Antigravity、WorkBuddy 等）调用。标准 MCP 协议，只监听本机，不对外网。" />
    <Tutorial id="open-mcp" />{confirmDialog}
    <section className="panel dr-panel">
      <div className="dr-section-head"><div><h2>MCP 服务</h2><p>{state ? (state.listening ? `运行中 · ${url} · 已调用 ${state.calls} 次${state.lastCallAt ? ' · 最近 ' + new Date(state.lastCallAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''}` : state.enabled ? `未能启动${state.error ? '：' + state.error : ''}` : '已关闭') : '读取中…'}</p></div></div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><input type="checkbox" disabled={busy || !state} checked={state?.enabled ?? false} onChange={e => void save({ enabled: e.target.checked })} />开启 MCP 服务</label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>端口<input type="number" min={1025} max={65535} style={{ width: 90 }} disabled={busy || !state} value={port} onChange={e => setPort(e.target.value)} onBlur={() => { const n = Number(port); if (state && n !== state.port) void save({ port: n }); }} /></label>
        <Button variant="secondary" disabled={busy || !state} onClick={() => void save({ regenerateToken: true })}>重新生成密钥</Button>
      </div>
      <p className="muted" style={{ marginTop: 10 }}>密钥：<code>{showToken ? token : token.replace(/.(?=.{4})/g, '•')}</code> <Button variant="ghost" onClick={() => setShowToken(v => !v)}>{showToken ? '隐藏' : '显示'}</Button> <Button variant="ghost" onClick={() => copy(token, '密钥')}>复制</Button>{state ? ` · 默认密钥调用 ${state.defaultCalls} 次${state.defaultLastCallAt ? '，最近 ' + new Date(state.defaultLastCallAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}` : ''}</p>
    </section>
    <OpenClients state={state} disabled={busy || !state} onChange={setState} onSelect={selectClient} notify={notify} />
    <section className="panel dr-panel">
      <div className="dr-section-head"><div><h2>接入方式</h2><p>选你用的工具，复制配置贴进去即可；密钥等同密码，不要发给别人。经本机桥连接的配置不含密钥。要让某个工具提交应用任务，先在上面「客户端」里添加它并勾选权限，再在这里选它复制配置。</p></div></div>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>使用
        <select id="open-snippet-client" value={clientPick} onChange={e => selectClient(e.target.value)}><option value="">默认密钥</option>{(state?.clients ?? []).map(client => <option key={client.id} value={client.id}>{client.label}（{client.id}）</option>)}</select>
      </label>
      <div className="dr-filter" style={{ flexWrap: 'wrap', marginBottom: 10 }}>{snippets.map(x => <button key={x.id} type="button" className={pick === x.id ? 'active' : ''} onClick={() => setPick(x.id)}>{x.name}</button>)}</div>
      <p className="muted">{chosen.note}</p>
      <pre className="open-snippet">{chosen.text}</pre>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button variant="secondary" onClick={() => copy(chosen.text, '配置')}>复制{chosen.kind === 'shell' ? '命令' : '配置'}</Button>
        {picked && !state?.stdio ? <Button variant="ghost" onClick={() => void bridge.copyClientKey(picked.id).then(() => notify(`已复制「${picked.label}」的密钥，粘贴到配置里的占位处`)).catch(e => notify((e as Error).message, true))}>复制「{picked.label}」的密钥</Button> : null}
      </div>
    </section>
    <section className="panel dr-panel">
      <div className="dr-section-head"><div><h2>开放的工具</h2><p>取消勾选的工具不会出现在 AI 工具里。工具不能指定发送对象或内容；只有你允许「可以修改设置」的客户端才能开始接待（需你确认）。解除暂停后，正在运行的接待按咔哒保存的配置自动回复；新增和导入的知识只进入待审核队列。</p></div></div>
      <table className="open-tools"><tbody>{TOOLS.filter(([name]) => state?.settingsTools || !SETTINGS_TOOLS.has(name)).map(([name, desc]) => {
        const disabled = state?.disabledTools.includes(name) ?? false;
        const toggle = () => { const current = state?.disabledTools ?? []; void save({ disabledTools: disabled ? current.filter(item => item !== name) : [...current, name] }); };
        return <tr key={name}><td><label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><input id={`open-tool-${name}`} type="checkbox" disabled={busy || !state} checked={!disabled} onChange={toggle} /><code>{name}</code></label></td><td>{desc}</td></tr>;
      })}</tbody></table>
    </section>
    {state?.settingsTools ? <section className="panel dr-panel">
      <div className="dr-section-head"><div><h2>修改设置</h2><p>所有工具都能读取咔哒的设置（密钥只显示是否已保存）。勾选「可以修改设置」的客户端还能改接待配置、话术、模型和知识，并开始或停止接待；默认密钥永远不能修改。换模型或密钥、删除或启用知识、放宽审核、改管理员或固定话术、开始接待，都会先在这台电脑上请你确认，除非你勾选了「允许不经确认修改设置」。任何工具都不能读取密钥、直接给客户发消息、绕过审核或改动授权。</p></div></div>
      {state.clients.length ? <table className="open-tools"><tbody>{state.clients.map(client => <tr key={client.id}>
        <td><strong>{client.label}</strong><div className="muted"><code>{client.id}</code></div></td>
        <td style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><input id={`open-client-config-${client.id}`} type="checkbox" disabled={busy} checked={client.configWrite === true} onChange={e => scope(client.id, { configWrite: e.target.checked }, e.target.checked ? `已允许「${client.label}」修改设置` : `已收回「${client.label}」的修改设置权限`)} />可以修改设置</label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><input id={`open-client-noconfirm-${client.id}`} type="checkbox" disabled={busy || client.configWrite !== true} checked={client.configWrite === true && client.skipConfirm === true} onChange={e => scope(client.id, { skipConfirm: e.target.checked }, e.target.checked ? `「${client.label}」修改设置不再逐次确认` : `「${client.label}」修改设置需要你逐次确认`)} />允许不经确认修改设置</label>
        </td>
      </tr>)}</tbody></table> : <p className="muted">先在上面「客户端」里给 AI 工具添加一个客户端，才能授予修改设置权限。</p>}
      <h3 style={{ margin: '14px 0 6px' }}>修改记录（最近 50 条）</h3>
      {(state.audit ?? []).length ? <table className="open-tools"><tbody>{(state.audit ?? []).map((item, index) => <tr key={`${item.at}-${index}`}>
        <td style={{ whiteSpace: 'nowrap' }}>{new Date(item.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}<div className="muted">{item.caller}</div></td>
        <td><code>{item.tool}</code> · {OUTCOME[item.outcome] ?? item.outcome}<div className="muted">{item.summary}</div></td>
      </tr>)}</tbody></table> : <p className="muted">还没有工具修改过设置。</p>}
    </section> : null}
    <OpenAppTasks enabled={state?.appTasks ?? false} disabled={busy || !state} labels={labels} onToggle={value => void save({ appTasks: value })} notify={notify} />
  </>;
}
