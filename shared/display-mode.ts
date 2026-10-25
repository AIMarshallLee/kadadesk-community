import { plainTalk } from './plain-talk';
import type { DesktopReplyState, TakeoverRow } from './desktop-replies';
import { todayMetrics } from './desktop-replies';

/** How kadadesk stays on screen while reception runs. The engine keeps running in every mode. */
export type DisplayMode = 'floater' | 'background';
export const DEFAULT_DISPLAY_MODE: DisplayMode = 'floater';
export const DISPLAY_MODES: ReadonlyArray<{ value: DisplayMode; label: string; detail: string }> = [
  { value: 'floater', label: '小浮窗（推荐）', detail: '关掉主窗口后，屏幕边上留一个小胶囊：看接待状态、一键暂停/继续，有客户需要你时会亮红点。可以放在桌面任何位置，也能缩成一个图标、贴边隐藏。' },
  { value: 'background', label: '后台运行', detail: '不占屏幕，只在菜单栏留一个图标；有客户需要你时发系统通知。' },
];
export function parseDisplayMode(value: unknown): DisplayMode | undefined {
  return value === 'floater' || value === 'panel' ? 'floater' : value === 'background' ? value : undefined;
}

export interface FloaterSummary {
  status: DesktopReplyState['status'] | 'resuming';
  label: string;
  detail: string;
  repliedToday: number;
  handoffs: Array<{ name: string; question: string; at: string }>;
  reviews: Array<{ id: string; name: string; question: string; reply: string; reason: 'new' | 'risky' | 'all' }>;
  recent: Array<{ name: string; reply: string; at: string }>;
  alert?: string;
}

const short = (text: string, max: number) => { const t = (text ?? '').replace(/\s+/g, ' ').trim(); return t.length > max ? t.slice(0, max - 1) + '…' : t; };

export function deskDay(timezone: string | undefined, now: number) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now)); }
  catch { return new Date(now).toISOString().slice(0, 10); }
}

export function floaterSummary(state: DesktopReplyState, now = Date.now(), resuming = false, emergencyStopped = false, rows?: TakeoverRow[]): FloaterSummary {
  const handoffs = (rows ?? []).map(r => ({ name: r.name, question: short(r.question, 60), at: r.at }));
  const reviews = (state.pendingReviews ?? []).slice(0, 5).map(r => ({ id: r.id, name: r.conversationName, question: short(r.input, 120), reply: r.reply, reason: r.reason }));
  const recent = (state.jobs ?? []).filter(j => j.status === 'visually_confirmed' && j.reply)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3)
    .map(j => ({ name: j.conversationName, reply: short(j.reply, 60), at: j.updatedAt }));
  const repliedToday = todayMetrics({ jobs: state.jobs ?? [], usage: state.usage, config: state.config }, now).replied;
  const alert = state.systemAlert?.text || state.modelAlert?.text || undefined;
  const message = short(plainTalk(state.message ?? ''), 80);
  let status: FloaterSummary['status'] = state.status, label: string, detail: string;
  if (resuming && state.status !== 'running') { status = 'resuming'; label = '正在恢复'; detail = '停手 3 秒后自动开始接待'; }
  else if (emergencyStopped && state.status !== 'running') { status = 'stopped'; label = '已急停'; detail = '点继续恢复接待'; }
  else if (state.status === 'running') {
    const queue = state.awaitingReply ? `，排队 ${state.awaitingReply} 位` : '';
    if (/你仍在使用键鼠|让出控制|已让出|等待键鼠空闲/.test(state.message ?? '')) { label = '等你停手'; detail = `你在用电脑，咔哒等你停手再接${queue}`; }
    else { label = '接待中'; detail = (state.busy ? '正在回复…' : '自动回复中') + queue; }
  }
  else if (state.status === 'paused') { label = '已暂停'; detail = message || '点继续恢复接待'; }
  else { label = '已停止'; detail = '点开始，咔哒接管聊天窗口'; }
  return { status, label, detail, repliedToday, handoffs, reviews, recent, ...(alert ? { alert: short(alert, 120) } : {}) };
}
