import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, FileUp, Merge, Plus, RefreshCw, Save, Send, SkipForward, Sparkles, Trash2, Users, X } from 'lucide-react';
import { Button, PageHead } from './components';
import { OnceTip, useConfirm } from './OnceTip';
import {
  BASIC_FIELDS, BIZ_FIELDS, BROADCAST_DEFAULT_CAP, BROADCAST_DAILY_MAX, BROADCAST_MAX_MEMBERS, BROADCAST_RISK_NOTE, BROADCAST_STATUS_LABEL, CHANNEL_LABEL, COMM_FIELDS, DEFAULT_STAGES, FOLLOWUP_STATUS_LABEL,
  IMPORT_FIELDS, IMPORT_FIELD_LABEL, INTENTS, SOURCE_LABEL, UNFIT_STAGE, bizField, currentFact, customFieldKey, matchFilter, profileLines, stageOf,
  type Broadcast, type BusinessLine, type CustomerFact, type CustomerFilter, type CustomerProfile, type CustomersView, type FieldDef, type FollowUpItem, type ImportField, type ImportPreview,
} from '../shared/customers';
import './customers.css';

type Notify = (message: string, error?: boolean) => void;
type Act = (key: string, work: () => Promise<CustomersView | void | null>, done?: string) => Promise<void>;
const bridge = () => window.flowdesk?.customers;
const TABS = [['list', '客户'], ['follow', '今日跟进'], ['broadcast', '按分组发消息'], ['lines', '业务线'], ['import', '导入']] as const;
type Tab = typeof TABS[number][0];
const when = (iso?: string) => iso ? new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
const localInput = (iso?: string) => { if (!iso) return ''; const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const split = (v: string) => v.split(/[,，、|\n]/).map(s => s.trim()).filter(Boolean);

/** 客户: one profile per customer, split by business; the daily follow-up list; slow group messages. Everything stays on this computer. */
export default function CustomersPage({ notify }: { notify: Notify }) {
  const [view, setView] = useState<CustomersView>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [tab, setTab] = useState<Tab>('list');
  const [confirmDialog, ask] = useConfirm();
  const load = useCallback(() => { const b = bridge(); if (!b) return; void b.state().then(v => { setView(v); setError(''); }).catch(e => setError((e as Error).message)); }, []);
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, [load]);
  const act: Act = async (key, work, done) => {
    if (busy) return; setBusy(key);
    try { const v = await work(); if (v) setView(v); else load(); if (done && v !== null) notify(done); } catch (e) { notify((e as Error).message, true); load(); } finally { setBusy(''); }
  };
  const head = <PageHead eyebrow="客户经营" title="客户" description="每位客户一份档案：行业、需求、买过什么、聊到哪一步，按你的每条业务分开记；每天告诉你该跟进谁，写好消息等你点头再发" />;
  if (!bridge()) return <>{head}<section className="panel cu-panel"><p className="muted">客户档案需要在桌面客户端里使用。</p></section></>;
  if (!view) return <>{head}<section className="panel cu-panel"><p className="muted">{error || '正在读取…'}</p></section></>;
  const waiting = view.followUp.items.filter(i => i.status === 'pending').length;
  return <div className="cu-page">
    {head}{confirmDialog}
    <OnceTip id="customers-intro" title="咔哒会帮你记客户档案，只存在这台电脑上">接待时，咔哒把客户<strong>自己说过</strong>的情况（行业、城市、需求、预算、买过什么）记下来，每一条都标着是谁说的、原话是什么；聊到哪一步（问过价、已成交……）是咔哒的判断，会标「咔哒推测的」。性别、年龄、身体情况只有客户亲口说了才记，收入、宗教、民族这类从不记；密码、验证码、卡号也不记。档案不上传，只在这台电脑上（设了资料库备份的话，会一起备份到你选的位置）。你随时可以改、删。</OnceTip>
    <nav className="dr-tabs" role="tablist">{TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}{id === 'follow' && waiting ? `（${waiting}）` : ''}</button>)}</nav>
    {tab === 'list' && <ListTab view={view} busy={busy} act={act} ask={ask} />}
    {tab === 'follow' && <FollowTab view={view} busy={busy} act={act} ask={ask} />}
    {tab === 'broadcast' && <BroadcastTab view={view} busy={busy} act={act} ask={ask} />}
    {tab === 'lines' && <LinesTab view={view} busy={busy} act={act} />}
    {tab === 'import' && <ImportTab view={view} busy={busy} act={act} notify={notify} />}
    {view.events.length > 0 && <details className="panel cu-panel"><summary>最近动态</summary><ul className="cu-events">{view.events.map((e, i) => <li key={i}><small className="muted">{when(e.at)}</small> {e.text}</li>)}</ul></details>}
  </div>;
}
type Ask = ReturnType<typeof useConfirm>[1];

function ListTab({ view, busy, act, ask }: { view: CustomersView; busy: string; act: Act; ask: Ask }) {
  const [filter, setFilter] = useState<CustomerFilter>({});
  const [selected, setSelected] = useState<string>();
  const [segmentName, setSegmentName] = useState('');
  const [newName, setNewName] = useState('');
  const shown = useMemo(() => view.profiles.filter(p => matchFilter(p, filter, view.lines, Date.now())).sort((a, b) => (b.lastContactAt ?? b.updatedAt).localeCompare(a.lastContactAt ?? a.updatedAt)), [view, filter]);
  const stages = filter.line ? [...(view.lines.find(l => l.id === filter.line)?.stages ?? []), UNFIT_STAGE] : [...new Set([...view.lines.flatMap(l => l.stages), UNFIT_STAGE])];
  const tags = [...new Set(view.profiles.flatMap(p => p.tags))];
  const current = view.profiles.find(p => p.id === selected);
  const b = bridge()!;
  return <>
    <section className="panel cu-panel cu-capture">
      <label className="cu-switch"><input type="checkbox" checked={view.capture.enabled} disabled={!!busy} onChange={e => void act('capture', () => b.setCapture({ enabled: e.target.checked }), e.target.checked ? '接待时会自动整理客户档案' : '不再自动整理，已有的档案不动')} />接待时自动整理客户档案</label>
      <small className="muted">客户说完话安静 {view.capture.quietMinutes} 分钟（或回复发出后），咔哒用回复模型读一遍这段聊天，记下客户说的情况；每小时最多 {view.capture.hourlyCap} 次，没有新内容不调用。今天整理了 {view.capture.today} 次。{view.capture.note ? ` ${view.capture.note}` : ''}用免费模型时不自动整理，免得占用免费回复额度。群聊、管理员、家人朋友和设成「我自己回」的人不记。</small>
    </section>
    <section className="panel cu-panel cu-filters">
      <input type="search" placeholder="搜名字、行业、需求、备注…" value={filter.q ?? ''} onChange={e => setFilter({ ...filter, q: e.target.value || undefined })} />
      <select value={filter.line ?? ''} onChange={e => setFilter({ ...filter, line: e.target.value || undefined, stage: undefined })}><option value="">全部业务</option>{view.lines.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
      <select value={filter.stage ?? ''} onChange={e => setFilter({ ...filter, stage: e.target.value || undefined })}><option value="">全部阶段</option>{stages.map(s => <option key={s}>{s}</option>)}</select>
      <select value={filter.intent ?? ''} onChange={e => setFilter({ ...filter, intent: e.target.value || undefined })}><option value="">全部意向</option>{INTENTS.map(i => <option key={i} value={i}>意向{i}</option>)}</select>
      <select value={filter.tag ?? ''} onChange={e => setFilter({ ...filter, tag: e.target.value || undefined })}><option value="">全部标签</option>{tags.map(t => <option key={t}>{t}</option>)}</select>
      <label className="cu-check"><input type="checkbox" checked={!!filter.due} onChange={e => setFilter({ ...filter, due: e.target.checked || undefined })} />待跟进</label>
      {view.segments.length > 0 && <select value="" onChange={e => { const s = view.segments.find(x => x.id === e.target.value); if (s) setFilter(s.filter); }}><option value="">用分组筛选…</option>{view.segments.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
      <span className="cu-grow" />
      <input className="cu-short" placeholder="分组名" value={segmentName} onChange={e => setSegmentName(e.target.value)} />
      <Button variant="secondary" disabled={!!busy || !segmentName.trim()} onClick={() => void act('segment', () => b.saveSegment(segmentName.trim(), filter), `已存成分组「${segmentName.trim()}」`).then(() => setSegmentName(''))}><Save size={15} />存成分组</Button>
      <Button variant="secondary" disabled={!!busy} onClick={() => void act('export', async () => (await b.exportCsv(filter)) ? undefined : null, '已导出（只导出当前筛出来的客户）')}><Download size={15} />导出表格</Button>
    </section>
    <div className="cu-split">
      <section className="panel cu-panel cu-list" aria-label="客户列表">
        <div className="cu-add"><input placeholder="客户在聊天里的名字" value={newName} onChange={e => setNewName(e.target.value)} /><Button variant="ghost" disabled={!!busy || !newName.trim()} onClick={() => void act('add', () => b.add(newName.trim()), '已添加').then(() => setNewName(''))}><Plus size={15} />添加</Button></div>
        <p className="muted cu-count">{shown.length} 位{shown.length !== view.profiles.length ? `（共 ${view.profiles.length} 位）` : ''}</p>
        {!view.profiles.length && <p className="muted">还没有客户档案。开始接待后，和咔哒聊过的客户会自动出现在这里；也可以在「导入」里导入你的客户表。</p>}
        <ul>{shown.slice(0, 300).map(p => <li key={p.id}><button type="button" className={p.id === selected ? 'active' : ''} onClick={() => setSelected(p.id)}>
          <strong>{p.name}</strong>{p.channel === 'phone' && <span className="cu-chip">手机</span>}
          <span className="cu-mini">{profileLines(p, view.lines).map(l => `${l.name}·${stageOf(p, l.id) ?? '—'}`).join('  ') || (currentFact(p, 'industry')?.value ?? '')}</span>
          {p.nextFollowUp && <span className="cu-chip cu-due">{when(p.nextFollowUp.at)} 跟进</span>}
        </button></li>)}</ul>
        {shown.length > 300 && <p className="muted">只显示前 300 位，请用上面的条件筛一下。</p>}
      </section>
      {current ? <Detail key={current.id} profile={current} view={view} busy={busy} act={act} ask={ask} onGone={() => setSelected(undefined)} /> : <section className="panel cu-panel cu-detail"><p className="muted"><Users size={16} /> 点左边的客户看档案。</p></section>}
    </div>
  </>;
}

function Source({ fact }: { fact?: CustomerFact }) {
  if (!fact) return null;
  return <span className={`cu-src s-${fact.source}`} title={`${SOURCE_LABEL[fact.source]} · ${when(fact.at)}${fact.quote ? `\n原话：「${fact.quote}」` : ''}`}>{fact.source === 'inferred' ? '推测' : fact.source === 'customer' ? '客户说' : fact.source === 'owner' ? '你填' : '导入'}{fact.sensitive ? '·敏感' : ''}</span>;
}
function FactRow({ profile, field, label, hint, busy, act, options }: { profile: CustomerProfile; field: string; label: string; hint?: string; busy: string; act: Act; options?: string[] }) {
  const fact = currentFact(profile, field);
  const [value, setValue] = useState(fact?.value ?? '');
  useEffect(() => setValue(fact?.value ?? ''), [fact?.value]);
  const dirty = value.trim() !== (fact?.value ?? '');
  const save = () => void act(`fact-${field}`, () => bridge()!.setFact(profile.id, field, value.trim()), value.trim() ? '已保存' : '已清空');
  return <div className="cu-fact">
    <span className="cu-label">{label}</span>
    {options ? <select value={value} onChange={e => setValue(e.target.value)}><option value="">—</option>{[...new Set([...options, ...(value && !options.includes(value) ? [value] : [])])].map(o => <option key={o}>{o}</option>)}</select>
      : <input value={value} placeholder={hint} onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && dirty) save(); }} />}
    <Source fact={fact} />
    {dirty && <Button variant="ghost" disabled={!!busy} onClick={save}>保存</Button>}
    {fact?.quote && <small className="cu-quote">「{fact.quote}」</small>}
  </div>;
}

function Detail({ profile, view, busy, act, ask, onGone }: { profile: CustomerProfile; view: CustomersView; busy: string; act: Act; ask: Ask; onGone: () => void }) {
  const b = bridge()!;
  const [name, setName] = useState(profile.name), [aliases, setAliases] = useState(profile.aliases.join('、'));
  const [tags, setTags] = useState(profile.tags.join('、'));
  const [noteText, setNoteText] = useState('');
  const [next, setNext] = useState(localInput(profile.nextFollowUp?.at)), [reason, setReason] = useState(profile.nextFollowUp?.reason ?? '');
  const [mergeFrom, setMergeFrom] = useState('');
  const used = profileLines(profile, view.lines).map(l => l.id);
  const [openLines, setOpenLines] = useState<string[]>(used.length ? used : view.lines.slice(0, 1).map(l => l.id));
  const others = view.profiles.filter(p => p.id !== profile.id);
  const fields = (defs: FieldDef[]) => defs.map(d => <FactRow key={d.key} profile={profile} field={d.key} label={d.label} hint={d.hint} busy={busy} act={act} />);
  return <section className="panel cu-panel cu-detail" aria-label={`${profile.name} 的档案`}>
    <header className="cu-head">
      <input className="cu-name" value={name} onChange={e => setName(e.target.value)} aria-label="名字" />
      <input className="cu-aliases" value={aliases} placeholder="其他名字（改过备注、手机上的名字），用、分开" onChange={e => setAliases(e.target.value)} />
      {(name !== profile.name || aliases !== profile.aliases.join('、')) && <Button variant="secondary" disabled={!!busy} onClick={() => void act('rename', () => b.rename(profile.id, name, split(aliases)), '已保存')}>保存名字</Button>}
      <small className="muted">{CHANNEL_LABEL[profile.channel]} · 最近聊天 {when(profile.lastContactAt) || '—'}</small>
    </header>
    <h4>基本情况</h4><div className="cu-facts">{fields(BASIC_FIELDS)}</div>
    <h4>按业务</h4>
    <div className="cu-lines">{view.lines.map(l => {
      const open = openLines.includes(l.id);
      return <div key={l.id} className={`cu-line${used.includes(l.id) ? ' is-used' : ''}`}>
        <button type="button" className="cu-line-head" onClick={() => setOpenLines(open ? openLines.filter(x => x !== l.id) : [...openLines, l.id])}>{open ? '▾' : '▸'} {l.name}{stageOf(profile, l.id) ? ` · ${stageOf(profile, l.id)}` : ''}</button>
        {open && <div className="cu-facts">
          <FactRow profile={profile} field={bizField(l.id, 'stage')} label="阶段" busy={busy} act={act} options={[...l.stages, UNFIT_STAGE]} />
          <FactRow profile={profile} field={bizField(l.id, 'intent')} label="意向" busy={busy} act={act} options={[...INTENTS]} />
          {BIZ_FIELDS.filter(f => !['stage', 'intent'].includes(f.key)).map(f => <FactRow key={f.key} profile={profile} field={bizField(l.id, f.key)} label={f.label} busy={busy} act={act} />)}
          {l.fields.map(f => <FactRow key={f.id} profile={profile} field={customFieldKey(l.id, f.id)} label={f.label} busy={busy} act={act} {...(f.type === 'choice' && f.options?.length ? { options: f.options } : {})} hint={f.type === 'date' ? '例如 2026-11-01' : f.type === 'number' ? '数字' : undefined} />)}
          <Purchases profile={profile} line={l} busy={busy} act={act} />
        </div>}
      </div>;
    })}</div>
    <h4>沟通习惯</h4><div className="cu-facts">{fields(COMM_FIELDS)}</div>
    <h4>标签</h4>
    <div className="cu-row"><input value={tags} placeholder="例如：老客户、VIP、要发票，用、分开" onChange={e => setTags(e.target.value)} />{tags !== profile.tags.join('、') && <Button variant="secondary" disabled={!!busy} onClick={() => void act('tags', () => b.setTags(profile.id, split(tags)), '标签已保存')}>保存</Button>}</div>
    <h4>下次跟进</h4>
    <div className="cu-row"><input type="datetime-local" value={next} onChange={e => setNext(e.target.value)} /><input value={reason} placeholder="事由，例如：问试用感受" onChange={e => setReason(e.target.value)} />
      <Button variant="secondary" disabled={!!busy} onClick={() => void act('next', () => b.setNext(profile.id, next ? new Date(next).toISOString() : '', reason), next ? '到时候会出现在跟进清单里' : '已取消')}>{next ? '约好' : '取消约定'}</Button>
      {profile.nextFollowUp && <small className="muted">已约 {when(profile.nextFollowUp.at)}（{SOURCE_LABEL[profile.nextFollowUp.source]}）</small>}</div>
    <h4>备注</h4>
    <ul className="cu-notes">{profile.notes.slice().reverse().map(n => <li key={n.at}><span>{n.text}</span><small className="muted">{when(n.at)} · {SOURCE_LABEL[n.source]}</small><button type="button" aria-label="删除这条备注" onClick={() => void act('rm-note', () => b.removeNote(profile.id, n.at))}><X size={13} /></button></li>)}</ul>
    <div className="cu-row"><input value={noteText} placeholder="记一笔，例如：老板娘拍板，周末再联系" onChange={e => setNoteText(e.target.value)} /><Button variant="secondary" disabled={!!busy || !noteText.trim()} onClick={() => void act('note', () => b.addNote(profile.id, noteText), '已记下').then(() => setNoteText(''))}>记下</Button></div>
    <footer className="cu-actions">
      <select value={mergeFrom} onChange={e => setMergeFrom(e.target.value)}><option value="">把另一位并进来…</option>{others.slice(0, 500).map(p => <option key={p.id} value={p.id}>{p.name}{p.channel === 'phone' ? '（手机）' : ''}</option>)}</select>
      <Button variant="secondary" disabled={!!busy || !mergeFrom} onClick={() => void (async () => { const from = others.find(p => p.id === mergeFrom); if (!from || !await ask({ title: `把「${from.name}」并进「${profile.name}」？`, lines: ['两份档案的情况、备注、购买记录合成一份', `「${from.name}」会变成这位客户的「其他名字」，接待时也认得`, '合并后不能拆开'], confirmLabel: '合并' })) return; await act('merge', () => b.merge(profile.id, from.id), '已合并'); setMergeFrom(''); })()}><Merge size={15} />合并</Button>
      <span className="cu-grow" />
      <Button variant="danger" disabled={!!busy} onClick={() => void (async () => { if (!await ask({ title: `删除「${profile.name}」的档案？`, lines: ['这位客户的情况、备注、购买记录都会删掉，不能恢复', '以后再聊天，咔哒会重新开始记'], confirmLabel: '删除', danger: true, remember: 'confirm-customer-delete' })) return; await act('remove', () => b.remove(profile.id), '已删除'); onGone(); })()}><Trash2 size={15} />删除档案</Button>
    </footer>
  </section>;
}

function Purchases({ profile, line, busy, act }: { profile: CustomerProfile; line: BusinessLine; busy: string; act: Act }) {
  const b = bridge()!;
  const [product, setProduct] = useState(''), [amount, setAmount] = useState(''), [at, setAt] = useState(''), [expires, setExpires] = useState('');
  const list = profile.purchases.filter(p => p.line === line.id);
  return <div className="cu-purchases">
    <span className="cu-label">买过</span>
    <ul>{list.map(p => <li key={p.id}>{p.product}{p.amount ? ` · ${p.amount}` : ''}{p.at ? ` · ${p.at.slice(0, 10)}` : ''}{p.expiresAt ? ` · ${p.expiresAt.slice(0, 10)} 到期` : ''} <span className={`cu-src s-${p.source}`} title={p.quote ? `原话：「${p.quote}」` : SOURCE_LABEL[p.source]}>{SOURCE_LABEL[p.source]}</span><button type="button" aria-label="删除这笔" onClick={() => void act('rm-purchase', () => b.removePurchase(profile.id, p.id))}><X size={13} /></button></li>)}{!list.length && <li className="muted">还没有</li>}</ul>
    <div className="cu-row">
      <input list={`products-${line.id}`} value={product} placeholder="产品" onChange={e => setProduct(e.target.value)} /><datalist id={`products-${line.id}`}>{line.products.map(p => <option key={p.name} value={p.name} />)}</datalist>
      <input className="cu-short" value={amount} placeholder="金额" onChange={e => setAmount(e.target.value)} />
      <label className="cu-date">买的日期<input type="date" value={at} onChange={e => setAt(e.target.value)} /></label>
      <label className="cu-date">到期<input type="date" value={expires} onChange={e => setExpires(e.target.value)} /></label>
      <Button variant="ghost" disabled={!!busy || !product.trim()} onClick={() => void act('purchase', () => b.addPurchase(profile.id, { line: line.id, product, amount, at, expiresAt: expires }), '已记下这笔').then(() => { setProduct(''); setAmount(''); setAt(''); setExpires(''); })}><Plus size={14} />记一笔</Button>
    </div>
  </div>;
}

function FollowTab({ view, busy, act, ask }: { view: CustomersView; busy: string; act: Act; ask: Ask }) {
  const b = bridge()!; const s = view.followUp.settings;
  const [draft, setDraft] = useState(s); useEffect(() => setDraft(s), [s]);
  const changed = JSON.stringify(draft) !== JSON.stringify(s);
  const num = (k: 'priceDays' | 'quietDays' | 'dailyCap' | 'gapDays', label: string, max: number) => <label>{label}<input type="number" min={1} max={max} value={draft[k]} onChange={e => setDraft({ ...draft, [k]: Number(e.target.value) })} /></label>;
  const open = view.followUp.items.filter(i => !['skipped'].includes(i.status));
  return <>
    <section className={`panel cu-panel cu-next${view.followUp.pausedUntil ? ' is-warn' : ''}`}>
      <strong>{view.followUp.next}</strong>
      <small className="muted">今天已发跟进和分组消息 {view.followUp.sentToday} 条。跟进消息只在 9:30–20:30 发，每天最多 {s.dailyCap} 条，同一位客户 {s.gapDays} 天内最多一次；有客户在等回复时先回客户。要开着接待才会发。</small>
      <p className="muted cu-phone">{view.phone.content ? (view.phone.codes ? `手机上也能处理：每天 ${s.listAt} 咔哒把清单发到管理员聊天，回「发跟进 1 3」加验证器上的 6 位数就发，「改跟进 2 新的话」加 6 位数改了再发，「跳过跟进 2」不发。` : '清单会发到管理员聊天；要在手机上批准发送，先在「开放」页设置手机验证器。') : '手机上只会收到「今天有几位该跟进」的提醒，不带名字和消息：要在手机上看和批准，先在「接待」设置里给管理员备注「加上暗号」。'}</p>
      <div className="cu-row"><Button disabled={!!busy} busy={busy === 'list'} onClick={() => void act('list', () => b.makeList(), '清单整理好了')}><RefreshCw size={15} />现在整理清单</Button></div>
    </section>
    <details className="panel cu-panel"><summary>跟进规则</summary>
      <div className="cu-grid">
        <label>每天几点整理<input type="time" value={draft.listAt} onChange={e => setDraft({ ...draft, listAt: e.target.value })} /></label>
        {num('priceDays', '问过价几天没买就提醒', 60)}{num('quietDays', '意向高的几天没说话就提醒', 90)}{num('dailyCap', '每天最多发几条跟进', 50)}{num('gapDays', '同一位客户几天内只跟进一次', 60)}
      </div>
      <label className="cu-switch"><input type="checkbox" checked={draft.sendList} onChange={e => setDraft({ ...draft, sendList: e.target.checked })} />把清单发到管理员聊天</label>
      <label className="cu-switch"><input type="checkbox" checked={draft.autoDraft} onChange={e => setDraft({ ...draft, autoDraft: e.target.checked })} />整理清单时就写好每人一条（每条用一次回复模型）</label>
      <label className="cu-switch"><input type="checkbox" checked={draft.autoSend} onChange={e => void (async () => { if (e.target.checked && !await ask({ title: '让跟进消息不用你确认就发？', lines: ['咔哒写好的跟进消息会直接排队发出，你不再一条条看', '仍然只在 9:30–20:30、每天有上限、同一位客户隔几天才一次', '写得不合适的（金额、承诺不在资料里）不会发，会留给你', '建议先手动确认一段时间，觉得放心再打开'], confirmLabel: '打开', remember: 'confirm-followup-auto' })) return; setDraft(d => ({ ...d, autoSend: e.target.checked })); })()} />跟进消息自动发（默认关）</label>
      <p className="muted">到期提醒：记了到期日期的产品（课程、年卡、订阅），到期前 30 天、7 天、1 天各进一次清单。</p>
      {changed && <Button disabled={!!busy} onClick={() => void act('settings', () => b.saveFollowUpSettings(draft), '跟进规则已保存')}>保存规则</Button>}
    </details>
    <section className="cu-items" aria-label="今天的跟进">
      {!open.length && <p className="muted">今天还没有要跟进的客户。约好跟进时间、问过价没买、快到期、意向高但很久没说话的客户，会在每天 {s.listAt} 出现在这里。</p>}
      {open.map(i => <FollowCard key={i.id} item={i} busy={busy} act={act} />)}
    </section>
  </>;
}
function FollowCard({ item, busy, act }: { item: FollowUpItem; busy: string; act: Act }) {
  const b = bridge()!; const [text, setText] = useState(item.draft ?? ''); useEffect(() => setText(item.draft ?? ''), [item.draft]);
  const editable = ['pending', 'approved', 'failed'].includes(item.status);
  return <article className={`panel cu-panel cu-card s-${item.status}`}>
    <header><strong>{item.no}. {item.name}</strong><span className={`cu-status s-${item.status}`}>{FOLLOWUP_STATUS_LABEL[item.status]}</span><small className="muted">{item.why}</small></header>
    {editable ? <textarea rows={2} value={text} placeholder={item.draftNote ?? '写一句要发的话'} onChange={e => setText(e.target.value)} /> : <p className="cu-text">{item.draft}</p>}
    {item.draftNote && !item.draft && <small className="muted">{item.draftNote}</small>}
    {item.result && <small className="muted">{item.result}</small>}
    {editable && <div className="cu-row">
      {text.trim() !== (item.draft ?? '') && <Button variant="secondary" disabled={!!busy || !text.trim()} onClick={() => void act(`edit-${item.id}`, () => b.edit(item.id, text), '已改好')}>保存修改</Button>}
      {item.status !== 'approved' && <Button disabled={!!busy || !item.draft || text.trim() !== item.draft} onClick={() => void act(`ok-${item.id}`, () => b.approve(item.id), '已同意，会排队发出')}><Send size={15} />发送</Button>}
      <Button variant="ghost" disabled={!!busy} busy={busy === `re-${item.id}`} onClick={() => void act(`re-${item.id}`, () => b.redraft(item.id), '重写好了')}><Sparkles size={15} />重写</Button>
      <Button variant="ghost" disabled={!!busy} onClick={() => void act(`skip-${item.id}`, () => b.skip(item.id), '这位今天不发了')}><SkipForward size={15} />跳过</Button>
    </div>}
  </article>;
}

function BroadcastTab({ view, busy, act, ask }: { view: CustomersView; busy: string; act: Act; ask: Ask }) {
  const b = bridge()!;
  const [segment, setSegment] = useState(view.segments[0]?.id ?? ''), [brief, setBrief] = useState(''), [cap, setCap] = useState(BROADCAST_DEFAULT_CAP);
  const members = view.segments.find(s => s.id === segment) ? view.profiles.filter(p => matchFilter(p, view.segments.find(s => s.id === segment)!.filter, view.lines, Date.now())).length : 0;
  return <>
    <section className="panel cu-panel">
      <h3>给一个分组的客户各写一条</h3>
      <p className="notice warning cu-risk">{BROADCAST_RISK_NOTE}</p>
      {!view.segments.length ? <p className="muted">先在「客户」里筛出一批客户，点「存成分组」。</p> : <>
        <div className="cu-grid">
          <label>发给哪个分组<select value={segment} onChange={e => setSegment(e.target.value)}>{view.segments.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select><small className="muted">{members} 位（一次最多 {BROADCAST_MAX_MEMBERS} 位）</small></label>
          <label>每天最多发几条<input type="number" min={1} max={BROADCAST_DAILY_MAX} value={cap} onChange={e => setCap(Number(e.target.value))} /></label>
        </div>
        <label className="cu-block">这次要跟客户说什么<textarea rows={3} maxLength={500} value={brief} placeholder="例如：11 月课程开新班，老学员报名优惠 200 元，名额 20 个" onChange={e => setBrief(e.target.value)} /></label>
        <Button disabled={!!busy || !brief.trim() || !segment} busy={busy === 'broadcast'} onClick={() => void act('broadcast', () => b.createBroadcast({ segment, brief, dailyCap: cap }), '每人一条写好了，请逐条看一遍')}><Sparkles size={15} />写好每人一条</Button>
        <small className="muted">每位客户用一次回复模型；写好后先给你看，你确认了才会发。</small>
      </>}
      <div className="cu-row"><small className="muted">已存的分组：</small>{view.segments.map(s => <span key={s.id} className="cu-chip">{s.name}<button type="button" aria-label={`删除分组 ${s.name}`} onClick={() => void act('rm-seg', () => b.removeSegment(s.id), '分组已删除')}><X size={12} /></button></span>)}</div>
    </section>
    {view.broadcasts.slice().reverse().map(x => <BroadcastCard key={x.id} b={x} busy={busy} act={act} ask={ask} />)}
  </>;
}
function BroadcastCard({ b, busy, act, ask }: { b: Broadcast; busy: string; act: Act; ask: Ask }) {
  const api = bridge()!; const going = b.items.filter(i => i.status === 'pending' && i.draft).length;
  return <section className={`panel cu-panel cu-broadcast s-${b.status}`}>
    <header className="cu-row"><strong>{b.name}</strong><span className={`cu-status s-${b.status}`}>{BROADCAST_STATUS_LABEL[b.status]}</span><small className="muted">{when(b.createdAt)} · 每天最多 {b.dailyCap} 条{b.nextAt && b.status === 'sending' ? ` · 下一条约 ${when(b.nextAt)}` : ''}</small></header>
    <p className="muted">要说的事：{b.brief}</p>
    {b.stopReason && <p className="notice warning">{b.stopReason}</p>}
    <ul className="cu-bitems">{b.items.map(i => <BroadcastLine key={i.profileId} b={b} item={i} busy={busy} act={act} />)}</ul>
    <div className="cu-row">
      {b.status === 'review' && <Button disabled={!!busy || !going} onClick={() => void (async () => { if (!await ask({ title: `开始慢慢发这 ${going} 条？`, lines: [BROADCAST_RISK_NOTE, `每条间隔 3–8 分钟，只在 9:30–20:30，每天最多 ${b.dailyCap} 条，发完要好几个小时甚至几天`, '要开着接待才会发；有客户在等时先回客户', '出现「操作频繁」之类的提示或有一条没确认发出，就全部停下'], confirmLabel: '开始发', remember: 'confirm-broadcast-send' })) return; await act('start', () => api.startBroadcast(b.id), '开始慢慢发了'); })()}><Send size={15} />开始慢慢发（{going} 条）</Button>}
      {b.status === 'sending' && <Button variant="secondary" disabled={!!busy} onClick={() => void act('stop', () => api.stopBroadcast(b.id), '已停下')}>停下</Button>}
      {b.status !== 'sending' && <Button variant="ghost" disabled={!!busy} onClick={() => void act('rm', () => api.removeBroadcast(b.id), '已删除')}><Trash2 size={15} />删除这批</Button>}
    </div>
  </section>;
}
function BroadcastLine({ b, item, busy, act }: { b: Broadcast; item: Broadcast['items'][number]; busy: string; act: Act }) {
  const api = bridge()!; const [text, setText] = useState(item.draft ?? ''); useEffect(() => setText(item.draft ?? ''), [item.draft]);
  const review = b.status === 'review';
  return <li className={`s-${item.status}`}>
    <strong>{item.name}</strong> <small className="muted">{item.status === 'removed' ? '不发' : item.status === 'sent' ? '已发出' : item.status === 'failed' ? `没发成${item.result ? `：${item.result}` : ''}` : item.status === 'queued' ? '正在发' : ''}{item.note ? ` · ${item.note}` : ''}</small>
    {review ? <textarea rows={2} value={text} onChange={e => setText(e.target.value)} /> : <p className="cu-text">{item.draft}</p>}
    {review && <div className="cu-row">
      {text.trim() !== (item.draft ?? '') && <Button variant="secondary" disabled={!!busy || !text.trim()} onClick={() => void act('bedit', () => api.editBroadcastItem(b.id, item.profileId, text))}>保存</Button>}
      <Button variant="ghost" disabled={!!busy} onClick={() => void act('bremove', () => api.removeBroadcastItem(b.id, item.profileId, item.status !== 'removed'))}>{item.status === 'removed' ? '还是发' : '这位不发'}</Button>
    </div>}
  </li>;
}

function LinesTab({ view, busy, act }: { view: CustomersView; busy: string; act: Act }) {
  const b = bridge()!;
  const [lines, setLines] = useState<BusinessLine[]>(view.lines); useEffect(() => setLines(view.lines), [view.lines]);
  const changed = JSON.stringify(lines) !== JSON.stringify(view.lines);
  const set = (i: number, patch: Partial<BusinessLine>) => setLines(ls => ls.map((l, n) => n === i ? { ...l, ...patch } : l));
  return <section className="panel cu-panel cu-lines-edit">
    <p className="muted">你有几条业务（例如软件、课程培训、企业服务），就建几条。每位客户在每条业务里分开记阶段、需求和买过什么。删掉一条业务，客户档案里的内容不会删，只是不再单独显示。</p>
    {lines.map((l, i) => <div key={l.id || `new-${i}`} className="cu-line-edit">
      <div className="cu-row"><input value={l.name} placeholder="业务名" onChange={e => set(i, { name: e.target.value })} /><input value={(l.aliases ?? []).join('、')} placeholder="其他叫法（英文名等）" onChange={e => set(i, { aliases: split(e.target.value) })} /><Button variant="ghost" onClick={() => setLines(lines.filter((_, n) => n !== i))}><Trash2 size={14} />删掉</Button></div>
      <label className="cu-block">阶段（按顺序，用、分开；「不合适」总是有）<input value={l.stages.join('、')} onChange={e => set(i, { stages: split(e.target.value) })} /></label>
      <div className="cu-sub"><span className="cu-label">产品</span>{l.products.map((p, k) => <div key={k} className="cu-row"><input value={p.name} placeholder="产品名" onChange={e => set(i, { products: l.products.map((x, m) => m === k ? { ...x, name: e.target.value } : x) })} /><input className="cu-short" value={p.price ?? ''} placeholder="价格（可不填）" onChange={e => set(i, { products: l.products.map((x, m) => m === k ? { ...x, price: e.target.value || undefined } : x) })} /><input className="cu-short" type="number" min={0} value={p.renewDays ?? ''} placeholder="有效天数" title="课程、年卡、订阅有效多少天；填了会自动算到期日" onChange={e => set(i, { products: l.products.map((x, m) => m === k ? { ...x, renewDays: Number(e.target.value) || undefined } : x) })} /><Button variant="ghost" onClick={() => set(i, { products: l.products.filter((_, m) => m !== k) })}><X size={13} /></Button></div>)}<Button variant="ghost" onClick={() => set(i, { products: [...l.products, { name: '' }] })}><Plus size={13} />加一个产品</Button></div>
      <div className="cu-sub"><span className="cu-label">自己加的栏目</span>{l.fields.map((f, k) => <div key={f.id || k} className="cu-row"><input value={f.label} placeholder="栏目名，例如：门店数" onChange={e => set(i, { fields: l.fields.map((x, m) => m === k ? { ...x, label: e.target.value } : x) })} /><select value={f.type} onChange={e => set(i, { fields: l.fields.map((x, m) => m === k ? { ...x, type: e.target.value as typeof f.type } : x) })}><option value="text">文字</option><option value="number">数字</option><option value="date">日期</option><option value="choice">选项</option></select>{f.type === 'choice' && <input value={(f.options ?? []).join('、')} placeholder="选项，用、分开" onChange={e => set(i, { fields: l.fields.map((x, m) => m === k ? { ...x, options: split(e.target.value) } : x) })} />}<Button variant="ghost" onClick={() => set(i, { fields: l.fields.filter((_, m) => m !== k) })}><X size={13} /></Button></div>)}<Button variant="ghost" onClick={() => set(i, { fields: [...l.fields, { id: '', label: '', type: 'text' }] })}><Plus size={13} />加一个栏目</Button></div>
    </div>)}
    <div className="cu-row">
      <Button variant="secondary" disabled={lines.length >= 20} onClick={() => setLines([...lines, { id: '', name: '', products: [], stages: [...DEFAULT_STAGES], fields: [] }])}><Plus size={15} />加一条业务</Button>
      <Button variant="ghost" disabled={!!busy || changed} onClick={() => void act('seed', () => b.seedLines(), '从知识里找到了新的业务')}><Sparkles size={15} />从知识里找业务</Button>
      {changed && <Button disabled={!!busy} onClick={() => void act('lines', () => b.saveLines(lines.map(l => ({ ...l, products: l.products.filter(p => p.name.trim()), fields: l.fields.filter(f => f.label.trim()) }))), '业务线已保存')}><Save size={15} />保存</Button>}
    </div>
  </section>;
}

function ImportTab({ view, busy, act, notify }: { view: CustomersView; busy: string; act: Act; notify: Notify }) {
  const b = bridge()!;
  const [preview, setPreview] = useState<ImportPreview | null>(null); const [mapping, setMapping] = useState<ImportField[]>([]); const [line, setLine] = useState(view.lines[0]?.id ?? '');
  const pick = () => void act('pick', async () => { const p = await b.importPick(); if (p) { setPreview(p); setMapping(p.mapping); } return null; });
  return <section className="panel cu-panel cu-import">
    <p className="muted">把你已有的客户表、订单表（Excel 或 CSV）导进来：名字或电话一样的会合并到同一份档案，买过的产品和到期日期也会记上，快到期时提醒你续费。文件只在这台电脑上读。</p>
    <Button disabled={!!busy} busy={busy === 'pick'} onClick={pick}><FileUp size={15} />选一个表格</Button>
    {preview && <>
      <p><strong>{preview.file}</strong> · {preview.total} 行。请核对每一列对应什么（认不出的列默认不导入）：</p>
      <div className="cu-table-wrap"><table className="cu-table"><thead><tr>{preview.headers.map((h, i) => <th key={i}><div>{h || `第 ${i + 1} 列`}</div><select value={mapping[i] ?? 'skip'} onChange={e => setMapping(m => { const next = [...m]; next[i] = e.target.value as ImportField; return next; })}><option value="skip">{IMPORT_FIELD_LABEL.skip}</option>{IMPORT_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}</select></th>)}</tr></thead>
        <tbody>{preview.rows.slice(0, 8).map((r, i) => <tr key={i}>{preview.headers.map((_, c) => <td key={c}>{r[c] ?? ''}</td>)}</tr>)}</tbody></table></div>
      <label className="cu-block">没写业务线的购买记到<select value={line} onChange={e => setLine(e.target.value)}>{view.lines.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
      <div className="cu-row"><Button disabled={!!busy || (!mapping.includes('name') && !mapping.includes('phone'))} onClick={() => void act('commit', async () => { const r = await b.importCommit(preview.token, mapping, line); notify(r.result); setPreview(null); return r.view; })}>导入</Button><Button variant="ghost" onClick={() => setPreview(null)}>取消</Button></div>
    </>}
  </section>;
}
