import { useEffect, useState } from 'react';
import kadaMascot from './assets/kada-mascot.png';
import { isMascotIcon, mascotIconFile, type MascotIconId } from '../shared/mascot-icons';

/** 图标款式 in the renderer: the main window, copilot and floater all show the same mascot. localStorage carries the pick
 * across windows (its storage event updates the others at once); the desktop app's own record is the source of truth. */
const KEY = 'kadadesk.mascot';
const EVENT = 'kadadesk-mascot';
export function savedMascot(): MascotIconId { try { const v = localStorage.getItem(KEY); return isMascotIcon(v) ? v : 'default'; } catch { return 'default'; } }
function remember(id: MascotIconId) { try { if (id === 'default') localStorage.removeItem(KEY); else localStorage.setItem(KEY, id); } catch { /* this window only */ } window.dispatchEvent(new Event(EVENT)); }
export function mascotSrc(id: MascotIconId) { const f = mascotIconFile(id); return f ? '/' + f : kadaMascot; }
export async function chooseMascot(id: MascotIconId) { remember(id); await window.flowdesk?.appIcon?.set(id); }
export function useMascot(): MascotIconId {
  const [id, setId] = useState<MascotIconId>(savedMascot);
  useEffect(() => {
    const sync = () => setId(savedMascot());
    window.addEventListener('storage', sync); window.addEventListener(EVENT, sync);
    void window.flowdesk?.appIcon?.get().then(v => { if (isMascotIcon(v) && v !== savedMascot()) remember(v); }).catch(() => {});
    return () => { window.removeEventListener('storage', sync); window.removeEventListener(EVENT, sync); };
  }, []);
  return id;
}
export const useMascotSrc = () => mascotSrc(useMascot());
export function MascotImg({ size }: { size: number }) { return <img src={useMascotSrc()} alt="" style={{ width: size, height: size, objectFit: 'contain' }} />; }
