import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import { IPC_UPDATER, type UpdateInfo } from '../../shared/updater-types';
import { log } from './logger';

/**
 * Auto-updater.
 *
 * We publish releases to GitHub Releases (configured in electron-builder.yml
 * via the default `github` provider). The renderer can:
 *   • query current status via `updater:status`
 *   • manually trigger a check via `updater:check`
 *   • invoke `updater:install` to quit + install a downloaded update
 *
 * Builds without a GitHub release channel (dev / unsigned local) simply
 * have the checks no-op with a clear status value.
 */

type Stage = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error' | 'up-to-date';

interface State {
  stage: Stage;
  version?: string;
  percent?: number;
  error?: string;
  checkedAt?: number;
}

let state: State = { stage: 'idle' };

function broadcast(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC_UPDATER.CHANGED, state);
  }
}

function update(partial: Partial<State>): void {
  state = { ...state, ...partial };
  broadcast();
}

export function startUpdater(): void {
  // In dev (unpackaged) electron-updater throws on init; skip entirely.
  if (!app.isPackaged) {
    update({ stage: 'idle', error: 'Dev mode — updater disabled' });
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = log;

  autoUpdater.on('checking-for-update', () => update({ stage: 'checking' }));
  autoUpdater.on('update-available', (info: UpdateInfo) =>
    update({ stage: 'downloading', version: info.version, percent: 0 }),
  );
  autoUpdater.on('update-not-available', () =>
    update({ stage: 'up-to-date', checkedAt: Date.now() }),
  );
  autoUpdater.on('download-progress', (p) =>
    update({ stage: 'downloading', percent: Math.round(p.percent) }),
  );
  autoUpdater.on('update-downloaded', (info: UpdateInfo) =>
    update({ stage: 'ready', version: info.version, percent: 100 }),
  );
  autoUpdater.on('error', (err: Error) =>
    update({ stage: 'error', error: err.message }),
  );

  ipcMain.handle(IPC_UPDATER.STATUS, () => state);
  ipcMain.handle(IPC_UPDATER.CHECK, async () => {
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      update({ stage: 'error', error: (err as Error).message });
    }
    return state;
  });
  ipcMain.handle(IPC_UPDATER.INSTALL, async () => {
    if (state.stage !== 'ready') return { ok: false, error: 'No update ready' };
    // Ask the user before quitting.
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const choice = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Install + restart', 'Later'],
      defaultId: 0,
      cancelId: 1,
      message: `Install Sentinel dVPN v${state.version}?`,
      detail: 'The app will quit and reopen on the new version.',
    });
    if (choice.response === 0) {
      setImmediate(() => autoUpdater.quitAndInstall());
    }
    return { ok: choice.response === 0 };
  });

  // Quiet initial check once the window has painted.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      update({ stage: 'error', error: String(err) });
    });
  }, 15_000);
}
