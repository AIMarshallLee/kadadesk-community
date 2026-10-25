export type Scenario = 'service' | 'community' | 'sales' | 'recruitment' | 'content';
export type TaskStatus = 'draft' | 'review' | 'approved' | 'completed' | 'archived';

export interface Knowledge {
  id: string;
  title: string;
  content: string;
  tags: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  question?: string;
  aliases?: string[];
  scenario?: Scenario | 'all';
  source?: string;
  sourceLocator?: string;
  reviewStatus?: 'pending' | 'approved';
  approvedAt?: string;
  importId?: string;
  supersedes?: string[];
  heldForReview?: true;
}

export interface Workflow {
  id: string;
  name: string;
  scenario: Scenario;
  description: string;
  instructions: string;
  greeting: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  title: string;
  scenario: Scenario;
  workflowId: string;
  input: string;
  reply: string;
  rationale: string;
  knowledgeIds: string[];
  status: TaskStatus;
  mode: 'demo' | 'live';
  sourceName: string;
  createdAt: string;
  updatedAt: string;
  operation?: any;
}

export interface AuditEvent {
  id: string;
  taskId?: string;
  action: string;
  detail: string;
  createdAt: string;
}

export interface ProviderSettings {
  baseUrl: string;
  model: string;
  temperature: number;
  hasKey: boolean;
}

export interface CustomerLead {
  id: string;
  conversationName: string;
  intent: 'high' | 'medium' | 'low' | 'complaint';
  phone?: string;
  chat_appId?: string;
  budget?: string;
  painPoint?: string;
  nextStep?: string;
  notes?: string;
  updatedAt: string;
}

export interface PlaybookPack {
  id: string;
  category: string;
  name: string;
  description: string;
  items: Array<{ title: string; content: string; tags: string[] }>;
  workflow?: { name: string; instructions: string; greeting: string };
}

export interface ChatExtractResult {
  title: string;
  objection: string;
  strategy: string;
  suggestedQa: Array<{ title: string; question: string; answer: string; tags: string[] }>;
  workflowGuidelines: string[];
}

export interface PsychologyDiagnostic {
  underlyingIntent: string;
  riskLevel: 'safe' | 'cautious' | 'high_risk';
  coreNeed: 'price' | 'trust' | 'speed' | 'service' | 'reassurance' | 'other';
  suggestedAction: string;
  confidence: number;
}

export interface CandidateDraft {
  id: 'quick' | 'warm' | 'conversion';
  label: string;
  text: string;
  rationale?: string;
}

export interface LicenseStatus {
  machineId: string;
  licensed: boolean;
  expiry?: string;
  plan?: string;
}

export interface Preferences {
  workspaceName: string;
  operatorName: string;
  collectApprovedLearning?: boolean;
  detailedGuide?: boolean;
  autoEnableKnowledge?: boolean;
}

export interface AppState {
  schemaVersion: number;
  knowledge: Knowledge[];
  workflows: Workflow[];
  tasks: Task[];
  events: AuditEvent[];
  provider: ProviderSettings;
  preferences: Preferences;
  training?: import('./knowledge-training').TrainingRecord[];
  learning?: import('./learning').LearningCandidate[];
  leads?: CustomerLead[];
}

export interface ApiRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
}

export interface OpenMcpClientInfo {
  id: string;
  label: string;
  keyHint: string;
  appTasks: boolean;
  createdAt: string;
  calls: number;
  lastCallAt?: string;
}

export interface OpenMcpBridgeState {
  enabled: boolean;
  port: number;
  token: string;
  listening: boolean;
  url: string;
  error?: string;
  calls: number;
  lastCallAt?: string;
  defaultCalls: number;
  defaultLastCallAt?: string;
  disabledTools: string[];
  appTasks: boolean;
  clients: OpenMcpClientInfo[];
  stdio?: import('./open-mcp-clients').OpenMcpStdioLaunch;
}

export interface DesktopBridge {
  platform?: {
    status(): Promise<{ platform: string; arch: string; screen: string; accessibility: boolean }>;
    openPermission(kind: 'screen' | 'accessibility'): Promise<void>;
  };
  diagnostics?: import('./diagnostics').DiagnosticBridge;
  appIcon?: {
    get(): Promise<import('./mascot-icons').MascotIconId>;
    set(id: import('./mascot-icons').MascotIconId): Promise<import('./mascot-icons').MascotIconId>;
  };
  knowledgeLibrary?: {
    status(): Promise<import('../desktop/knowledge-library-ipc').LibraryStatus>;
    create(): Promise<import('../desktop/knowledge-library-ipc').LibraryStatus>;
    choose(): Promise<import('../desktop/knowledge-library-ipc').LibraryStatus | null>;
    open(which?: 'source' | 'pending' | 'live' | 'old' | 'images'): Promise<void>;
    sync(): Promise<import('../desktop/knowledge-library-ipc').LibraryStatus>;
    backupChoose(): Promise<import('../desktop/knowledge-library-ipc').LibraryStatus | null>;
    backupUse(path: string): Promise<import('../desktop/knowledge-library-ipc').LibraryStatus>;
    backupNow(): Promise<import('../desktop/knowledge-library-ipc').LibraryStatus>;
    backupClear(): Promise<import('../desktop/knowledge-library-ipc').LibraryStatus>;
  };
  knowledgeSources?: {
    pickFolder(): Promise<import('./knowledge-sources').KnowledgeSourceView | null>;
    authorizeDrive(kind: import('./cloud-drives').DriveKind): Promise<{ manualCode: boolean; attemptId: string }>;
  };
  knowledgeRepos?: {
    pickFolder(): Promise<import('./knowledge-repos').RepoView | null>;
  };
  update?: {
    check(): Promise<UpdateView>;
    state(): Promise<UpdateView>;
    open(url: string): Promise<void>;
    setAuto?(on: boolean): Promise<UpdateView>;
    applyNow?(): Promise<UpdateView>;
  };
  loginItem?: {
    state(): Promise<{ supported: boolean; on: boolean }>;
    set(on: boolean): Promise<{ supported: boolean; on: boolean }>;
  };
  support?: {
    bundle(): Promise<{ name: string; shown: boolean }>;
  };
  plugins?: import('./plugins').PluginsBridge;
  customers?: import('./customers').CustomersBridge;
  open: {
    state(): Promise<OpenMcpBridgeState>;
    save(input: { enabled?: boolean; port?: number; regenerateToken?: boolean; disabledTools?: string[]; appTasks?: boolean }): Promise<OpenMcpBridgeState>;
    tasks?(): Promise<any>;
    approveTask?(taskId: string): Promise<any>;
    rejectTask?(taskId: string): Promise<any>;
    unlockTasks?(key: string): Promise<any>;
    addClient(input: { label: string; tool?: string }): Promise<OpenMcpBridgeState>;
    removeClient(id: string): Promise<OpenMcpBridgeState>;
    regenerateClientKey(id: string): Promise<OpenMcpBridgeState>;
    copyClientKey(id: string): Promise<void>;
    setClientAppTasks(id: string, allowed: boolean): Promise<OpenMcpBridgeState>;
  };
  companion?: import('./companion').CompanionBridge;
  media?: import('./media').MediaBridge;
  desktopReplies?: import('./desktop-replies').DesktopReplyBridge;
  request(request: ApiRequest): Promise<unknown>;
  copyText(text: string): Promise<void>;
  version(): Promise<string>;
  setWindowMode?(mode: 'compact' | 'expanded' | 'minimize' | 'restore' | 'automation'): Promise<void>;
  display?: {
    mode(): Promise<import('./display-mode').DisplayMode>;
    setMode(mode: import('./display-mode').DisplayMode): Promise<import('./display-mode').DisplayMode>;
    edgeHide(): Promise<boolean>;
    setEdgeHide(on: boolean): Promise<boolean>;
    closeAction?(): Promise<'hide' | 'quit' | 'ask'>;
    setCloseAction?(v: 'hide' | 'quit' | 'ask'): Promise<'hide' | 'quit' | 'ask'>;
  };
  shortcuts?: {
    state(): Promise<ShortcutBridgeState>;
    suspend(suspended: boolean): Promise<ShortcutBridgeState>;
    save(input: import('./shortcuts').ShortcutSettings): Promise<ShortcutBridgeState>;
  };
  notice?: {
    onShow(listener: (card: import('./notices').NoticeCard) => void): () => void;
    act(id: string, action: import('./notices').NoticeAction): Promise<void>;
    list(): Promise<Array<{ key: string; label: string; important?: boolean; muted: boolean }>>;
    unmute(key: string): Promise<Array<{ key: string; label: string; important?: boolean; muted: boolean }>>;
  };
  floater?: {
    summary(): Promise<FloaterView | undefined>;
    toggle(): Promise<FloaterView | undefined>;
    setForm(form: 'icon' | 'capsule' | 'panel'): Promise<void>;
    moveBy(dx: number, dy: number): Promise<void>;
    endDrag(): Promise<void>;
    onDock(listener: (dock: FloaterDock) => void): () => void;
    openMain(): Promise<void>;
    markHandled(name: string): Promise<FloaterView | undefined>;
    review(id: string, action: 'send' | 'skip', edited?: string, save?: boolean): Promise<FloaterView & { saved?: 'approved' | 'pending' | 'failed' }>;
    editing(on: boolean): Promise<void>;
  };
}

export type UpdatePhase = 'unchecked' | 'latest' | 'downloading' | 'ready' | 'installing' | 'manual' | 'error';
export interface UpdateView {
  version: string;
  notes?: string;
  url?: string;
  available: boolean;
  checkedAt: string;
  error?: string;
  phase: UpdatePhase;
  auto: boolean;
  current: string;
  reason?: string;
}

export type ShortcutBridgeState = import('./shortcuts').ShortcutSettings & {
  registered: { stop: boolean; pause: boolean };
  defaults: import('./shortcuts').ShortcutSettings;
};

export type FloaterDock = { edge?: 'left' | 'right'; tucked: boolean };
export type FloaterView = import('./display-mode').FloaterSummary & {
  mode: import('./display-mode').DisplayMode;
  form: 'icon' | 'capsule' | 'panel';
  dock: FloaterDock;
  acting: boolean;
  shortcuts: { pause: string; stop: string };
};

declare global {
  interface Window {
    flowdesk?: DesktopBridge;
  }
}
