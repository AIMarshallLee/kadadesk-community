import { BrowserWindow, screen } from 'electron';
import { isAllowedRendererUrl } from './guards';
import type { NoticeCard } from '../shared/notices';

export const NOTICE_TITLE = '咔哒 提醒';
const SIZE = { width: 420, height: 136 };
const MARGIN = 16;
type Rect = { x: number; y: number; width: number; height: number };
type LiveWindow = { process: string; minimized: boolean; rect: Rect };

export class NoticeWindow {
  readonly win: BrowserWindow;
  private hideTimer?: ReturnType<typeof setTimeout>;
  private current?: NoticeCard;
  private ready: Promise<void>;

  constructor(private options: { rendererUrl: string; preload: string; liveWindows?: () => Promise<LiveWindow[]> }) {
    this.win = new BrowserWindow({
      ...SIZE,
      show: false,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      focusable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      webPreferences: {
        preload: options.preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.ready = this.win.loadURL(`${options.rendererUrl}#notice`).catch(() => {});
  }

  async show(card: NoticeCard): Promise<void> {
    await this.ready;
    this.current = card;
    if (this.hideTimer) clearTimeout(this.hideTimer);

    const display = screen.getPrimaryDisplay();
    const area = display.workArea;
    const x = area.x + area.width - SIZE.width - MARGIN;
    const y = area.y + area.height - SIZE.height - MARGIN;

    this.win.setBounds({ x, y, width: SIZE.width, height: SIZE.height });
    this.win.webContents.send('flowdesk:notice:show', card);
    this.win.showInactive();

    this.hideTimer = setTimeout(() => {
      this.hide();
    }, 10000);
  }

  hide(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.current = undefined;
    if (!this.win.isDestroyed()) {
      this.win.hide();
    }
  }

  destroy(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    if (!this.win.isDestroyed()) {
      this.win.destroy();
    }
  }
}
