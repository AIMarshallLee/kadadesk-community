import { useEffect, useState } from 'react';

/** A whole-number field that lets the owner type freely (「3」 on the way to 「30」) and keeps the value in range only
 *  when they leave the field. Values already in range are passed on while typing, so saving right away works. */
export default function NumberInput({ value, min, max, fallback, onChange, ...rest }: { value: number; min: number; max: number; fallback?: number; onChange: (value: number) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'min' | 'max' | 'type'>) {
  const [raw, setRaw] = useState(String(value));
  useEffect(() => { setRaw(current => Number(current) === value && current.trim() !== '' ? current : String(value)); }, [value]);
  const clamp = (n: number) => Math.max(min, Math.min(max, Math.round(n)));
  return <input {...rest} type="number" inputMode="numeric" min={min} max={max} value={raw}
    onChange={e => { const text = e.target.value; setRaw(text); const n = Number(text); if (text.trim() !== '' && Number.isFinite(n) && n >= min && n <= max) onChange(Math.round(n)); }}
    onBlur={e => { const n = Number(raw); const next = raw.trim() === '' || !Number.isFinite(n) ? clamp(fallback ?? value) : clamp(n); setRaw(String(next)); if (next !== value) onChange(next); rest.onBlur?.(e); }} />;
}
