import { app, BrowserWindow, crashReporter, nativeImage, shell } from 'electron';
import path from 'node:path';
import { registerIpcHandlers } from './ipc';
import { attachGlobalHandlers, log, logDir } from './services/logger';
import { startPoller, stopPoller } from './services/node-manager';
import { refreshWalletBalance } from './services/wallet';
import { primeDeploySettings } from './services/deploy';
import { startUpdater } from './services/updater';
import { getSettings } from './services/settings';
import { isCliServerRunning, startCliServer, stopCliServer } from './services/cli-server';
import type { AppSettings } from '../shared/types';
import {
  createAppTray,
  destroyAppTray,
  isQuittingForReal,
  isTrayActive,
  markQuittingForReal,
  maybeShowTrayHint,
} from './services/tray';

function resolveAppIcon(): Electron.NativeImage | undefined {
  const candidates =
    process.platform === 'win32'
      ? ['icon.ico', 'icon.png']
      : process.platform === 'darwin'
        ? ['icon.icns', 'icon.png']
        : ['icon.png'];
  const roots = [
    path.join(process.resourcesPath ?? '', 'build'),
    path.join(app.getAppPath(), 'build'),
    path.join(__dirname, '..', '..', 'build'),
  ];
  for (const root of roots) {
    for (const name of candidates) {
      const p = path.join(root, name);
      const img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) return img;
    }
  }
  return undefined;
}

// `__dirname` is available in CJS output.

attachGlobalHandlers();
crashReporter.start({
  productName: 'Sentinel Node Manager',
  submitURL: '',        // no remote submit; we store dumps locally
  uploadToServer: false,
  compress: true,
});

// Single-instance lock — avoids two app windows racing to manage the same node.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function createWindow(): BrowserWindow {
  const icon = resolveAppIcon();
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1060,
    minHeight: 720,
    title: 'Sentinel Node Manager',
    icon,
    backgroundColor: '#0B1020',
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.on('ready-to-show', () => win.show());
  win.on('page-title-updated', (e) => e.preventDefault());

  win.on('close', (e) => {
    if (isQuittingForReal()) return;
    if (!currentSettingsSnapshot?.minimizeToTrayOnClose) return;
    // If the tray failed to materialise (missing icon assets on an exotic
    // build), don't trap the user with a window they can't reopen.
    if (!isTrayActive()) return;
    e.preventDefault();
    win.hide();
    void maybeShowTrayHint();
    void getSettings().then((s) => {
      currentSettingsSnapshot = s;
    }).catch((err) => log.debug('refresh settings snapshot failed', { err: String(err) }));
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  return win;
}

let balancePoll: NodeJS.Timeout | null = null;
let currentSettingsSnapshot: AppSettings | null = null;

app.whenReady().then(async () => {
  log.info('app ready', {
    version: app.getVersion(),
    platform: process.platform,
    logs: logDir(),
  });

  try {
    await primeDeploySettings();
  } catch (err) {
    log.warn('primeDeploySettings failed', { err: String(err) });
  }
  try {
    currentSettingsSnapshot = await getSettings();
  } catch (err) {
    log.warn('initial getSettings failed', { err: String(err) });
  }
  registerIpcHandlers();
  if (process.env.SNM_AUTO_START_CLI === '1') {
    try {
      await startCliServer();
      log.info('cli server auto-started via SNM_AUTO_START_CLI');
    } catch (err) {
      log.warn('cli auto-start failed', { err: String(err) });
    }
  }
  try {
    startUpdater();
  } catch (err) {
    log.warn('startUpdater failed', { err: String(err) });
  }
  try {
    startPoller();
  } catch (err) {
    log.warn('startPoller failed', { err: String(err) });
  }

  const win = createWindow();
  try {
    createAppTray(() => BrowserWindow.getAllWindows()[0] ?? null);
  } catch (err) {
    log.warn('tray setup failed', { err: String(err) });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else BrowserWindow.getAllWindows()[0]?.show();
  });

  balancePoll = setInterval(() => {
    void refreshWalletBalance().catch((err) => log.debug('balance poll skipped', { err: String(err) }));
  }, 60_000);

  void win;
}).catch((err) => {
  log.error('whenReady init failed', { err: String(err) });
});

app.on('window-all-closed', () => {
  // With tray minimize enabled, the window can be hidden without the app
  // exiting — keep the poller alive so earnings/peers stay fresh. If the
  // user explicitly picks "Quit" from the tray we flip `isQuittingForReal`
  // and fall through to the normal cleanup.
  if (!isQuittingForReal() && currentSettingsSnapshot?.minimizeToTrayOnClose) return;
  if (balancePoll) clearInterval(balancePoll);
  stopPoller();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  markQuittingForReal();
  log.info('app quitting');
  if (balancePoll) clearInterval(balancePoll);
  stopPoller();
  destroyAppTray();
  // Stop the CLI server if the user opted in (default true). Best-effort —
  // we don't await here because before-quit is synchronous; the underlying
  // server.close() runs to completion as the event loop drains.
  if (isCliServerRunning() && currentSettingsSnapshot?.stopCliServerOnQuit !== false) {
    void stopCliServer().catch((err) =>
      log.debug('stopCliServer on quit failed', { err: String(err) }),
    );
  }
});
