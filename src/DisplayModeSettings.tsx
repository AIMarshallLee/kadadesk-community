import { useEffect, useState } from 'react';
import { PanelRightOpen } from 'lucide-react';
import { DISPLAY_MODES, type DisplayMode } from '../shared/display-mode';

/** 显示方式: how kadadesk stays on screen. Reception keeps running the same way in all three. */
export default function DisplayModeSettings() {
  const bridge = window.flowdesk?.display;
  const [mode, setMode] = useState<DisplayMode>();
  const [message, setMessage] = useState('');
  const [edgeHide, setEdgeHide] = useState<boolean>();
  const [closeAction, setCloseAction] = useState<'hide' | 'quit' | 'ask'>();
  useEffect(() => { void bridge?.mode().then(setMode).catch(() => {}); void bridge?.edgeHide?.().then(setEdgeHide).catch(() => {}); void bridge?.closeAction?.().then(setCloseAction).catch(() => {}); }, [bridge]);
  if (!bridge) return null;
  const choose = async (next: DisplayMode) => {
    setMessage('');
    try { setMode(await bridge.setMode(next)); setMessage(next === 'floater' ? '已改为小浮窗：关掉主窗口后，浮窗出现在屏幕边上。' : next === 'background' ? '已改为后台运行：点菜单栏的咔哒图标可随时打开。' : '已改为侧边面板。'); }
    catch (e) { setMessage((e as Error).message); }
  };
  return <section className="panel settings-panel">
    <div className="settings-section-head"><span><PanelRightOpen size={20} /></span><div><h2>显示方式</h2><p>接待在两种方式下都照常运行，只是咔哒在屏幕上占多大地方不同。菜单栏图标里也能随时切换。</p></div></div>
    <div role="radiogroup" aria-label="显示方式" style={{ display: 'grid', gap: 8 }}>
      {DISPLAY_MODES.map(item => <label key={item.value} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 10, cursor: 'pointer', border: `1px solid ${mode === item.value ? '#7a4a9c' : '#e5e7eb'}`, background: mode === item.value ? '#f6f0fa' : '#fff' }}>
        <input type="radio" name="display-mode" checked={mode === item.value} onChange={() => void choose(item.value)} style={{ marginTop: 3 }} />
        <span><strong>{item.label}</strong><br /><small className="muted">{item.detail}</small></span>
      </label>)}
    </div>
    {mode === 'floater' && edgeHide !== undefined && <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 10, cursor: 'pointer' }}>
      <input type="checkbox" checked={edgeHide} onChange={e => { const on = e.target.checked; void bridge.setEdgeHide(on).then(setEdgeHide).catch(err => setMessage((err as Error).message)); }} style={{ marginTop: 3 }} />
      <span><strong>贴边自动隐藏</strong><br /><small className="muted">把浮窗拖到屏幕左边或右边，它会缩进去只露一条细边；鼠标移过去就滑出来。浮窗可以放在桌面任何位置，放在聊天窗口上时，咔哒点按、打字那几秒它会自动让开。</small></span>
    </label>}
    {closeAction !== undefined && bridge.setCloseAction && <div style={{ marginTop: 14 }}>
      <strong>点窗口的关闭按钮（×）时</strong>
      <div role="radiogroup" aria-label="关闭按钮" style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 6 }}>
        {([['hide', '缩到后台，继续接待'], ['quit', '直接退出咔哒'], ['ask', '每次问我']] as const).map(([value, text]) => <label key={value} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
          <input type="radio" name="close-action" checked={closeAction === value} onChange={() => { void bridge.setCloseAction!(value).then(setCloseAction).catch(err => setMessage((err as Error).message)); }} />{text}
        </label>)}
      </div>
      <small className="muted">随时都可以完全退出：点菜单栏（Windows 是右下角任务栏）的咔哒图标 →「退出」。退出后客户的消息不会再自动回复。</small>
    </div>}
    {message && <p className="muted" style={{ margin: '10px 0 0' }}>{message}</p>}
  </section>;
}
