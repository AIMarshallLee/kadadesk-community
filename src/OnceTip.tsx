import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Lightbulb } from 'lucide-react';
import { Button, Modal } from './components';
import { displayShortcut } from '../shared/shortcuts';
import { skipConfirm } from '../shared/once-tips';
import { hideTipForNow, loadTips, muteTip, resetTips, tipHidden, tipMuted, useTips } from './tips';

/**
 * A one-time explanation inside a page: 「知道了」 hides it until 咔哒 is opened again, 「不再提醒」 hides it for good
 * (kept by the app; 设置 → 提醒 can bring it back). Keys are listed in shared/once-tips.ts.
 */
export function OnceTip({ id, title, children, tone = 'info' }: { id: string; title: string; children?: ReactNode; tone?: 'info' | 'warn' }) {
  const tips = useTips();
  if (tipHidden(tips, id)) return null;
  return <div className={`once-tip once-tip-${tone}`} role="note" aria-label={title} data-tip={id}>
    <Lightbulb size={16} aria-hidden />
    <div className="once-tip-body"><strong>{title}</strong>{children && <div className="once-tip-text">{children}</div>}</div>
    <div className="once-tip-actions"><button type="button" onClick={() => hideTipForNow(id)}>知道了</button><button type="button" onClick={() => void muteTip(id)}>不再提醒</button></div>
  </div>;
}

export interface ConfirmSpec {
  title: string;
  /** What happens after 「确定」, one short line each. */
  lines: ReactNode[];
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  /** A key from shared/once-tips.ts: offers 「以后不再问」; once ticked, later asks answer yes without showing. */
  remember?: string;
}
type Pending = ConfirmSpec & { resolve: (ok: boolean) => void };


/**
 * `const [dialog, ask] = useConfirm()`: render `dialog` once, then `if (await ask({...})) doIt()`.
 * Esc, the × and 「取消」 all answer no; nothing changes until 「确定」.
 */
export function useConfirm(): [ReactNode, (spec: ConfirmSpec) => Promise<boolean>] {
  const [pending, setPending] = useState<Pending>();
  const [remember, setRemember] = useState(false);
  const open = useRef<Pending | undefined>(undefined);
  useEffect(() => { void loadTips(); }, []);
  // A page that goes away while asking answers no.
  useEffect(() => () => { open.current?.resolve(false); open.current = undefined; }, []);
  const ask = useCallback((spec: ConfirmSpec) => {
    if (skipConfirm(spec, tipMuted)) return Promise.resolve(true);
    open.current?.resolve(false);
    return new Promise<boolean>(resolve => { const next = { ...spec, resolve }; open.current = next; setRemember(false); setPending(next); });
  }, []);
  const answer = (ok: boolean) => {
    const current = open.current; if (!current) return;
    open.current = undefined; setPending(undefined);
    if (ok && remember && current.remember) void muteTip(current.remember);
    current.resolve(ok);
  };
  const dialog = pending ? <Modal title={pending.title} onClose={() => answer(false)}>
    <ul className="confirm-lines">{pending.lines.map((line, i) => <li key={i}>{line}</li>)}</ul>
    {pending.remember && <label className="confirm-remember"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />以后不再问</label>}
    <div className="modal-actions"><Button variant="secondary" onClick={() => answer(false)}>{pending.cancelLabel ?? '取消'}</Button><Button variant={pending.danger ? 'danger' : 'primary'} onClick={() => answer(true)}>{pending.confirmLabel}</Button></div>
  </Modal> : null;
  return [dialog, ask];
}

/** The lines every 「开始接待」 confirmation shows: 咔哒 uses this computer's own mouse and keyboard. */
export function mouseKeyboardLines(stopKey?: string): ReactNode[] {
  return [
    <><strong>咔哒会借用这台电脑的鼠标和键盘</strong>：自己点开聊天、打字、点发送</>,
    '它在操作时，鼠标会自己动、窗口会切换，这是正常的，不是电脑卡住了',
    '你一动鼠标或键盘，咔哒就先停手让给你，等你停下再接着回',
    stopKey ? `想马上停下：点小浮窗的暂停，或按急停快捷键 ${stopKey}` : '想马上停下：点小浮窗的暂停或「紧急停止」',
  ];
}

/** The emergency-stop shortcut as the owner sees it (e.g. 「⌘⌥.」), or undefined while unknown or not registered. */
export function useStopKey(): string | undefined {
  const [key, setKey] = useState<string>();
  useEffect(() => { let alive = true; void (window.flowdesk as any)?.emergency?.state().then((s: any) => { if (alive && s?.registered && s.shortcut) setKey(displayShortcut(s.shortcut, navigator.platform.startsWith('Mac'))); }).catch(() => {}); return () => { alive = false; }; }, []);
  return key;
}

/** 「恢复页面里的提示」 for 设置 → 提醒. */
export function ResetPageTips({ notify }: { notify?: (message: string, error?: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  return <Button variant="secondary" busy={busy} onClick={() => { setBusy(true); void resetTips().then(() => notify?.('页面里的提示和确认都恢复了'), () => notify?.('没能恢复，请稍后再试', true)).finally(() => setBusy(false)); }}>恢复页面里的提示和确认</Button>;
}
