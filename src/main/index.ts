import { app, BrowserWindow, crashReporter, shell } from 'electron';
import path from 'node:path';
import { registerIpcHandlers } from './ipc';
import { attachGlobalHandlers, log, logDir } from './services/logger';
import { startPoller, stopPoller } from './services/node-manager';
import { refreshWalletBalance } from './services/wallet';
import { primeDeploySettings } from './services/deploy';
import { startUpdater } from './services/updater';

// `__dirname` is available in CJS output.

attachGlobalHandlers();
crashReporter.start({
  productName: 'Sentinel dVPN',
  submitURL: '',        // no remote submit; we store dumps locally
  uploadToServer: false,
  compress: true,
});

// Single-instance lock — avoids two app windows racing to manage the same node.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1060,
    minHeight: 720,
    title: 'Sentinel dVPN',
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

app.whenReady().then(async () => {
  log.info('app ready', {
    version: app.getVersion(),
    platform: process.platform,
    logs: logDir(),
  });

  await primeDeploySettings();
  registerIpcHandlers();
  startUpdater();
  startPoller();

  const win = createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  balancePoll = setInterval(() => {
    void refreshWalletBalance().catch((err) => log.debug('balance poll skipped', { err: String(err) }));
  }, 60_000);

  void win;
});

app.on('window-all-closed', () => {
  if (balancePoll) clearInterval(balancePoll);
  stopPoller();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  log.info('app quitting');
});
