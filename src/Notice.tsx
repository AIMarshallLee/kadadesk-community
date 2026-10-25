import { useEffect, useState } from 'react';
import type { NoticeAction, NoticeCard } from '../shared/notices';
import './notice.css';
import { useMascotSrc } from './mascot';

/** The reminder card window (#notice): one card at a time, buttons 暂停接待 / 打开咔哒 / 知道了 / 不再提醒. */
export default function Notice() {
  const bridge = window.flowdesk?.notice;
  const [card, setCard] = useState<NoticeCard>();
  const [busy, setBusy] = useState(false);
  const [confirmMute, setConfirmMute] = useState(false);
  const mascot = useMascotSrc();
  useEffect(() => { document.documentElement.classList.add('notice-view'); return bridge?.onShow(next => { setCard(next); setBusy(false); setConfirmMute(false); }); }, [bridge]);
  if (!bridge || !card) return null;
  const act = (action: NoticeAction) => { if (busy) return; setBusy(true); void bridge.act(card.id, action).finally(() => setBusy(false)); };
  return <div className="nt" role="alert">
    <img className="nt-mascot" src={mascot} alt="" draggable={false} />
    <div className="nt-body">
      <b>{card.title}</b>
      <p>{card.body}</p>
      <div className="nt-actions">
        {card.pause && <button className="nt-primary" disabled={busy} onClick={() => act('pause')}>暂停接待</button>}
        {card.open && <button className={card.pause ? '' : 'nt-primary'} disabled={busy} onClick={() => act('open')}>打开咔哒</button>}
        {card.extra && <button disabled={busy} onClick={() => act('extra')}>{card.extra}</button>}
        <button disabled={busy} onClick={() => act('ok')}>知道了</button>
        <button className="nt-mute" disabled={busy} title={card.important ? '关掉后可能错过客户；设置 → 提醒 可以再打开' : '设置 → 提醒 可以再打开'} onClick={() => card.important && !confirmMute ? setConfirmMute(true) : act('mute')}>{confirmMute ? '确定不再提醒？' : '不再提醒'}</button>
      </div>
    </div>
  </div>;
}
