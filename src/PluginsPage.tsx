import { useCallback, useEffect, useRef, useState } from 'react';
import { Blocks, FileUp, ClipboardPaste, Undo2, ShieldCheck, Wrench, Zap, BookOpen, Sparkles, Plus, Trash2, RefreshCw, Check, X } from 'lucide-react';
import { PageHead, Button } from './components';
import { navigate } from './api';
import {
  ACTION_LABELS, KIND_LABELS, PERMISSION_LABELS, TRIGGER_LABELS, singleStringParam,
  type AutomationAction, type AutomationRule, type PluginPreview, type PluginsView, type PluginView, type EvolutionSuggestion,
} from '../shared/plugins';
import type { ReplyPersona } from '../shared/desktop-replies';
import Tutorial from './Tutorial';
import './plugins.css';

type Notify = (message: string, error?: boolean) => void;
const bridge = () => window.flowdesk?.plugins;
const TONE: Record<NonNullable<ReplyPersona['tone']>, string> = { professional: '专业', friendly: '亲切', brief: '简短' };
const SAFETY = [
  '装插件前，咔哒会用大白话列出它要的权限，你点「同意并安装」才会装。',
  '内容包（话术、知识、回复风格）只会放进「待审核」或停用的工作流，你审核启用后才会用。',
  '插件不能直接回复客户。回复照旧走咔哒的接待流程：审核模式、安全检查、发送时机都不变。',
  '工具默认算「会写入，每次问我」；只有你标成「只读，可自动用」的工具，才会在客户提到你设的关键词时自动查一次，查到的内容只当参考资料，并标明来自插件、不可信。',
  '插件连续出错 3 次会自动停用，并提醒你一次。每一步改动都能「撤销上一步」。',
  '进化建议只看这台电脑上的接待记录，不会把聊天内容发到任何地方。',
];

/** 插件中心: install from a file or pasted text, permissions in plain words, tools, automation rules and 进化建议. */
export default function PluginsPage({ notify }: { notify: Notify }) {
  const [view, setView] = useState<PluginsView>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(() => { const b = bridge(); if (!b) return; void b.state().then(v => { setView(v); setError(''); }).catch(e => setError((e as Error).message)); }, []);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);
  const act = async (work: () => Promise<PluginsView | undefined>, done?: string) => {
    if (busy) return; setBusy(true);
    try { const v = await work(); if (v) setView(v); if (done) notify(done); } catch (e) { notify((e as Error).message, true); } finally { setBusy(false); }
  };
  const head = <PageHead eyebrow="插件中心" title="插件" description="一切皆插件：装上话术包、知识包、工具和自动化，咔哒工作台就能做更多事。原来的功能都不变。"
    actions={view?.undo ? <Button variant="secondary" disabled={busy} title={`撤销：${view.undo.label}`} onClick={() => void act(() => bridge()!.undo(), `已撤销：${view.undo!.label}`)}><Undo2 size={15} />撤销上一步</Button> : undefined} />;
  if (!bridge()) return <>{head}<section className="panel pl-panel"><p className="muted">插件需要在桌面客户端里使用。</p></section></>;
  if (!view) return <>{head}<section className="panel pl-panel"><p className="muted">{error || '正在读取插件…'}</p></section></>;
  return <div className="pl-page">
    {head}
    <Tutorial id="plugins" />
    <details className="panel pl-panel pl-safety"><summary><ShieldCheck size={16} />安全规则（为什么装插件不会乱来）</summary><ul>{SAFETY.map(s => <li key={s}>{s}</li>)}</ul></details>
    {view.approvals.length > 0 && <section className="panel pl-panel pl-approvals" aria-label="等你同意">
      <h3>等你同意</h3>
      {view.approvals.map(a => <div key={a.id} className="pl-row">
        <div><strong>「{a.pluginName}」想用会写入的工具「{a.tool}」</strong><small className="muted">{a.reason} · 内容：{a.input || '（无）'}</small></div>
        <div className="pl-actions"><Button disabled={busy} onClick={() => void act(async () => { const r = await bridge()!.answerApproval(a.id, true); if (r.result) notify(`已执行，工具返回：${r.result.slice(0, 80)}`); return r.view; })}><Check size={15} />同意执行一次</Button><Button variant="ghost" disabled={busy} onClick={() => void act(async () => (await bridge()!.answerApproval(a.id, false)).view, '已拒绝')}><X size={15} />拒绝</Button></div>
      </div>)}
    </section>}
    <Installer busy={busy} act={act} notify={notify} />
    <section className="pl-list" aria-label="已装的插件">
      <h3 className="pl-heading"><Blocks size={16} />已装的插件（{view.plugins.length}）</h3>
      {!view.plugins.length && <p className="muted">还没有装插件。可以先「新建一个自动化」，比如客户提到退款就提醒你。</p>}
      {view.plugins.map(p => <PluginCard key={p.manifest.id} plugin={p} plugins={view.plugins} busy={busy} act={act} notify={notify} />)}
    </section>
    <EvolutionCard view={view} busy={busy} act={act} />
  </div>;
}

function Installer({ busy, act, notify }: { busy: boolean; act: (w: () => Promise<PluginsView | undefined>, done?: string) => Promise<void>; notify: Notify }) {
  const [text, setText] = useState(''), [paste, setPaste] = useState(false), [preview, setPreview] = useState<PluginPreview>(), [source, setSource] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const check = async (raw: string) => { try { setPreview(await bridge()!.preview(raw)); setSource(raw); } catch (e) { setPreview(undefined); notify((e as Error).message, true); } };
  const readFile = (f?: File) => {
    if (!f) return;
    if (f.size > 5_000_000) return notify('插件文件太大（最多 5MB）', true);
    const reader = new FileReader();
    reader.onload = () => void check(String(reader.result ?? ''));
    reader.onerror = () => notify('读不了这个文件', true);
    reader.readAsText(f, 'utf-8');
  };
  return <section className="panel pl-panel" aria-label="装插件">
    <h3><FileUp size={16} />装插件 / 导入扩展包</h3>
    <p className="muted">支持导入本地插件包（.plugin 或 .json 文件）。可以直接拖拽文件到下方区域，也可以粘贴内容。</p>
    <div
      className={`pl-dropzone${dragOver ? ' is-active' : ''}`}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => {
        e.preventDefault();
        setDragOver(false);
        readFile(e.dataTransfer.files?.[0]);
      }}
      onClick={() => file.current?.click()}
    >
      <FileUp size={24} className="pl-dropzone-icon" />
      <p><strong>点击或拖拽插件扩展包（.plugin / .json）到这里导入</strong></p>
      <small className="muted">支持外部通信渠道插件、专属话术包、工具与工作流扩展</small>
    </div>
    <div className="pl-actions">
      <Button variant="secondary" disabled={busy} onClick={() => file.current?.click()}><FileUp size={15} />选择插件文件</Button>
      <Button variant="secondary" disabled={busy} onClick={() => setPaste(v => !v)}><ClipboardPaste size={15} />粘贴插件内容</Button>
      <Button variant="ghost" disabled={busy} onClick={() => void act(() => bridge()!.createAutomation('我的自动化'), '已新建，改好规则后点「保存规则」')}><Plus size={15} />新建一个自动化</Button>
      <input ref={file} type="file" accept=".plugin,.json,application/json" aria-label="选择插件文件" style={{ display: 'none' }} onChange={e => { readFile(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
    {paste && <div className="pl-paste"><textarea rows={6} value={text} maxLength={2_000_000} placeholder='{"id": "my-plugin", "name": "…", "kind": "content", …}' aria-label="插件内容" onChange={e => setText(e.target.value)} /><Button disabled={busy || !text.trim()} onClick={() => void check(text)}>检查插件</Button></div>}
    {preview && <div className="pl-consent" role="dialog" aria-label="确认安装">
      <strong>{preview.manifest.name} <small className="muted">v{preview.manifest.version} · {preview.manifest.author} · {KIND_LABELS[preview.manifest.kind]}</small></strong>
      <p>{preview.manifest.description}</p>
      {preview.replaces && <p className="notice">已经装过 v{preview.replaces}，安装会替换成这个版本。</p>}
      <p><b>它要这些权限：</b></p>
      <ul>{preview.permissions.map(p => <li key={p.id}>{p.label}</li>)}{!preview.permissions.length && <li>不需要任何权限</li>}</ul>
      {preview.warnings.map(w => <p key={w} className="notice">{w}</p>)}
      <div className="pl-actions"><Button disabled={busy} onClick={() => void act(async () => { const v = await bridge()!.install(source, true); setPreview(undefined); setText(''); setPaste(false); return v; }, `已安装「${preview.manifest.name}」`)}>同意并安装</Button><Button variant="ghost" disabled={busy} onClick={() => setPreview(undefined)}>取消</Button></div>
    </div>}
  </section>;
}

function PluginCard({ plugin: p, plugins, busy, act, notify }: { plugin: PluginView; plugins: PluginView[]; busy: boolean; act: (w: () => Promise<PluginsView | undefined>, done?: string) => Promise<void>; notify: Notify }) {
  const m = p.manifest, Icon = m.kind === 'tool' ? Wrench : m.kind === 'automation' ? Zap : BookOpen;
  const tone = m.content?.style?.tone;
  const applyTone = async () => {
    try { const r = window.flowdesk?.desktopReplies as any; if (!r || !tone) return; const s = await r.state(); if (s.status === 'running') return notify('请先暂停接待，再换语气。', true); await r.saveConfig?.({ ...s.config, persona: { ...(s.config?.persona ?? {}), tone } }); notify(`回复语气已改成「${TONE[tone]}」，可以在「接待 → 人设与语气」再改。`); } catch (e) { notify((e as Error).message, true); }
  };
  return <article className={`panel pl-card${p.enabled ? '' : ' is-off'}`}>
    <header><span className="pl-icon"><Icon size={17} /></span><div><strong>{m.name}</strong><small className="muted">{KIND_LABELS[m.kind]} · v{m.version} · {m.author}{p.local ? ' · 你自己建的' : ''}</small></div>
      <label className="pl-switch"><input type="checkbox" checked={p.enabled} disabled={busy} onChange={e => void act(() => bridge()!.setEnabled(m.id, e.target.checked), e.target.checked ? '已启用' : '已停用')} />{p.enabled ? '已启用' : '已停用'}</label>
      <Button variant="ghost" disabled={busy} aria-label={`卸载 ${m.name}`} onClick={() => { if (window.confirm(`卸载「${m.name}」？之后也能点「撤销上一步」找回。`)) void act(() => bridge()!.uninstall(m.id), '已卸载'); }}><Trash2 size={15} /></Button></header>
    <p className="muted">{m.description}</p>
    {p.lastError && <p className="notice pl-error">上次出错：{p.lastError}{p.failures >= 3 && !p.enabled ? '（已自动停用）' : ''}</p>}
    <details><summary>权限（{m.permissions.length}）</summary><ul>{m.permissions.map(x => <li key={x}>{PERMISSION_LABELS[x]}</li>)}</ul></details>
    {m.kind === 'content' && <div className="pl-content">
      <p>{p.created.knowledge ? `已放进待审核：${p.created.knowledge} 条。` : ''}{p.created.workflows ? `回复风格「${m.content?.style?.name}」已加成停用的工作流。` : ''}审核启用后咔哒才会用。</p>
      <div className="pl-actions"><Button variant="secondary" onClick={() => navigate('knowledge/import')}>去审核</Button>{p.created.workflows > 0 && <Button variant="ghost" onClick={() => navigate('workflows')}>看工作流</Button>}{tone && <Button variant="ghost" disabled={busy} onClick={() => void applyTone()}>用这个语气（{TONE[tone]}）</Button>}</div>
    </div>}
    {m.kind === 'tool' && <ToolList plugin={p} busy={busy} act={act} />}
    {m.kind === 'automation' && <RuleEditor plugin={p} plugins={plugins} busy={busy} act={act} />}
  </article>;
}

function ToolList({ plugin: p, busy, act }: { plugin: PluginView; busy: boolean; act: (w: () => Promise<PluginsView | undefined>, done?: string) => Promise<void> }) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const canRead = p.manifest.permissions.includes('tools.read');
  return <div className="pl-tools">
    <div className="pl-actions"><span className="muted">{p.manifest.server?.transport === 'http' ? `连接：${p.manifest.server.url}` : `命令：${p.manifest.server?.transport === 'stdio' ? p.manifest.server.command : ''}`}</span><Button variant="secondary" disabled={busy || !p.enabled} onClick={() => void act(() => bridge()!.refreshTools(p.manifest.id), '已刷新工具列表')}><RefreshCw size={15} />刷新工具</Button></div>
    {!p.tools.length && <p className="muted">还没有列出工具。启用插件后点「刷新工具」。</p>}
    {p.tools.map(t => { const single = !!singleStringParam(t.inputSchema); const words = draft[t.name] ?? t.triggers.join('、'); return <div key={t.name} className="pl-tool">
      <div><strong>{t.name}</strong><small className="muted">{t.description || '（没有说明）'}</small></div>
      <select value={t.mode} disabled={busy} aria-label={`${t.name} 的用法`} onChange={e => void act(() => bridge()!.setTool(p.manifest.id, t.name, { mode: e.target.value as 'read' | 'write', triggers: t.triggers }), '已保存')}>
        <option value="write">会写入，每次问我</option><option value="read" disabled={!canRead}>只读，可自动用</option></select>
      {t.mode === 'read' && <div className="pl-trigger">
        <input value={words} placeholder="触发词，用顿号隔开，如：订单、物流" aria-label={`${t.name} 的触发词`} disabled={busy} onChange={e => setDraft(d => ({ ...d, [t.name]: e.target.value }))} />
        <Button variant="secondary" disabled={busy} onClick={() => void act(() => bridge()!.setTool(p.manifest.id, t.name, { mode: 'read', triggers: words.split(/[、,，\s]+/).map(w => w.trim()).filter(Boolean) }), '触发词已保存')}>保存</Button>
        {!single && <small className="muted">这个工具不是只收一段文字，回复客户时不会自动用它。</small>}
      </div>}
    </div>; })}
  </div>;
}

const blankAction = (type: AutomationAction['type'], plugins: PluginView[]): AutomationAction => type === 'tool' ? { type, plugin: plugins.find(p => p.manifest.kind === 'tool')?.manifest.id ?? '', tool: '' } : type === 'csv' ? { type } : { type };
function RuleEditor({ plugin: p, plugins, busy, act }: { plugin: PluginView; plugins: PluginView[]; busy: boolean; act: (w: () => Promise<PluginsView | undefined>, done?: string) => Promise<void> }) {
  const [rules, setRules] = useState<AutomationRule[]>(() => structuredClone(p.manifest.rules ?? []));
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) setRules(structuredClone(p.manifest.rules ?? [])); }, [p.manifest.rules, dirty]);
  const edit = (i: number, next: AutomationRule) => { setRules(r => r.map((x, j) => j === i ? next : x)); setDirty(true); };
  const toolPlugins = plugins.filter(x => x.manifest.kind === 'tool');
  return <div className="pl-rules">
    {rules.map((r, i) => <div key={r.id} className="pl-rule">
      <div className="pl-rule-head"><input value={r.name ?? ''} placeholder="规则名字" aria-label="规则名字" maxLength={60} onChange={e => edit(i, { ...r, name: e.target.value })} />
        <label><input type="checkbox" checked={r.enabled !== false} onChange={e => edit(i, { ...r, enabled: e.target.checked })} />开着</label>
        <Button variant="ghost" aria-label="删除这条规则" disabled={rules.length <= 1} onClick={() => { setRules(x => x.filter((_, j) => j !== i)); setDirty(true); }}><Trash2 size={14} /></Button></div>
      <div className="pl-when"><b>当</b><select value={r.when.type} aria-label="触发条件" onChange={e => { const type = e.target.value as AutomationRule['when']['type']; edit(i, { ...r, when: type === 'keyword' ? { type, keywords: ['退款'] } : type === 'daily' ? { type, time: '09:00' } : { type } }); }}>
        {(Object.keys(TRIGGER_LABELS) as Array<AutomationRule['when']['type']>).map(k => <option key={k} value={k}>{TRIGGER_LABELS[k]}</option>)}</select>
        {r.when.type === 'keyword' && <input value={r.when.keywords.join('、')} aria-label="关键词" placeholder="关键词，用顿号隔开" onChange={e => edit(i, { ...r, when: { type: 'keyword', keywords: e.target.value.split(/[、,，]+/).map(w => w.trim()).filter(Boolean) } })} />}
        {r.when.type === 'daily' && <input type="time" value={r.when.time} aria-label="时间" onChange={e => edit(i, { ...r, when: { type: 'daily', time: e.target.value } })} />}
      </div>
      {r.then.map((a, k) => <div key={k} className="pl-then"><b>就</b>
        <select value={a.type} aria-label="动作" onChange={e => edit(i, { ...r, then: r.then.map((x, n) => n === k ? blankAction(e.target.value as AutomationAction['type'], plugins) : x) })}>
          {(Object.keys(ACTION_LABELS) as Array<AutomationAction['type']>).map(t => <option key={t} value={t} disabled={t === 'tool' && !toolPlugins.length}>{ACTION_LABELS[t]}</option>)}</select>
        {(a.type === 'notify' || a.type === 'admin') && <input value={a.text ?? ''} maxLength={300} aria-label="提醒文字" placeholder="提醒文字（可留空；可用 {客户} {消息} {关键词}）" onChange={e => edit(i, { ...r, then: r.then.map((x, n) => n === k ? { type: a.type, ...(e.target.value ? { text: e.target.value } : {}) } : x) })} />}
        {a.type === 'tool' && <>
          <select value={a.plugin} aria-label="工具插件" onChange={e => edit(i, { ...r, then: r.then.map((x, n) => n === k ? { type: 'tool', plugin: e.target.value, tool: '' } : x) })}>{toolPlugins.map(t => <option key={t.manifest.id} value={t.manifest.id}>{t.manifest.name}</option>)}</select>
          <select value={a.tool} aria-label="工具" onChange={e => edit(i, { ...r, then: r.then.map((x, n) => n === k ? { ...a, tool: e.target.value } : x) })}><option value="">选工具</option>{toolPlugins.find(t => t.manifest.id === a.plugin)?.tools.map(t => <option key={t.name} value={t.name}>{t.name}{t.mode === 'write' ? '（每次问我）' : ''}</option>)}</select>
        </>}
        {a.type === 'csv' && <small className="muted">记到这台电脑的表格：{p.dataFile ?? '保存后显示位置'}</small>}
        <Button variant="ghost" aria-label="删除这个动作" disabled={r.then.length <= 1} onClick={() => edit(i, { ...r, then: r.then.filter((_, n) => n !== k) })}><X size={14} /></Button>
      </div>)}
      {r.then.length < 5 && <Button variant="ghost" onClick={() => edit(i, { ...r, then: [...r.then, { type: 'notify' }] })}><Plus size={14} />再加一个动作</Button>}
    </div>)}
    <div className="pl-actions">
      <Button variant="secondary" disabled={rules.length >= 50} onClick={() => { let n = rules.length + 1; while (rules.some(r => r.id === `r${n}`)) n++; setRules(r => [...r, { id: `r${n}`, name: '', when: { type: 'first-message' }, then: [{ type: 'notify' }] }]); setDirty(true); }}><Plus size={15} />加一条规则</Button>
      <Button disabled={busy || !dirty} onClick={() => void act(async () => { const v = await bridge()!.saveRules(p.manifest.id, rules.map(r => ({ ...r, name: r.name?.trim() || undefined }))); setDirty(false); return v; }, '规则已保存')}>保存规则</Button>
      {dirty && <Button variant="ghost" onClick={() => { setRules(structuredClone(p.manifest.rules ?? [])); setDirty(false); }}>放弃修改</Button>}
    </div>
    {p.dataFile && <p className="muted pl-data">本地表格：{p.dataFile}</p>}
  </div>;
}

const KIND_ACTION: Record<EvolutionSuggestion['kind'], string> = { gap: '加到知识库（待审核）', phrase: '把这种说法设为默认', automation: '开一个提醒' };
/** 进化建议: shown on the 插件 page and the 数据 page; each one is one click to adopt and can be undone. */
export function EvolutionCard({ view: given, busy: givenBusy, act: givenAct }: { view?: PluginsView; busy?: boolean; act?: (w: () => Promise<PluginsView | undefined>, done?: string) => Promise<void> }) {
  const [own, setOwn] = useState<PluginsView>(), [ownBusy, setOwnBusy] = useState(false), [note, setNote] = useState('');
  useEffect(() => { if (given || !bridge()) return; void bridge()!.state().then(setOwn).catch(() => {}); }, [given]);
  const view = given ?? own, busy = givenBusy ?? ownBusy;
  const act = givenAct ?? (async (work: () => Promise<PluginsView | undefined>, done?: string) => { setOwnBusy(true); try { const v = await work(); if (v) setOwn(v); setNote(done ?? ''); } catch (e) { setNote((e as Error).message); } finally { setOwnBusy(false); } });
  if (!bridge() || !view) return null;
  const list = view.evolution.suggestions;
  return <section className="panel pl-panel pl-evolution" aria-label="进化建议">
    <h3><Sparkles size={16} />每周进化建议 <small className="muted">{view.evolution.lastRunAt ? `上次：${new Date(view.evolution.lastRunAt).toLocaleString('zh-CN', { hour12: false })}` : '每周自动看一次'}</small></h3>
    <p className="muted">只看这台电脑上的接待记录：哪些问题答不上、你改过哪些说法、哪些词常转人工。每条点「采纳」就行，不满意可以「撤销上一步」。</p>
    {!list.length && <p className="muted">暂时没有建议。</p>}
    {list.map(s => <div key={s.id} className="pl-row">
      <div><strong>{s.title}</strong><small className="muted">{s.detail}</small>{s.kind === 'phrase' && s.draft && <small className="muted">原来：{s.draft.slice(0, 80)}</small>}</div>
      <div className="pl-actions"><Button disabled={busy} title={KIND_ACTION[s.kind]} onClick={() => void act(() => bridge()!.adopt(s.id), `已采纳：${KIND_ACTION[s.kind]}`)}>采纳</Button><Button variant="ghost" disabled={busy} onClick={() => void act(() => bridge()!.dismiss(s.id), '已忽略')}>忽略</Button></div>
    </div>)}
    <div className="pl-actions"><Button variant="secondary" disabled={busy} onClick={() => void act(() => bridge()!.evolution(), '建议已更新')}><RefreshCw size={15} />现在看一次</Button>{!given && <Button variant="ghost" onClick={() => navigate('plugins')}>去插件页</Button>}{note && <span className="muted">{note}</span>}</div>
  </section>;
}
