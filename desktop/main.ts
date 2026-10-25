import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, shell, Tray } from 'electron';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createService, ApiError } from '../server/service';
import { isAllowedRequest } from './guards';
import { resolveDataLocation } from './data-location';
import { createDiagnosticLog } from './diagnostics';
import { createLoginItem } from './login-item';
import { applicationMenu } from './app-menu';
import { createKnowledgeLibrary } from './knowledge-library-ipc';
import { registerCustomers } from './customers-ipc';
import { registerPlugins } from './plugins-ipc';
import { createOpenMcp } from './open-mcp';
import { createNoticeCenter, installNoticeCenter } from './notice-center';
import { NoticeWindow } from './notice-window';
import { trayTemplate1x } from './brand-icons';
import { createModelTimingBuffer } from './model-timing';
import { buildDiagnosticReport } from '../shared/diagnostics';
import type { ApiRequest } from '../shared/types';

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let openMcpServer: ReturnType<typeof createOpenMcp> | null = null;
let noticeWindow: NoticeWindow | null = null;

const timingBuffer = createModelTimingBuffer();

async function startApp() {
  const userData = app.getPath('userData');
  await mkdir(userData, { recursive: true });

  const location = resolveDataLocation(userData, '');
  const dataDir = location.dir;
  await mkdir(dataDir, { recursive: true });

  const service = await createService({ dataDir });
  const diagLog = await createDiagnosticLog(join(userData, 'diagnostics.json'));

  // 1. 启动或初始化 MCP 开放服务
  try {
    openMcpServer = createOpenMcp({
      file: join(userData, 'open-mcp.json'),
      request: async (input) => service.request(input as ApiRequest),
      reception: () => undefined,
      pauseReception: async () => {},
      suspendReception: async () => {}
    });
    await openMcpServer.init().catch(() => {});
  } catch (err) {
    console.error('[OpenMCP] Failed to initialize:', err);
  }

  // 2. 创建主窗口
  const preloadPath = existsSync(join(__dirname, 'preload.cjs'))
    ? join(__dirname, 'preload.cjs')
    : join(__dirname, 'preload.js');

  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 640,
    title: '咔哒社区版',
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      preload: preloadPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow = win;

  // 3. 托盘与菜单
  try {
    const iconImage = nativeImage.createFromBuffer(Buffer.from(trayTemplate1x, 'base64'));
    tray = new Tray(iconImage);
    tray.setToolTip('咔哒社区版');
    const trayMenu = Menu.buildFromTemplate([
      { label: '打开咔哒', click: () => { win.show(); win.focus(); } },
      { type: 'separator' },
      { label: '退出', click: () => { app.quit(); } }
    ]);
    tray.setContextMenu(trayMenu);
    tray.on('click', () => {
      if (win.isVisible()) {
        win.focus();
      } else {
        win.show();
      }
    });
  } catch {}

  const menuTemplate = applicationMenu('zh-CN', () => {});
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));

  // 4. 提醒中心与通知窗口
  try {
    const rendererUrl = process.env.VITE_DEV_SERVER_URL || `file://${join(__dirname, '../dist/index.html')}`;
    noticeWindow = new NoticeWindow({
      rendererUrl,
      preload: preloadPath
    });
    const center = createNoticeCenter({
      file: join(userData, 'notices.json')
    });
    installNoticeCenter(center);
  } catch (e) {
    console.error('[NoticeCenter] Init notice window failed:', e);
  }

  // 5. 注册 IPC 接口
  const trusted = (event: Electron.IpcMainInvokeEvent) => {
    if (event.sender !== win.webContents) {
      throw new Error('仅允许主窗口通信');
    }
  };

  // 基础窗口管理与请求
  ipcMain.handle('flowdesk:request', async (event, req: ApiRequest) => {
    trusted(event);
    if (!isAllowedRequest(req)) {
      throw new ApiError(403, '非白名单请求已被拦截');
    }
    return service.request(req);
  });

  ipcMain.handle('flowdesk:copy-text', (event, text: string) => {
    trusted(event);
    clipboard.writeText(String(text || ''));
    return true;
  });

  ipcMain.handle('flowdesk:version', () => app.getVersion());

  ipcMain.handle('flowdesk:open-official', (event, url: string) => {
    trusted(event);
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
  });

  ipcMain.handle('flowdesk:window:mode', (event, mode: string) => {
    trusted(event);
    if (mode === 'compact') {
      win.setSize(960, 680, true);
    } else if (mode === 'expanded') {
      win.setSize(1280, 860, true);
    } else if (mode === 'minimize') {
      win.minimize();
    } else if (mode === 'restore') {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  // 诊断报告
  ipcMain.handle('flowdesk:diagnostics:report', async (event) => {
    trusted(event);
    const { entries, storageOk } = diagLog.read();
    const ws = await service.request({ method: 'GET', path: '/state' }).catch(() => undefined);
    return buildDiagnosticReport({
      version: app.getVersion(),
      build: 'community',
      platform: process.platform,
      workspace: ws,
      entries,
      storageOk,
      modelTiming: timingBuffer.read()
    });
  });

  ipcMain.handle('flowdesk:diagnostics:copy', async (event) => {
    trusted(event);
    const { entries, storageOk } = diagLog.read();
    const ws = await service.request({ method: 'GET', path: '/state' }).catch(() => undefined);
    const report = buildDiagnosticReport({
      version: app.getVersion(),
      build: 'community',
      platform: process.platform,
      workspace: ws,
      entries,
      storageOk,
      modelTiming: timingBuffer.read()
    });
    clipboard.writeText(report);
    return report;
  });

  ipcMain.handle('flowdesk:diagnostics:record', async (_event, scope, code) => {
    await diagLog.record(scope, code);
  });

  // 开机自启动
  const loginItem = createLoginItem({
    file: join(userData, 'login-item.json'),
    packaged: app.isPackaged,
    platform: process.platform,
    get: () => app.getLoginItemSettings().openAtLogin,
    set: (on) => { app.setLoginItemSettings({ openAtLogin: on }); }
  });

  ipcMain.handle('flowdesk:login-item:state', async (event) => {
    trusted(event);
    return loginItem.state();
  });

  ipcMain.handle('flowdesk:login-item:set', async (event, on: boolean) => {
    trusted(event);
    return loginItem.setOn(on);
  });

  // 本地资料库
  const library = createKnowledgeLibrary({
    settingsFile: join(userData, 'library-settings.json'),
    documentsDir: app.getPath('documents'),
    request: (r) => service.request(r as ApiRequest),
    addFolder: async (path: string) => service.request({ method: 'POST', path: '/knowledge/sources', body: { kind: 'local', path } })
  });

  ipcMain.handle('flowdesk:library:status', (e) => { trusted(e); return library.status(); });
  ipcMain.handle('flowdesk:library:create', (e) => { trusted(e); return library.create(); });
  ipcMain.handle('flowdesk:library:choose', async (e) => {
    trusted(e);
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    if (res.canceled || !res.filePaths.length) return null;
    return library.create(res.filePaths[0]);
  });
  ipcMain.handle('flowdesk:library:open', async (e, which) => {
    trusted(e);
    const root = await library.root();
    if (root) void shell.openPath(which ? join(root, which) : root);
  });
  ipcMain.handle('flowdesk:library:sync', (e) => { trusted(e); return library.sync(true); });
  ipcMain.handle('flowdesk:library:backup-choose', async (e) => {
    trusted(e);
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    if (res.canceled || !res.filePaths.length) return null;
    return library.setBackupDir(res.filePaths[0]);
  });
  ipcMain.handle('flowdesk:library:backup-use', (e, p) => { trusted(e); return library.setBackupDir(p); });
  ipcMain.handle('flowdesk:library:backup-now', (e) => { trusted(e); return library.backup(); });
  ipcMain.handle('flowdesk:library:backup-clear', (e) => { trusted(e); return library.setBackupDir(undefined); });

  // 客户档案 IPC
  await registerCustomers({
    directory: userData,
    trusted,
    config: () => undefined,
    credentials: async () => {
      const s = await service.request({ method: 'GET', path: '/state' }) as any;
      return { baseUrl: s.provider.baseUrl, model: s.provider.model, apiKey: '' };
    },
    knowledge: async () => {
      const s = await service.request({ method: 'GET', path: '/state' }) as any;
      return s.knowledge ?? [];
    },
    send: async () => ({ error: '社区版跟进草稿仅支持手动复制发送' }),
    jobOutcome: () => undefined,
    receptionRunning: () => false,
    customerWaiting: () => false,
    alertAdmin: () => undefined,
    privateOk: () => true,
    codesReady: () => false,
    notify: () => {}
  });

  // 插件系统 IPC
  await registerPlugins({
    directory: userData,
    trusted,
    request: (r: ApiRequest) => service.request(r)
  });

  // 开放 MCP IPC
  ipcMain.handle('flowdesk:open:state', async (event) => {
    trusted(event);
    return openMcpServer ? openMcpServer.state() : { enabled: false, port: 0, token: '', listening: false, url: '', calls: 0, defaultCalls: 0, disabledTools: [], appTasks: false, clients: [] };
  });

  ipcMain.handle('flowdesk:open:save', async (event, patch) => {
    trusted(event);
    return openMcpServer ? openMcpServer.save(patch) : undefined;
  });

  ipcMain.handle('flowdesk:open:client-add', async (event, input) => {
    trusted(event);
    return openMcpServer ? openMcpServer.addClient(input) : undefined;
  });

  ipcMain.handle('flowdesk:open:client-remove', async (event, id) => {
    trusted(event);
    return openMcpServer ? openMcpServer.removeClient(id) : undefined;
  });

  ipcMain.handle('flowdesk:open:client-regenerate-key', async (event, id) => {
    trusted(event);
    return openMcpServer ? openMcpServer.regenerateClientKey(id) : undefined;
  });

  ipcMain.handle('flowdesk:open:client-copy-key', async (event, id) => {
    trusted(event);
    const key = openMcpServer ? openMcpServer.clientKey(id) : undefined;
    if (key) clipboard.writeText(key);
  });

  ipcMain.handle('flowdesk:open:client-set-app-tasks', async (event, id, allowed) => {
    trusted(event);
    return openMcpServer ? openMcpServer.setClientAppTasks(id, allowed) : undefined;
  });

  // 快捷键 IPC
  ipcMain.handle('flowdesk:shortcuts:state', async (event) => {
    trusted(event);
    return { stop: 'CommandOrControl+Alt+.', pause: 'CommandOrControl+Alt+P', registered: { stop: false, pause: false }, defaults: { stop: 'CommandOrControl+Alt+.', pause: 'CommandOrControl+Alt+P' } };
  });

  // 知识文件夹选择
  ipcMain.handle('flowdesk:knowledge:pick-folder', async (event) => {
    trusted(event);
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    if (res.canceled || !res.filePaths.length) return null;
    return service.request({ method: 'POST', path: '/knowledge/sources', body: { kind: 'local', path: res.filePaths[0] } });
  });

  ipcMain.handle('flowdesk:knowledge:pick-repo-folder', async (event) => {
    trusted(event);
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    if (res.canceled || !res.filePaths.length) return null;
    return service.request({ method: 'POST', path: '/knowledge/repos', body: { path: res.filePaths[0] } });
  });

  // 页面加载
  if (process.env.VITE_DEV_SERVER_URL) {
    await win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    const distIndex = join(__dirname, '../dist/index.html');
    if (existsSync(distIndex)) {
      await win.loadFile(distIndex);
    } else {
      await win.loadURL(`http://127.0.0.1:${process.env.FLOWDESK_PORT || 4318}`);
    }
  }

  win.once('ready-to-show', () => {
    win.show();
  });

  win.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(startApp).catch((e) => {
  console.error('[Main] Startup error:', e);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('before-quit', async () => {
  if (openMcpServer) {
    await openMcpServer.close().catch(() => {});
  }
  if (noticeWindow) {
    noticeWindow.destroy();
  }
});
