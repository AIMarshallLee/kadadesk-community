import { useEffect, useState } from 'react';
import { TAKEOVER_MAX_SECONDS, TAKEOVER_MIN_SECONDS, type TakeoverSpan } from '../shared/desktop-replies';

type Unit = 1 | 60 | 3600 | 86400;
const UNITS: Array<[Unit, string]> = [[1, '秒'], [60, '分钟'], [3600, '小时'], [86400, '天']];
const bestUnit = (s: number): Unit => s % 86400 === 0 ? 86400 : s % 3600 === 0 ? 3600 : s % 60 === 0 ? 60 : 1;
const inRange = (s: number) => Number.isFinite(s) && s >= TAKEOVER_MIN_SECONDS && s <= TAKEOVER_MAX_SECONDS;
const toSeconds = (text: string, unit: Unit) => { const n = Number(text); return text.trim() !== '' && Number.isFinite(n) && n > 0 ? Math.round(n * unit) : NaN; };
const clamp = (s: number) => Math.max(TAKEOVER_MIN_SECONDS, Math.min(TAKEOVER_MAX_SECONDS, Number.isFinite(s) ? s : 1800));

/** A takeover length typed freely: a number with 秒/分钟/小时/天 (10 seconds to 30 days), and, when offered,
 *  「到今天结束」 or 「等我手动交还」. Only valid values are passed on; leaving the field pulls a bad number into range. */
export default function DurationField({ value, onChange, today = true, forever = true, foreverLabel = '等我手动交还', label, disabled }: {
  value: TakeoverSpan; onChange: (value: TakeoverSpan) => void; today?: boolean; forever?: boolean; foreverLabel?: string; label: string; disabled?: boolean;
}) {
  const seconds = typeof value === 'number' ? value : undefined;
  const [unit, setUnit] = useState<Unit>(seconds !== undefined ? bestUnit(seconds) : 60);
  const [raw, setRaw] = useState(seconds !== undefined ? String(seconds / bestUnit(seconds)) : '30');
  // A value changed from outside (another field, a saved setting) is shown in its most readable unit.
  useEffect(() => { if (seconds !== undefined && toSeconds(raw, unit) !== seconds) { const u = bestUnit(seconds); setUnit(u); setRaw(String(seconds / u)); } }, [seconds]);
  const typed = toSeconds(raw, unit);
  const kind = seconds !== undefined ? 'span' : (value as string);
  const offerKinds = today || forever;
  const show = (s: number) => { const u = bestUnit(s); setUnit(u); setRaw(String(s / u)); };
  return <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
    {offerKinds && <select aria-label={`${label}方式`} disabled={disabled} value={kind} onChange={e => { const k = e.target.value; if (k === 'span') { const s = inRange(typed) ? typed : 1800; if (!inRange(typed)) show(s); onChange(s); } else onChange(k as 'today' | 'forever'); }}>
      <option value="span">一段时间</option>
      {today && <option value="today">到今天结束</option>}
      {forever && <option value="forever">{foreverLabel}</option>}
    </select>}
    {kind === 'span' && <>
      <input type="number" inputMode="decimal" step="any" min={0} aria-label={label} disabled={disabled} value={raw} style={{ width: 72 }}
        onChange={e => { setRaw(e.target.value); const s = toSeconds(e.target.value, unit); if (inRange(s)) onChange(s); }}
        onBlur={() => { if (!inRange(typed)) { const s = clamp(typed); show(s); onChange(s); } }} />
      <select aria-label={`${label}单位`} disabled={disabled} value={unit} onChange={e => { const u = Number(e.target.value) as Unit; setUnit(u); const s = toSeconds(raw, u); if (inRange(s)) onChange(s); }}>
        {UNITS.map(([u, name]) => <option key={u} value={u}>{name}</option>)}
      </select>
      {!inRange(typed) && <small role="alert" style={{ color: '#b42318' }}>最短 10 秒，最长 30 天</small>}
    </>}
  </span>;
}
