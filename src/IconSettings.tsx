import { useState } from 'react';
import { Smile } from 'lucide-react';
import { MASCOT_ICONS, type MascotIconId } from '../shared/mascot-icons';
import { chooseMascot, mascotSrc, useMascot } from './mascot';

/** 图标款式: ten looks of the purple mascot. Free for everyone; changes the Dock / taskbar icon, the sidebar and the floater at once. */
export default function IconSettings() {
  const current = useMascot();
  const [error, setError] = useState('');
  const desktop = Boolean(window.flowdesk?.appIcon);
  const pick = (id: MascotIconId) => { setError(''); chooseMascot(id).catch(e => setError((e as Error).message || '图标没有换成功，请再试一次')); };
  return <section className="panel settings-panel">
    <div className="settings-section-head"><span><Smile size={20} /></span><div><h2>图标款式</h2><p>挑一个你喜欢的小紫怪，马上生效：{desktop ? '程序坞 / 任务栏图标、' : ''}左上角和桌面小浮窗都会一起换。</p></div></div>
    <div role="radiogroup" aria-label="图标款式" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', gap: 12 }}>
      {MASCOT_ICONS.map(m => {
        const on = current === m.id;
        return <button key={m.id} type="button" role="radio" aria-checked={on} onClick={() => pick(m.id)} title={m.note}
          style={{ display: 'grid', justifyItems: 'center', gap: 6, padding: '12px 8px 10px', borderRadius: 14, cursor: 'pointer', background: on ? 'hsl(var(--a-h) 60% 97%)' : '#fafafa',
            border: on ? '2px solid hsl(var(--a-h) 45% 45%)' : '1px solid #e5e7eb', fontSize: 13, fontWeight: on ? 600 : 400, color: 'inherit' }}>
          <img src={mascotSrc(m.id)} alt="" width={64} height={64} style={{ width: 64, height: 64, objectFit: 'contain' }} />
          <span>{m.label}</span>
          <small style={{ fontSize: 11, color: '#8a8094', lineHeight: 1.35, textAlign: 'center' }}>{m.note}</small>
        </button>;
      })}
    </div>
    {error && <p className="field-error" role="status" style={{ marginTop: 10 }}>{error}</p>}
    <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>只换显示的图标；「访达 / 应用程序」里的安装包图标保持不变。</p>
  </section>;
}
