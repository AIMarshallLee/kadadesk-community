import { deskDay } from './display-mode';

export interface DailyHealthFacts {
  total: number;
  replied: number;
  within2min: number;
  /** Replied within 60 s (增长飞轮 within_60s). */
  within1min?: number;
  p50Seconds: number;
  slowestSeconds: number;
  handoff: number;
  uncertain: number;
  failed: number;
  knowledgeGaps: number;
  stallMinutes: number;
  stallsByReason: Record<string, number>;
  restarts: number;
}

export interface DailyHealthRecord {
  day?: string;
  stallMinutes?: number;
  stalls?: Record<string, number>;
  restarts?: number;
}

export interface HealthJobLike {
  id?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  source?: string;
  reply?: string;
}

export const KNOWLEDGE_GAP_PATTERN = /确认一下|暂时无法确认|没有.{0,6}资料|转给负责人/;

export function formatDuration(seconds: number): string {
  const sec = Math.max(0, Math.round(seconds));
  if (sec < 60) return `${sec} 秒`;
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return r > 0 ? `${m} 分 ${r} 秒` : `${m} 分钟`;
}

export function dailyHealthFacts(
  jobs: HealthJobLike[] = [],
  health: DailyHealthRecord | undefined,
  timezone: string | undefined,
  now: number
): DailyHealthFacts {
  const today = deskDay(timezone, now);
  const activeSources = new Set(['outbound', 'remote', 'friend']);
  const mine = (jobs ?? []).filter(j =>
    Number.isFinite(Date.parse(j.createdAt)) &&
    deskDay(timezone, Date.parse(j.createdAt)) === today &&
    !activeSources.has(j.source ?? '')
  );

  const repliedJobs = mine.filter(j => j.status === 'visually_confirmed');
  const seconds = repliedJobs
    .map(j => (Date.parse(j.updatedAt) - Date.parse(j.createdAt)) / 1000)
    .filter(s => Number.isFinite(s) && s >= 0)
    .sort((a, b) => a - b);

  const within2min = seconds.filter(s => s <= 120).length;
  const within1min = seconds.filter(s => s <= 60).length;
  const p50Seconds = seconds.length ? Math.round(seconds[Math.floor(seconds.length / 2)]!) : 0;
  const slowestSeconds = seconds.length ? Math.round(seconds[seconds.length - 1]!) : 0;

  const countStatus = (st: string) => mine.filter(j => j.status === st).length;
  const knowledgeGaps = repliedJobs.filter(j => KNOWLEDGE_GAP_PATTERN.test(j.reply || '')).length;

  const isTodayHealth = health && (!health.day || health.day === today);
  const rawStalls = isTodayHealth && health?.stalls ? health.stalls : {};
  const stallsByReason: Record<string, number> = {};
  for (const [k, v] of Object.entries(rawStalls)) {
    const rounded = Math.round(v);
    if (rounded > 0) stallsByReason[k] = rounded;
  }

  const stallMinutes = isTodayHealth ? Math.round(health?.stallMinutes ?? 0) : 0;
  const restarts = isTodayHealth ? Math.round(health?.restarts ?? 0) : 0;

  return {
    total: mine.length,
    replied: repliedJobs.length,
    within2min,
    within1min,
    p50Seconds,
    slowestSeconds,
    handoff: countStatus('handoff'),
    uncertain: countStatus('uncertain'),
    failed: countStatus('failed'),
    knowledgeGaps,
    stallMinutes,
    stallsByReason,
    restarts,
  };
}

export function formatHealthLines(facts: DailyHealthFacts): string[] {
  const pct = facts.total > 0 ? Math.round((facts.within2min / facts.total) * 100) : 0;
  const line1 = `收到 ${facts.total} 条，已回复 ${facts.replied} 条；2 分钟内回复 ${facts.within2min} 条（${pct}%），中位 ${formatDuration(facts.p50Seconds)}，最慢 ${formatDuration(facts.slowestSeconds)}`;
  const line2 = `没回上：转人工 ${facts.handoff} 条、结果待核对 ${facts.uncertain} 条、失败 ${facts.failed} 条`;
  const line3 = `资料里没答案：${facts.knowledgeGaps} 条（已先回复"确认后答复"）`;

  const stallEntries = Object.entries(facts.stallsByReason || {})
    .filter(([_, m]) => m > 0)
    .sort((a, b) => b[1] - a[1]);
  const detail = stallEntries.length > 0
    ? `（${stallEntries.map(([r, m]) => `${r} ${m} 分钟`).join('、')}）`
    : '';
  const line4 = `停工：共 ${facts.stallMinutes} 分钟${detail}；重启 ${facts.restarts} 次`;

  const lines = [line1, line2, line3, line4];
  Object.defineProperty(lines, 'toString', { value: () => lines.join('\n') });
  return lines;
}
