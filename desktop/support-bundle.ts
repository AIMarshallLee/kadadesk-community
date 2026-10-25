/** 一键求助包: one plain-text file in Downloads made only of already-sanitized diagnostics, for the owner to send to 咔哒客服. */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { safeSettings, SUPPORT_HINT } from '../shared/diagnostics';

export { SUPPORT_HINT };
const phases = ['unchecked', 'latest', 'downloading', 'ready', 'installing', 'manual', 'error'];
const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const safeVersion = (v: unknown) => typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v) ? v : 'unknown';
/** Update status as a closed vocabulary; reasons and notes are not copied. */
export function safeUpdate(v: unknown) {
  const u = obj(v); return { phase: typeof u.phase === 'string' && phases.includes(u.phase) ? u.phase : 'unknown', auto: u.auto !== false, latest: safeVersion(u.version), available: u.available === true, problem: typeof u.reason === 'string' && u.reason.length > 0 };
}
/** Last line of defence: anything shaped like a key, licence, token or home folder is masked even if a sanitizer missed it. */
export function scrubSecrets(text: string): string {
  return text
    .replace(/FD1_[A-Za-z0-9_\-]{6,}/g, '[已隐藏]')
    .replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_\-]{12,}/g, '[已隐藏]')
    .replace(/AIza[0-9A-Za-z_\-]{20,}/g, '[已隐藏]')
    .replace(/\b(?:pm|sk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/g, '[已隐藏]')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [已隐藏]')
    .replace(new RegExp(["/", "Users", "/"].join("") + "[^/\\s\\\"]+", "g"), ['/', 'Users', '/'].join('') + '[已隐藏]')
    .replace(/[A-Za-z]:\\Users\\[^\\\s"]+/g, 'C:\\Users\\[已隐藏]');
}
/** `report` is the text of buildDiagnosticReport (already allowlisted); settings and update state are reduced here. */
export function buildSupportBundle(input: { report: string; settings?: unknown; update?: unknown; now?: Date }): string {
  const at = (input.now ?? new Date()).toISOString();
  const text = ['咔哒求助包', SUPPORT_HINT, `生成时间：${at}`, '里面只有：版本、系统、设置开关、最近的出错类型和模型耗时统计；没有客户名字、聊天内容、截图、知识库、密钥或卡密。', '',
    '== 设置（只有开关和数字）==', JSON.stringify(safeSettings(input.settings), null, 2), '',
    '== 自动更新 ==', JSON.stringify(safeUpdate(input.update), null, 2), '',
    '== 诊断日志 ==', input.report.slice(0, 200000)].join('\n');
  return scrubSecrets(text) + '\n';
}
export const supportBundleName = (now = new Date()) => `咔哒求助包-${now.toISOString().slice(0, 16).replace(/[:T]/g, '-')}.txt`;
/** Writes the bundle to `dir` (Downloads) readable only by this user; returns the full path. */
export async function writeSupportBundle(dir: string, text: string, now = new Date()): Promise<string> {
  const file = join(dir, supportBundleName(now)); await writeFile(file, text, { encoding: 'utf8', mode: 0o600 }); return file;
}
