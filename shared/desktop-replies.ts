/**
 * 社区版基础类型存根 (Community Edition Stub)
 * 渠道自动化与实时接待由商业专业版提供。
 */

export interface ReplyPersona {
  id: string;
  name: string;
  role: string;
  tone: string;
  rules: string[];
}

export interface ChatMessage {
  direction: 'incoming' | 'outgoing';
  text: string;
  time?: string;
}

export interface VisibleChatMessage extends ChatMessage {
  id?: string;
}

export interface ChatObservation {
  conversationName?: string;
  speaker?: string;
  text?: string;
  time?: string;
  messages: ChatMessage[];
}

export interface DesktopReplyJob {
  id: string;
  conversationId: string;
  conversationName: string;
  input: string;
  reply: string;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'handoff' | 'uncertain' | 'visually_confirmed';
  source?: string;
  createdAt: string;
  updatedAt: string;
  knowledgeIds?: string[];
  lastQuestion?: string;
  draftReply?: string;
}

export interface DesktopReplyConfig {
  receptionHours?: { enabled: boolean; start: string; end: string };
  tone?: string;
  autoReply?: boolean;
  timezone?: string;
  layout?: any;
  chat_appUnreadRegion?: any;
  adminTag?: string;
  adminContact?: string;
  application?: string;
  receptionSuspended?: boolean;
  reviewMode?: string;
  workflowId?: string;
  draftOnly?: boolean;
  mode?: string;
  includeGroups?: boolean;
  keywordRules?: any[];
  followUp?: any;
  friendAccept?: any;
  mediaAutoReply?: boolean;
  pollSeconds?: number;
  persona?: any;
  [key: string]: any;
}

export interface TakeoverRow {
  name: string;
  question: string;
  at: string;
}

export interface DesktopReplyState {
  status: 'idle' | 'running' | 'paused' | 'stopped';
  jobs: DesktopReplyJob[];
  message?: string;
  checkpoints?: Record<string, ChatObservation>;
  usage?: Record<string, any>;
  config?: DesktopReplyConfig;
  systemAlert?: { text: string };
  modelAlert?: { text: string };
  pendingReviews?: Array<{ id: string; conversationName: string; input: string; reply: string; reason: 'new' | 'risky' | 'all' }>;
  handledTakeovers?: Record<string, any>;
  awaitingReply?: number;
  busy?: boolean;
}

export interface DesktopReplyBridge {
  state(): Promise<DesktopReplyState>;
  start?(): Promise<DesktopReplyState>;
  stop?(): Promise<DesktopReplyState>;
  pause?(): Promise<DesktopReplyState>;
  resume?(): Promise<DesktopReplyState>;
}

export const TAKEOVER_MIN_SECONDS = 5;
export const TAKEOVER_MAX_SECONDS = 3600;
export type TakeoverSpan = number | 'today' | 'forever';

export function defaultReplyLayout() {
  return {
    windowWidth: 1024,
    windowHeight: 768,
  };
}

export function withinReceptionHours(_config?: DesktopReplyConfig, _now = Date.now()): boolean {
  return true;
}

export function todayMetrics(_data: { jobs?: DesktopReplyJob[]; usage?: any; config?: any }, _now = Date.now()) {
  return { replied: 0, handoffs: 0, reviewed: 0 };
}

export function contactRouting(_contactId: string, _config?: DesktopReplyConfig) {
  return { route: 'normal', priority: 1 };
}

export function adminTagged(config?: { adminContact?: string; adminTag?: string }): boolean {
  return !!config?.adminTag && !!config?.adminContact?.trim().startsWith(config.adminTag);
}

export function deskLocalTime(timezone: string | undefined, at: number): { day: number; minutes: number } {
  const zone = timezone || 'Asia/Shanghai';
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(at));
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  const minutes = (Number(get('hour')) % 24) * 60 + Number(get('minute'));
  return { day: day < 0 ? 0 : day, minutes };
}

