/**
 * 3D 展厅预约提醒 (shared/showroom-leads.ts)
 * 纯规则与数据结构定义：URL 校验、文本脱敏/清洗、退避算法、消息合并、日志脱敏与提示语生成。
 */

export interface ShowroomLead {
  id: string;
  time: string;
  name: string;
  phone: string;
  community?: string;
  area?: string;
  note?: string;
  caseId?: string;
  caseTitle?: string;
  text: string;
}

export interface ShowroomLeadsSettings {
  enabled: boolean;
  serverUrl: string;
  intervalSec: number;
}

export interface ShowroomLeadsView {
  enabled: boolean;
  serverUrl: string;
  intervalSec: number;
  hasToken: boolean;
  tokenLast4?: string;
  lastCheckAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
  pendingCount?: number;
}

export interface ShowroomPingResponse {
  ok: boolean;
  site?: string;
  pending?: number;
  message?: string;
}

export interface ShowroomLeadsResponse {
  ok: boolean;
  site?: string;
  leads?: ShowroomLead[];
  message?: string;
}

export interface ShowroomAckResponse {
  ok: boolean;
  acked?: number;
  message?: string;
}

export const SHOWROOM_PLUGIN_ID = 'showroom-leads';
export const SHOWROOM_PLUGIN_NAME = '3D 展厅预约提醒';
export const DEFAULT_INTERVAL_SEC = 30;
export const MIN_INTERVAL_SEC = 15;
export const MAX_INTERVAL_SEC = 300; // 5 分钟
export const TIGHT_RESOURCE_INTERVAL_SEC = 120; // 2 分钟
export const MAX_STORED_ACKED_IDS = 500;
export const MAX_SEND_RETRIES = 5;
export const MAX_TEXT_LENGTH = 1000;
export const MAX_MERGED_BATCH_LEADS = 10;
export const MAX_MERGED_TEXT_LENGTH = 1500;
export const FAIL_ALERT_THRESHOLD_MS = 30 * 60 * 1000; // 连续失败 30 分钟

export const BACKOFF_STEPS_SEC = [30, 60, 120, 300] as const;

export interface FormattedLeadBatch {
  text: string;
  leadIds: string[];
}

/**
 * 校验展厅服务器 URL：
 * 只接受 https://；测试环境下允许 http://localhost 或 http://127.0.0.1。
 * 格式不符合时抛出中文错误提示。
 */
export function validateServerUrl(rawUrl: string): string {
  const trimmed = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!trimmed) throw new Error('请填写展厅网址。');
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('展厅网址格式不对，请填写完整的网址（如 https://3d.kunlungrowth.cn）。');
  }

  const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol === 'http:' && !isLocal) {
    throw new Error('展厅网址只接受以 https:// 开头的安全网址。');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('展厅网址只接受 https:// 网址。');
  }

  // 去除末尾的 /
  return parsed.origin.replace(/\/+$/, '') + parsed.pathname.replace(/\/+$/, '');
}

/**
 * 校验轮询间隔秒数（15 秒到 300 秒/5分钟）
 */
export function validateIntervalSec(sec: unknown): number {
  const num = typeof sec === 'number' ? Math.floor(sec) : Number.parseInt(String(sec ?? ''), 10);
  if (!Number.isFinite(num) || num < MIN_INTERVAL_SEC || num > MAX_INTERVAL_SEC) {
    return DEFAULT_INTERVAL_SEC;
  }
  return num;
}

/**
 * 清洗提醒文字：当作不可信内容，截断到 1000 字，去掉除换行、制表符外的 ASCII 控制字符。
 */
export function sanitizeLeadText(text: string): string {
  if (typeof text !== 'string') return '';
  // 截断到 1000 字
  const sliced = text.slice(0, MAX_TEXT_LENGTH);
  // 去除 [\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f] 等控制字符，保留 \t (\u0009) 和 \n (\u000a), \r (\u000d)
  return sliced.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

/**
 * 对接口令脱敏，仅保留最后 4 位（不足 4 位则全星号）
 */
export function maskToken(token?: string): string {
  if (!token || typeof token !== 'string') return '';
  const clean = token.trim();
  if (clean.length <= 4) return '****';
  return '•'.repeat(Math.min(clean.length - 4, 16)) + clean.slice(-4);
}

/**
 * 获取口令后 4 位
 */
export function getTokenLast4(token?: string): string | undefined {
  if (!token || typeof token !== 'string') return undefined;
  const clean = token.trim();
  if (clean.length < 4) return undefined;
  return clean.slice(-4);
}

/**
 * 格式化发给管理员的消息：
 * - 1 到 3 条：每条单独作为一条消息
 * - 超过 3 条：合并成一条，开头写「N 条新预约」，后面依次列出
 *   - 一条合并消息最多放 10 条预约；超过的分成多条发。
 *   - 每条合并消息再整体截断到 1500 字，在最后一条完整预约后面截，不要截半条。
 */
export function formatAdminLeadMessages(leads: ShowroomLead[]): FormattedLeadBatch[] {
  if (!leads || !leads.length) return [];
  const cleanLeads = leads
    .map(l => ({ ...l, text: sanitizeLeadText(l.text) }))
    .filter(l => l.text.trim().length > 0);
  if (!cleanLeads.length) return [];

  if (cleanLeads.length <= 3) {
    return cleanLeads.map(l => ({
      text: l.text,
      leadIds: [l.id],
    }));
  }

  const batches: FormattedLeadBatch[] = [];
  let remaining = [...cleanLeads];

  while (remaining.length > 0) {
    const candidateSlice = remaining.slice(0, MAX_MERGED_BATCH_LEADS);
    const chosenLeads: ShowroomLead[] = [];
    let chosenText = '';

    for (let i = 0; i < candidateSlice.length; i++) {
      const trialLeads = [...chosenLeads, candidateSlice[i]!];
      const header = `【${trialLeads.length} 条新预约】3D 实景展厅`;
      const items = trialLeads.map((l, idx) => {
        const lines = l.text.split('\n');
        const content = lines[0]?.includes('【新预约】') ? lines.slice(1).join('\n') : l.text;
        return `第 ${idx + 1} 条：\n${content.trim()}`;
      });
      const trialText = `${header}\n\n${items.join('\n\n---\n\n')}`;

      if (chosenLeads.length > 0 && trialText.length > MAX_MERGED_TEXT_LENGTH) {
        break;
      }
      chosenLeads.push(candidateSlice[i]!);
      chosenText = trialText;
    }

    batches.push({
      text: chosenText,
      leadIds: chosenLeads.map(l => l.id),
    });

    remaining = remaining.slice(chosenLeads.length);
  }

  return batches;
}

/**
 * 计算下次检查延迟时间（秒）：
 * - 如果当前连不上服务器（consecutiveFailures > 0），按 30s, 60s, 120s, 300s 逐步拉长退避；
 * - 恢复正常后（failures == 0），如果在资源紧张模式下（resourceTight === true），放大到 120s（2分钟）；
 * - 否则使用配置的常规间隔。
 */
export function calculateNextIntervalSec(
  configuredIntervalSec: number,
  consecutiveFailures: number,
  resourceTight: boolean
): number {
  if (consecutiveFailures > 0) {
    const idx = Math.min(consecutiveFailures - 1, BACKOFF_STEPS_SEC.length - 1);
    return BACKOFF_STEPS_SEC[idx]!;
  }
  if (resourceTight) {
    return Math.max(configuredIntervalSec, TIGHT_RESOURCE_INTERVAL_SEC);
  }
  return configuredIntervalSec;
}

/**
 * 格式化 ping 测试的反馈信息
 */
export function formatPingFeedback(res: ShowroomPingResponse): string {
  if (res.ok) {
    const site = res.site ? `：${res.site}` : '';
    const pending = typeof res.pending === 'number' ? res.pending : 0;
    return `连接成功${site}，有 ${pending} 条预约等着提醒`;
  }
  return res.message || '连接失败，请检查对接口令是否正确。';
}
