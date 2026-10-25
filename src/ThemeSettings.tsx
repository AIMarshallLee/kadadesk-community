import { useState } from 'react';
import { Palette } from 'lucide-react';
import { THEMES, saveTheme, savedTheme, type ThemeId } from './theme';

/** 主题色: 昆仑紫 by default; everyone can pick another accent colour (no licence needed). */
export default function ThemeSettings() {
  const [theme, setTheme] = useState<ThemeId>(savedTheme);
  const pick = (id: ThemeId) => { setTheme(id); saveTheme(id); };
  return <section className="panel settings-panel">
    <div className="settings-section-head"><span><Palette size={20} /></span><div><h2>主题色</h2><p>默认昆仑紫。挑一个你喜欢的颜色，马上生效。</p></div></div>
    <div role="radiogroup" aria-label="主题色" style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
      {THEMES.map(t => {
        const on = theme === t.id;
        return <button key={t.id} type="button" role="radio" aria-checked={on} onClick={() => pick(t.id)} title={t.label}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 12px 8px 8px', borderRadius: 999, cursor: 'pointer', fontSize: 13,
            border: on ? `2px solid ${t.swatch}` : '1px solid #e5e7eb', background: on ? '#fff' : '#fafafa', fontWeight: on ? 600 : 400 }}>
          <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: '50%', background: `linear-gradient(135deg, ${t.swatch}, ${t.swatch}cc)`, boxShadow: 'inset 0 0 0 2px rgba(255,255,255,.6)' }} />
          {t.label}
        </button>;
      })}
    </div>
  </section>;
}
