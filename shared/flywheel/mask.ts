import { redactSecrets } from '../secret-guard';

/**
 * 增长飞轮 privacy filter for every outgoing text field (spec §2.3): secrets (keys, passwords, codes) are removed and
 * phone, ID-card and bank-card numbers are masked the way the dashboard shows them (138****0000). Only for flywheel
 * events: secret-guard's own rules for replies and knowledge are not changed.
 */
const ID_CARD = /(?<![0-9A-Za-z])([1-9]\d{5})(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}([\dXx])(?![0-9A-Za-z])/g;
const MOBILE = /(?<!\d)(?:\+?86[-\s]?)?(1[3-9]\d)[-\s]?(\d{4})[-\s]?(\d{4})(?!\d)/g;
const LANDLINE = /(?<!\d)(0\d{2,3})-(\d{3,4})(\d{4})(?!\d)/g;
const SERVICE_LINE = /(?<!\d)([48]00)[-\s]?\d{3}[-\s]?(\d{4})(?!\d)/g;
/** Bank cards and any other long number (13–19 digits, optionally grouped by 4). */
const LONG_NUMBER = /(?<!\d)\d{4}(?:[-\s]?\d{4}){2,3}(?:[-\s]?\d{1,3})?(?!\d)|(?<!\d)\d{13,19}(?!\d)/g;

export function maskOutboundText(input: string): string {
  let out = redactSecrets(String(input ?? '')).text;
  out = out.replace(ID_CARD, (_all, head: string, tail: string) => `${head}********${'*'.repeat(3)}${tail}`);
  out = out.replace(MOBILE, (_all, a: string, _b: string, c: string) => `${a}****${c}`);
  out = out.replace(LANDLINE, (_all, a: string, _b: string, c: string) => `${a}-****${c}`);
  out = out.replace(SERVICE_LINE, (_all, a: string, c: string) => `${a}-***-${c}`);
  out = out.replace(LONG_NUMBER, m => { const d = m.replace(/\D/g, ''); return d.length < 13 ? m : `****${d.slice(-4)}`; });
  return out;
}

/** Masks every string inside a JSON-like value (identities are handled by the caller and never passed here). */
export function maskDeep<T>(value: T): T {
  if (typeof value === 'string') return maskOutboundText(value) as unknown as T;
  if (Array.isArray(value)) return value.map(v => maskDeep(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = maskDeep(v);
    return out as T;
  }
  return value;
}

/** Cuts to at most `max` characters (code points), after masking, so the result always fits the schema limit. */
export function fit(text: string | undefined, max: number): string | undefined {
  if (typeof text !== 'string') return undefined;
  const clean = maskOutboundText(text).replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return undefined;
  const chars = [...clean];
  return chars.length <= max ? clean : chars.slice(0, max).join('');
}
