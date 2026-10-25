import { useEffect, useState } from 'react';
import { Keyboard } from 'lucide-react';
import { displayShortcut, shortcutFromKey, validShortcut, SHORTCUT_LABELS, type ShortcutAction, type ShortcutSettings as Keys } from '../shared/shortcuts';
import type { ShortcutBridgeState } from '../shared/types';

const mac = typeof navigator !== 'undefined' && navigator.platform.startsWith('Mac');

/** 快捷键: change the global pause/continue and emergency-stop keys. */
export default function ShortcutSettings() {
  const bridge = window.flowdesk?.shortcuts;
  const [state, setState] = useState<ShortcutBridgeState>();
  const [recording, setRecording] = useState<ShortcutAction>();
  const [message, setMessage] = useState<{ text: string; error?: boolean }>();
  useEffect(() => { void bridge?.state().then(setState).catch(() => {}); }, [bridge]);
  const save = async (next: Keys) => {
    try { setState(await bridge!.save(next)); setMessage({ text: '已保存，马上生效。' }); }
    catch (e) { setMessage({ text: (e as Error).message, error: true }); void bridge!.state().then(setState); }
  };
  useEffect(() => {
    if (!recording || !state) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      const accelerator = shortcutFromKey(e);
      if (!accelerator) return; // only modifiers so far
      setRecording(undefined);
      if (!validShortcut(accelerator)) { setMessage({ text: `「${displayShortcut(accelerator, mac)}」不能用：要按住 ${mac ? '⌃、⌥ 或 ⌘' : 'Ctrl 或 Alt'} 中的至少一个，再按一个键。`, error: true }); void bridge!.suspend(false); return; }
      void save({ pause: state.pause, stop: state.stop, [recording]: accelerator });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording, state]);
  if (!bridge || !state) return null;
  const record = (action: ShortcutAction) => { setMessage(undefined); setRecording(action); void bridge.suspend(true); };
  const cancel = () => { setRecording(undefined); void bridge.suspend(false).then(setState); };
  const kbd = { fontFamily: 'inherit', fontWeight: 600, padding: '3px 9px', borderRadius: 6, border: '1px solid #d6cbe0', background: '#f6f0fa', color: '#4a265f', whiteSpace: 'nowrap' as const };
  return <section className="panel settings-panel">
    <div className="settings-section-head"><span><Keyboard size={20} /></span><div><h2>快捷键</h2><p>在任何软件里都能用，按下去不会往聊天框里打字。浮窗和接待页上也会写着当前的快捷键。</p></div></div>
    <div style={{ display: 'grid', gap: 8 }}>
      {(['pause', 'stop'] as const).map(action => <div key={action} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}><strong>{SHORTCUT_LABELS[action].title}</strong><br /><small className="muted">{SHORTCUT_LABELS[action].detail}{state.registered[action] ? '' : ' 现在没生效：这组键被占用了，请换一组。'}</small></div>
        {recording === action ? <><span style={{ ...kbd, borderStyle: 'dashed' }}>请按下新的组合键…</span><button type="button" className="btn btn-ghost" onClick={cancel}>取消</button></>
          : <><kbd style={kbd}>{displayShortcut(state[action], mac)}</kbd><button type="button" className="btn btn-secondary" disabled={!!recording} onClick={() => record(action)}>修改</button></>}
      </div>)}
    </div>
    <p className="muted" style={{ margin: '10px 0 0', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <span>默认：暂停 / 继续 {displayShortcut(state.defaults.pause, mac)}，急停 {displayShortcut(state.defaults.stop, mac)}</span>
      {(state.pause !== state.defaults.pause || state.stop !== state.defaults.stop) && <button type="button" className="btn btn-ghost" disabled={!!recording} onClick={() => void save(state.defaults)}>恢复默认</button>}
    </p>
    {message && <p role={message.error ? 'alert' : undefined} style={{ margin: '8px 0 0', color: message.error ? '#b5483a' : undefined }} className={message.error ? '' : 'muted'}>{message.text}</p>}
  </section>;
}
