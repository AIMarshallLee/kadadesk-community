import { plainTalk } from '../shared/plain-talk';
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { LayoutDashboard, BookOpen, Settings, Plus, Search, Menu, X, AlertCircle, CheckCircle2, ArrowUpRight, Monitor, LoaderCircle, Sparkles, BookOpenText, Contact, MessagesSquare } from 'lucide-react';
import type { ApiRequest, AppState, Task } from '../shared/types';
import { api, getState, navigate } from './api';
import { Button, Logo, Modal, Field, scenarios } from './components';
import Landing from './Landing';
import DiagnosticsButton, { FeedbackButton } from './Diagnostics';
import { KnowledgePage, WorkflowPage, AuditPage, SettingsPage } from './Workspace';
import AttachmentsPage from './Attachments';
import SetupGuide, { setupHelp } from './SetupGuide';
import { FeatureSearch, HelpAssistant, HelpButton, searchShortcut } from './HelpAssistant';
import type { FeatureOpen } from '../shared/feature-index';
import ManualPage, { ManualButton } from './ManualPage';
import ChannelPlaceholder from './ChannelPlaceholder';

const OpenPage = lazy(() => import('./OpenPage'));
const PluginsPage = lazy(() => import('./PluginsPage'));
const CustomersPage = lazy(() => import('./CustomersPage'));

export interface PageProps {
  state: AppState;
  perform: <T>(method: ApiRequest['method'], path: string, body?: unknown, message?: string) => Promise<T | undefined>;
  busy: boolean;
  notify: (message: string, error?: boolean) => void;
  newTask: () => void;
}

const navItems = [
  ['setup', '开始', CheckCircle2],
  ['knowledge', '知识', BookOpen],
  ['desktop-replies', '接待', MessagesSquare],
  ['customers', '客户', Contact],
  ['plugins', '插件', Sparkles],
  ['settings', '设置', Settings],
  ['open', '开放', ArrowUpRight],
] as const;

function getRoute() {
  const hash = window.location.hash.slice(1);
  if (hash.startsWith('knowledge')) return hash;
  if (hash === 'manual' || hash.startsWith('manual/')) return hash;
  if (hash === 'setup' || hash === 'open' || hash === 'plugins' || hash === 'customers') return hash;
  if (hash.startsWith('settings')) return hash;
  if (hash === 'desktop-replies') return 'desktop-replies';
  if (hash === 'home') return 'home';
  if (['tasks', 'task', 'attachments', 'workflows', 'audit', 'app', 'workers'].some(k => hash.startsWith(k))) {
    return hash;
  }
  return 'knowledge';
}

export default function App() {
  const [route, setRoute] = useState(getRoute);
  const firstGuide = useRef(false);
  const [state, setState] = useState<AppState>();
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; error: boolean }>();
  const [showNew, setShowNew] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpQuestion, setHelpQuestion] = useState<{ text: string; at: number }>();
  const [mobileMenu, setMobileMenu] = useState(false);
  const [modelSettingsSection, setModelSettingsSection] = useState<'reply' | 'vision'>();

  const notify = useCallback((message: string, error = false) => setToast({ message: error ? plainTalk(message) : message, error }), []);
  const refresh = useCallback(async () => {
    try {
      const result = await getState();
      setState(result);
      setLoadError('');
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const fn = () => {
      const next = getRoute();
      setRoute(next);
      setMobileMenu(false);
      if (next !== 'home') window.scrollTo(0, 0);
    };
    fn();
    window.addEventListener('hashchange', fn);
    return () => window.removeEventListener('hashchange', fn);
  }, []);

  useEffect(() => {
    if (route !== 'home' && !state) void refresh();
  }, [route, state, refresh]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(undefined), toast.error ? 9000 : 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k' && route !== 'home') {
        e.preventDefault();
        setShowSearch(true);
      }
    };
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
  }, [route]);

  const perform: PageProps['perform'] = async (method, path, body, message) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await api(method, path, body);
      await refresh();
      if (message) notify(message);
      return result as any;
    } catch (e) {
      const msg = (e as Error).message || '';
      notify(msg, true);
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  const props: PageProps | undefined = state ? { state, perform, busy, notify, newTask: () => setShowNew(true) } : undefined;
  const currentPage = route.split('/')[0];
  const title = navItems.find(x => x[0] === currentPage)?.[1] || (currentPage === 'manual' ? '使用手册' : '工作台');

  const openModelSettings = async (section: 'reply' | 'vision') => {
    try {
      await window.flowdesk?.setWindowMode?.('expanded');
      await refresh();
      setModelSettingsSection(section);
      navigate('settings');
    } catch {
      notify('无法打开模型设置，请稍后重试。', true);
    }
  };

  const askHelp = (text?: string) => {
    setHelpOpen(true);
    if (text) setHelpQuestion({ text, at: Date.now() });
  };

  const openFeatureWindow = (open: FeatureOpen | string) => {
    if (open === 'help') setHelpOpen(true);
    else if (open === 'search') setShowSearch(true);
    else if (open === 'reply-model-settings') void openModelSettings('reply');
    else if (open === 'vision-model-settings') void openModelSettings('vision');
    else if (open === 'manual' || open.startsWith('manual/')) navigate(open);
    else navigate(open);
  };

  const openGuidePage = (destination: string) => {
    void (async () => {
      try {
        await window.flowdesk?.setWindowMode?.('expanded');
        await refresh();
        navigate(destination);
      } catch {
        navigate(destination);
      }
    })();
  };

  if (route === 'home') return <Landing />;

  return (
    <div className="workspace-shell">
      {mobileMenu && <div className="sidebar-scrim" onClick={() => setMobileMenu(false)} />}
      <aside className={`sidebar ${mobileMenu ? 'is-open' : ''}`}>
        <button className="brand-button" onClick={() => navigate('home')} aria-label="返回 咔哒 首页"><Logo small /></button>
        <div className="workspace-switch">
          <span className="workspace-avatar">{(state?.preferences.workspaceName || '咔哒').trim().slice(0, 1)}</span>
          <div className="workspace-copy">
            <span className="workspace-name">{state?.preferences.workspaceName || '咔哒工作台'}</span>
            <span className="workspace-role">{state?.preferences.operatorName || '社区版'}</span>
          </div>
        </div>
        <div className="nav-label">核心功能</div>
        <nav aria-label="工作台导航">
          {navItems.map(([key, label, Icon]) => (
            <button
              key={key}
              className={`nav-item ${currentPage === key ? 'is-active' : ''}`}
              onClick={() => navigate(key)}
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="nav-label">帮助</div>
        <nav aria-label="帮助">
          <button className={`nav-item ${currentPage === 'manual' ? 'is-active' : ''}`} onClick={() => navigate('manual')}>
            <BookOpenText size={18} />
            <span>使用手册</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="local-card">
            <span className="signal-dot" />
            <strong>开源社区核心</strong>
            <p>数据本地优先 · 自由扩展</p>
          </div>
        </div>
      </aside>

      <div className="workspace-main">
        <header className="app-topbar">
          <div className="breadcrumbs">
            <button className="icon-button mobile-toggle" onClick={() => setMobileMenu(true)} aria-label="展开导航">
              <Menu size={18} />
            </button>
            <span className="crumb-active">{title}</span>
          </div>
          <div className="topbar-right">
            <HelpButton active={helpOpen} onClick={() => setHelpOpen(v => !v)} />
            <ManualButton active={currentPage === 'manual'} onClick={() => navigate('manual')} />
            <button className="search-trigger" onClick={() => setShowSearch(true)} aria-label="搜索功能和任务">
              <Search size={16} />
              <span>搜索功能…</span>
              <kbd>{searchShortcut()}</kbd>
            </button>
            <span className="environment-tag topbar-platform">
              <span className="environment-dot" aria-hidden="true" />
              {window.flowdesk ? '桌面端' : '网页端'}
            </span>
            <FeedbackButton />
            <DiagnosticsButton />
          </div>
        </header>

        <main className="app-content">
          {currentPage === 'manual' ? (
            <ManualPage route={route} onAsk={askHelp} />
          ) : !state ? (
            <div className="center-card">
              <LoaderCircle className="spin" size={24} />
              <p>{loadError ? `加载失败：${loadError}` : '正在连接工作台…'}</p>
              {loadError ? <Button onClick={refresh}>重试</Button> : null}
            </div>
          ) : !props ? null : (
            <>
              {currentPage === 'setup' && <SetupGuide {...props} onOpen={openGuidePage} />}
              {currentPage === 'knowledge' && <KnowledgePage {...props} section={route.split('/')[1]} />}
              {currentPage === 'desktop-replies' && <ChannelPlaceholder />}
              {currentPage === 'customers' && (
                <Suspense fallback={<p className="muted">正在加载…</p>}>
                  <CustomersPage notify={notify} />
                </Suspense>
              )}
              {currentPage === 'plugins' && (
                <Suspense fallback={<p className="muted">正在加载…</p>}>
                  <PluginsPage notify={notify} />
                </Suspense>
              )}
              {currentPage === 'settings' && (
                <SettingsPage
                  {...props}
                  modelSection={route === 'settings/reply' ? 'reply' : route === 'settings/vision' ? 'vision' : modelSettingsSection}
                />
              )}
              {currentPage === 'open' && (
                <Suspense fallback={<p className="muted">正在加载…</p>}>
                  <OpenPage notify={notify} />
                </Suspense>
              )}
              {currentPage === 'attachments' && <AttachmentsPage {...props} />}
              {currentPage === 'workflows' && <WorkflowPage {...props} />}
              {currentPage === 'audit' && <AuditPage {...props} />}
              {currentPage === 'tasks' && <KnowledgePage {...props} />}
              
              
              {currentPage === 'app' && <KnowledgePage {...props} />}
            </>
          )}
        </main>

        <footer className="app-footer">
          <span><Monitor size={13} /> 本地优先 · 企业私域 AI 工作台</span>
          <span>社区核心 v0.3</span>
        </footer>
      </div>

      {showNew && props && <NewTask {...props} onClose={() => setShowNew(false)} />}
      {showSearch && (
        <FeatureSearch tasks={state?.tasks ?? []} onClose={() => setShowSearch(false)} onOpen={openFeatureWindow} onAsk={askHelp} />
      )}
      <HelpAssistant open={helpOpen} question={helpQuestion} onClose={() => setHelpOpen(false)} onOpen={openFeatureWindow} />
      {toast && (
        <div role={toast.error ? 'alert' : 'status'} className={`toast ${toast.error ? 'toast-error' : ''}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}

function NewTask({ state, perform, busy, onClose }: PageProps & { onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [scenario, setScenario] = useState<Task['scenario']>('service');
  const [input, setInput] = useState('');
  return (
    <Modal title="新建一个任务" subtitle="描述需要处理的对话，让助手帮你起草第一步。" onClose={onClose}>
      <form onSubmit={async e => {
        e.preventDefault();
        const res = await perform('POST', '/tasks', { title, scenario, input });
        if (res) onClose();
      }}>
        <Field label="任务名称">
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="例如：老客户咨询退款政策" required />
        </Field>
        <Field label="应用场景">
          <select value={scenario} onChange={e => setScenario(e.target.value as any)}>
            {Object.entries(scenarios).map(([s, label]) => <option key={s} value={s}>{label}</option>)}
          </select>
        </Field>
        <Field label="输入内容">
          <textarea value={input} onChange={e => setInput(e.target.value)} rows={4} placeholder="粘贴客户的问题或对话上下文" required />
        </Field>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 24 }}>
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button variant="primary" type="submit" disabled={busy}>创建任务</Button>
        </div>
      </form>
    </Modal>
  );
}
