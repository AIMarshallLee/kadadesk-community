import { useEffect, useState } from 'react';
import { BellRing } from 'lucide-react';
import { ResetPageTips } from './OnceTip';

type Row = { key: string; label: string; important?: boolean; muted: boolean };

/** 设置 → 提醒: reminders the owner switched off with 「不再提醒」 can be switched back on here. */
export default function NoticeSettings() {
  const bridge = window.flowdesk?.notice;
  const [rows, setRows] = useState<Row[]>();
  useEffect(() => { void bridge?.list().then(setRows).catch(() => {}); }, [bridge]);
  if (!bridge || !rows) return null;
  const muted = rows.filter(r => r.muted);
  const restore = (key: string) => { void bridge.unmute(key).then(setRows).catch(() => {}); };
  return <section className="panel settings-panel" id="notice-settings">
    <div className="settings-section-head"><span><BellRing size={20} /></span><div><h2>提醒</h2><p>咔哒会在屏幕角落提醒你：开始接待、要借用鼠标键盘、客户等太久、窗口不见了……每条提醒都可以点「不再提醒」。点错了在这里打开</p></div></div>
    {muted.length === 0 ? <p className="muted" style={{ margin: 0 }}>所有提醒都开着</p> : <div style={{ display: 'grid', gap: 8 }}>
      {muted.map(r => <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', border: '1px solid var(--border, #e7e3ee)', borderRadius: 10 }}>
        <span style={{ flex: 1 }}>{r.label}{r.important && <small className="muted">（重要：关掉后可能错过客户）</small>}</span>
        <button type="button" className="btn btn-secondary" onClick={() => restore(r.key)}>恢复提醒</button>
      </div>)}
    </div>}
    <div style={{ marginTop: 12 }}><small className="muted">软件页面里的小提示（点过「不再提醒」的）也可以全部重新显示：</small> <ResetPageTips /></div>
  </section>;
}
