import DisplayModeSettings from './DisplayModeSettings';
import NoticeSettings from './NoticeSettings';
import ShortcutSettings from './ShortcutSettings';
import ThemeSettings from './ThemeSettings';
import IconSettings from './IconSettings';
import DiagnosticsButton from './Diagnostics';

import { useState, useEffect } from 'react';
import { BookOpen, Plus, Search, Pencil, Trash2, Workflow as WorkflowIcon, Check, Download, Upload, ShieldCheck, KeyRound, Server, Eye, EyeOff, Activity, FileText, ArrowUpRight, Save, FolderLock, CircleCheck, AlertCircle, RotateCcw, Sparkles } from 'lucide-react';
import type { AppState, Knowledge, Workflow } from '../shared/types';
import type { PageProps } from './App';
import { Button, Empty, Field, Modal, PageHead, formatTime, scenarios } from './components';
import { api, downloadJson, navigate } from './api';
import LearningPanel from './Learning';
import { KnowledgePage as KnowledgeWorkbenchPage } from './KnowledgePage';
import LegalLinks from './LegalLinks';

export const KnowledgePage = KnowledgeWorkbenchPage;

export function WorkflowPage({ state, perform, busy }: PageProps) {
  const [edit, setEdit] = useState<Workflow | 'new'>();
  const [remove, setRemove] = useState<Workflow>();
  return (
    <>
      <PageHead
        title="工作流程"
        description="把你的工作方式写下来，让每份草稿保持一致的标准。"
        actions={<Button onClick={() => setEdit('new')}><Plus size={17} />新建流程</Button>}
      />
      <div className="workflow-grid">
        {state.workflows.map((item, i) => (
          <article className="workflow-card" key={item.id}>
            <div className="card-top">
              <span className={`workflow-icon color-${i % 3}`}><WorkflowIcon size={22} /></span>
              <button
                className={`switch ${item.enabled ? 'on' : ''}`}
                role="switch"
                aria-checked={item.enabled}
                aria-label={`${item.enabled ? '停用' : '启用'} ${item.name}`}
                disabled={busy}
                onClick={() => void perform('PUT', `/workflows/${item.id}`, { enabled: !item.enabled })}
              >
                <span />
              </button>
            </div>
            <span className="workflow-scenario">{scenarios[item.scenario]}</span>
            <h2>{item.name}</h2>
            <p>{item.description || '按你的规则整理上下文，起草可审核的回复。'}</p>
            <div className="workflow-steps">
              <span><Eye size={13} />读取内容</span><i />
              <span><BookOpen size={13} />应用规则</span><i />
              <span><ShieldCheck size={13} />人工审核</span>
            </div>
            <div className="card-bottom">
              <button className="text-link" onClick={() => setEdit(item)}>编辑工作流程<ArrowUpRight size={15} /></button>
              <button className="icon-button" aria-label={`删除 ${item.name}`} onClick={() => setRemove(item)}><Trash2 size={16} /></button>
            </div>
          </article>
        ))}
        <button className="new-workflow-card" onClick={() => setEdit('new')}>
          <span><Plus size={25} /></span>
          <strong>创建你的专属流程</strong>
          <small>把反复使用的工作方法沉淀下来</small>
        </button>
      </div>
      <div className="notice workflow-note">
        <ShieldCheck size={17} />
        <span>工作流程用于指导草稿生成。它不会触发后台定时任务或自动发送消息。</span>
      </div>
      {edit && (
        <WorkflowEditor
          item={edit === 'new' ? undefined : edit}
          busy={busy}
          onClose={() => setEdit(undefined)}
          onSave={async body => {
            if (await perform(edit === 'new' ? 'POST' : 'PUT', edit === 'new' ? '/workflows' : `/workflows/${edit.id}`, body, '工作流程已保存')) {
              setEdit(undefined);
            }
          }}
        />
      )}
      {remove && (
        <Modal title="删除这个工作流程？" subtitle={`将移除「${remove.name}」，历史任务仍然保留。`} onClose={() => setRemove(undefined)}>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setRemove(undefined)}>取消</Button>
            <Button variant="danger" busy={busy} onClick={async () => {
              if (await perform('DELETE', `/workflows/${remove.id}`, undefined, '工作流程已删除')) setRemove(undefined);
            }}>确认删除</Button>
          </div>
        </Modal>
      )}
    </>
  );
}

function WorkflowEditor({ item, busy, onClose, onSave }: { item?: Workflow; busy: boolean; onClose: () => void; onSave: (body: unknown) => Promise<void> }) {
  const [form, setForm] = useState({
    name: item?.name || '',
    scenario: item?.scenario || 'service',
    description: item?.description || '',
    instructions: item?.instructions || '',
    greeting: item?.greeting || '',
    enabled: item?.enabled ?? true
  });
  return (
    <Modal title={item ? '编辑工作流程' : '创建工作流程'} subtitle="明确工作目标、回复语气和不能做出的承诺。" onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); void onSave(form); }}>
        <div className="form-row">
          <Field label="流程名称">
            <input required maxLength={200} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="例如：售前咨询接待" />
          </Field>
          <Field label="业务场景">
            <select value={form.scenario} onChange={e => setForm({ ...form, scenario: e.target.value as Workflow['scenario'] })}>
              {Object.entries(scenarios).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
        </div>
        <Field label="一句话说明">
          <input maxLength={500} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="这个流程帮你完成什么？" />
        </Field>
        <Field label="工作指令">
          <textarea required rows={7} maxLength={20000} value={form.instructions} onChange={e => setForm({ ...form, instructions: e.target.value })} placeholder="例如：先确认客户需求，再依据知识库回复；缺少信息时主动提问；不编造价格与交付时间。" />
        </Field>
        <Field label="常用开场白（可选）">
          <input maxLength={500} value={form.greeting} onChange={e => setForm({ ...form, greeting: e.target.value })} placeholder="你好，感谢你的咨询。" />
        </Field>
        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={onClose}>取消</Button>
          <Button type="submit" busy={busy}>保存流程</Button>
        </div>
      </form>
    </Modal>
  );
}

const actionNames: Record<string, string> = {
  seeded: '初始化示例', attachment_draft_created: '保存附件回复草稿', task_created: '创建任务',
  task_updated: '编辑任务', task_generated: '生成回复', task_approved: '审核草稿',
  task_completed: '交接草稿', task_archived: '归档任务', task_restored: '恢复任务',
  settings_updated: '更新设置', knowledge_created: '添加知识', knowledge_updated: '更新知识',
  knowledge_deleted: '删除知识', knowledge_imported: '导入知识候选', knowledge_reviewed: '审核并启用知识',
  workflows_created: '创建流程', workflows_updated: '更新流程', workflows_deleted: '删除流程',
  learning_settings: '更新学习候选设置', learning_collected: '收集学习候选', learning_approved: '审核并启用学习候选',
  learning_rejected: '拒绝学习候选', imported: '恢复备份', playbook_installed: '安装演示话术模板',
  playbook_extracted: '整理本地聊天记录', lead_recorded: '沉淀私域线索', lead_qualified: '意向智能识别'
};

export function AuditPage({ state }: PageProps) {
  const [filter, setFilter] = useState('all');
  const events = state.events.filter(event => filter === 'all' || (filter === 'tasks' ? event.action.startsWith('task_') : !event.action.startsWith('task_')));
  return (
    <>
      <PageHead
        title="活动记录"
        description="记录起草、审核与交接，让工作过程可以回看。"
        actions={<Button variant="secondary" onClick={() => downloadJson({ exportedAt: new Date().toISOString(), events }, '咔哒-活动记录.json')}><Download size={16} />导出记录</Button>}
      />
      <section className="panel">
        <div className="list-toolbar">
          <div className="tabs">
            {[['all', '全部活动'], ['tasks', '任务活动'], ['workspace', '工作空间']].map(([key, name]) => (
              <button key={key} className={filter === key ? 'selected' : ''} onClick={() => setFilter(key)}>{name}</button>
            ))}
          </div>
          <span className="muted">{events.length} 条记录</span>
        </div>
        {events.length ? (
          <div className="timeline">
            {events.map(event => (
              <article key={event.id}>
                <span className="timeline-icon">{event.action.includes('approved') ? <ShieldCheck size={17} /> : <Activity size={17} />}</span>
                <div>
                  <h3>{actionNames[event.action] || event.action}</h3>
                  <p>{event.detail}</p>
                  {event.taskId && state.tasks.some(t => t.id === event.taskId) && (
                    <button className="text-link" onClick={() => navigate(`task/${event.taskId}`)}>查看相关任务<ArrowUpRight size={13} /></button>
                  )}
                </div>
                <time>{formatTime(event.createdAt)}</time>
              </article>
            ))}
          </div>
        ) : (
          <Empty title="还没有这类活动" detail="执行操作后，相应记录会显示在这里。" />
        )}
        <div className="table-footer">本地操作记录<span>不将复制或填入标记为外部发送成功</span></div>
      </section>
    </>
  );
}

function UsageStatsSettings() {
  const bridge = (window.flowdesk as any)?.usageStats;
  const [on, setOn] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  useEffect(() => { void bridge?.state().then((s: any) => setOn(s.enabled)).catch(() => {}); }, []);
  if (!bridge || on === undefined) return null;
  const change = async (next: boolean) => {
    setBusy(true);
    try { setOn((await bridge.set(next)).enabled); } catch {} finally { setBusy(false); }
  };
  return (
    <section className="panel settings-panel" aria-label="帮咔哒改进">
      <div className="settings-section-head">
        <span><Activity size={20} /></span>
        <div>
          <h2>帮咔哒改进</h2>
          <p>发送匿名使用统计，帮助优化软件体验。</p>
        </div>
        <label className="switch">
          <input type="checkbox" checked={on} disabled={busy} onChange={e => void change(e.target.checked)} />
          <span className="slider round" />
        </label>
      </div>
    </section>
  );
}

const PRESET_PROVIDERS = [
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', tag: '高性价比' },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', tag: '通用推荐' },
  { name: 'Ollama (本地)', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b', tag: '离线无KEY' },
  { name: 'SiliconFlow (硅基流动)', baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3', tag: '国内高速' }
];

export function SettingsPage({ state, perform, busy, notify, modelSection }: PageProps & { modelSection?: 'reply' | 'vision' }) {
  const [advanced, setAdvanced] = useState(false);
  useEffect(() => {
    if (!modelSection) return;
    setAdvanced(true);
    const frame = requestAnimationFrame(() => {
      const section = document.getElementById(modelSection + '-model-settings');
      section?.scrollIntoView({ block: 'start' });
      section?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [modelSection]);

  const [preferences, setPreferences] = useState(state.preferences);
  const [provider, setProvider] = useState({ baseUrl: state.provider.baseUrl, model: state.provider.model, temperature: state.provider.temperature, apiKey: '' });
  useEffect(() => {
    setProvider(current => ({ ...current, baseUrl: state.provider.baseUrl, model: state.provider.model, temperature: state.provider.temperature, apiKey: '' }));
  }, [state.provider.baseUrl, state.provider.model, state.provider.temperature]);

  const [reveal, setReveal] = useState(false);
  const [test, setTest] = useState('');
  const [importData, setImportData] = useState<AppState>();
  const [removeKey, setRemoveKey] = useState(false);

  return (
    <>
      <PageHead title="设置" description="配置模型服务与本地工作台偏好。" actions={<DiagnosticsButton />} />
      <div className="settings-layout">
        <div className={`settings-main${advanced ? '' : ' settings-simple'}`}>
          <DisplayModeSettings />
          <NoticeSettings />
          <ShortcutSettings />
          <ThemeSettings />
          <IconSettings />
          <p className="muted" style={{ margin: '0 0 14px' }}>
            <button type="button" className="btn btn-ghost" aria-expanded={advanced} onClick={() => setAdvanced(v => !v)}>
              {advanced ? '收起更多模型选项' : '配置画面识别或自定义模型池'}
            </button>
          </p>
          {advanced && (
            <>

            </>
          )}

          <section id="reply-model-settings" tabIndex={-1} className="panel settings-panel">
            <div className="settings-section-head">
              <span><Server size={20} /></span>
              <div>
                <h2>回复生成模型（配置自有模型）</h2>
                <p>支持配置 DeepSeek、OpenAI、Claude 或本地运行的 Ollama 模型。</p>
              </div>
              <span className={`connection-state ${state.provider.hasKey ? 'connected' : ''}`}>
                {state.provider.hasKey ? '密钥已设置' : '未设置密钥'}
              </span>
            </div>

            <div style={{ margin: '14px 0 18px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary, #64748b)', fontWeight: 500 }}>
                常用服务商快捷载入：
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {PRESET_PROVIDERS.map(item => (
                  <button
                    type="button"
                    key={item.name}
                    onClick={() => {
                      setProvider(curr => ({ ...curr, baseUrl: item.baseUrl, model: item.model }));
                      notify(`已载入 ${item.name} 预设，请确认配置`);
                    }}
                    style={{
                      background: provider.baseUrl === item.baseUrl ? '#e0e7ff' : '#f1f5f9',
                      border: provider.baseUrl === item.baseUrl ? '1px solid #6366f1' : '1px solid #cbd5e1',
                      borderRadius: '6px',
                      padding: '5px 10px',
                      fontSize: '11px',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      color: '#1e293b'
                    }}
                  >
                    <strong>{item.name}</strong>
                    <small style={{ color: '#64748b', fontSize: '10px' }}>({item.tag})</small>
                  </button>
                ))}
              </div>
            </div>

            <form onSubmit={async e => {
              e.preventDefault();
              if (await perform('PUT', '/settings', { provider })) {
                setProvider({ ...provider, apiKey: '' });
                const result = await perform<{ ok: boolean; message: string }>('POST', '/provider/test', {}, '模型配置已保存并测连通过');
                setTest(result?.message || '已保存，但测连未通过：请检查地址、模型名和密钥。');
              }
            }}>
              <Field label="接口地址" hint="兼容 OpenAI 格式的接口地址，如 https://api.deepseek.com/v1 或 http://127.0.0.1:11434/v1">
                <input aria-label="回复生成接口地址" required type="url" maxLength={500} value={provider.baseUrl} onChange={e => setProvider({ ...provider, baseUrl: e.target.value })} placeholder="https://api.deepseek.com/v1" />
              </Field>
              <div className="form-row">
                <Field label="模型名称" hint="例如 deepseek-chat, gpt-4o-mini 或 qwen2.5:7b">
                  <input aria-label="回复生成模型名称" required maxLength={200} value={provider.model} onChange={e => setProvider({ ...provider, model: e.target.value })} placeholder="服务商提供的模型名称" />
                </Field>
                <Field label="回答创造力 (Temperature)" hint="建议保持 0.3，数值越小回答越严格依据知识库">
                  <input aria-label="回答的发挥程度" required type="number" min="0" max="2" step="0.1" value={provider.temperature} onChange={e => setProvider({ ...provider, temperature: Number(e.target.value) })} />
                </Field>
              </div>
              <Field label="API 密钥 (API Key)" hint={window.flowdesk ? '密钥加密保存在本地电脑中。留空保持已有密钥不变。' : '浏览器开发模式仅保存在本地服务内存中。留空保持已有密钥。'}>
                <div className="password-field">
                  <input aria-label="回复生成 API Key" required={!state.provider.hasKey && !provider.baseUrl.includes('localhost') && !provider.baseUrl.includes('127.0.0.1')} type={reveal ? 'text' : 'password'} autoComplete="new-password" maxLength={1000} value={provider.apiKey} onChange={e => setProvider({ ...provider, apiKey: e.target.value })} placeholder={state.provider.hasKey ? '已设置密钥，留空保持不变' : '在此填入 API Key'} />
                  <button type="button" aria-label={reveal ? '隐藏密钥' : '显示密钥'} onClick={() => setReveal(!reveal)}>
                    {reveal ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </Field>
              <div className="settings-actions">
                <Button type="submit" busy={busy}><Save size={16} />保存配置</Button>
                <Button type="button" variant="secondary" busy={busy} onClick={async () => {
                  if (await perform('PUT', '/settings', { provider })) {
                    setProvider({ ...provider, apiKey: '' });
                    const result = await perform<{ ok: boolean; message: string }>('POST', '/provider/test', {}, '模型连接已验证');
                    setTest(result?.message || '测试未通过，请检查配置和错误提示。');
                  }
                }}>保存并测试连接</Button>
                {state.provider.hasKey && <button type="button" className="text-link danger-text" onClick={() => setRemoveKey(true)}>移除密钥</button>}
              </div>
              {test && <div className="notice"><Activity size={16} />{test}</div>}
            </form>
          </section>

          <section className="panel settings-panel">
            <div className="settings-section-head">
              <span><FolderLock size={20} /></span>
              <div>
                <h2>工作空间</h2>
                <p>自定义工作空间和操作者名称。</p>
              </div>
            </div>
            <form onSubmit={e => { e.preventDefault(); void perform('PUT', '/settings', { preferences }, '工作空间设置已保存'); }}>
              <div className="form-row">
                <Field label="工作空间名称">
                  <input required maxLength={100} value={preferences.workspaceName} onChange={e => setPreferences({ ...preferences, workspaceName: e.target.value })} />
                </Field>
                <Field label="操作者称呼">
                  <input required maxLength={100} value={preferences.operatorName} onChange={e => setPreferences({ ...preferences, operatorName: e.target.value })} />
                </Field>
              </div>
              <Button type="submit" variant="secondary" busy={busy}>保存工作空间</Button>
            </form>
          </section>

          <section className="panel settings-panel">
            <div className="settings-section-head">
              <span><Download size={20} /></span>
              <div>
                <h2>备份与迁移</h2>
                <p>导出任务、知识、流程与操作记录。备份不包含 API 密钥与敏感信息。</p>
              </div>
            </div>
            <div className="settings-actions">
              <Button variant="secondary" onClick={async () => {
                try {
                  const data = await api('GET', '/export');
                  downloadJson(data, `咔哒-备份-${new Date().toISOString().slice(0, 10)}.json`);
                  notify('备份已交给浏览器或桌面下载');
                } catch (e) {
                  notify((e as Error).message, true);
                }
              }}>
                <Download size={16} />导出工作空间
              </Button>
              <label className="btn btn-secondary file-button">
                <Upload size={16} />从备份恢复
                <input
                  type="file"
                  accept=".json,application/json"
                  aria-label="选择工作空间备份"
                  onChange={async e => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    try {
                      if (file.size > 10_000_000) throw new Error('备份文件不能超过 10MB');
                      const data = JSON.parse(await file.text());
                      if (data.schemaVersion !== 1 || !Array.isArray(data.tasks)) throw new Error('这不是有效的 咔哒 备份');
                      setImportData(data);
                    } catch (err) {
                      notify((err as Error).message, true);
                    }
                  }}
                />
              </label>
            </div>
          </section>

          <UsageStatsSettings />
          <LegalLinks prefix="咔哒 " style={{ margin: '4px 0 14px', textAlign: 'center' }} />
        </div>

        <aside className="settings-aside">
          <ShieldCheck size={29} />
          <h3>清楚知道，<br />数据去了哪里。</h3>
          <ul>
            <li><Check size={15} />任务与知识在本地保存</li>
            <li><Check size={15} />数据备份不包含 API 密钥</li>
            <li><Check size={15} />调用前确认目标模型</li>
            <li><Check size={15} />审核后才能采用草稿</li>
          </ul>
          <div>
            <span className="signal-dot" />咔哒社区版 · v0.3<small>开源本地优先工作空间</small>
          </div>
        </aside>
      </div>

      {importData && (
        <Modal title="恢复这份工作空间备份？" subtitle="当前任务、知识与流程会被替换；现有数据会先在本地保存一份恢复前备份。" onClose={() => setImportData(undefined)}>
          <div className="import-stats">
            <span><b>{importData.tasks.length}</b>任务</span>
            <span><b>{importData.knowledge?.length || 0}</b>知识</span>
            <span><b>{importData.workflows?.length || 0}</b>流程</span>
          </div>
          <p className="muted">API 密钥不会从备份导入。恢复后请检查服务商地址，确认后再调用模型。</p>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setImportData(undefined)}>取消</Button>
            <Button busy={busy} onClick={async () => {
              if (await perform('POST', '/import', { data: importData }, '备份已恢复')) {
                setImportData(undefined);
                navigate('app');
              }
            }}>
              <RotateCcw size={16} />确认恢复
            </Button>
          </div>
        </Modal>
      )}

      {removeKey && (
        <Modal title="移除保存的 API 密钥？" subtitle="接口地址和模型名称会保留，下一次真实调用前需要重新填写密钥。" onClose={() => setRemoveKey(false)}>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setRemoveKey(false)}>取消</Button>
            <Button variant="danger" busy={busy} onClick={async () => {
              if (await perform('DELETE', '/provider/key', undefined, '密钥已移除')) setRemoveKey(false);
            }}>移除密钥</Button>
          </div>
        </Modal>
      )}
    </>
  );
}
