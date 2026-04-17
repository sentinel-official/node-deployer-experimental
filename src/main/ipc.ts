import { BrowserWindow, app, dialog, ipcMain, safeStorage, shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import QRCode from 'qrcode';
import AdmZip from 'adm-zip';
import {
  IPC,
  type AppSettings,
  type DeployProgress,
  type DeployRequest,
  type LocalSystemReport,
  type MetricsWindow,
  type NodeWithdrawRequest,
  type SSHCredentials,
  type SSHTestResult,
  type SendTxRequest,
  type UpdateNodePricingRequest,
} from '../shared/types';
import { testSSHConnection } from './services/ssh';
import { startDeploy, cancelDeploy, primeDeploySettings } from './services/deploy';
import {
  getWallet,
  createWallet,
  restoreWallet,
  refreshWalletBalance,
  sendTokens,
} from './services/wallet';
import {
  listNodes,
  getNode,
  removeNode,
  restartNode,
  startNode,
  stopNode,
  recentLogs,
  nodeStatus,
  nodeHistory,
  withdrawFromNode,
  updateNodePricing,
} from './services/nodes';
import { listEvents } from './services/events';
import { getSettings, updateSettings } from './services/settings';
import { dockerHealth } from './services/docker';
import { healthAll, invalidateHealthCache } from './services/sentinel-client';
import { logDir } from './services/logger';
import { readStore, writeStore } from './services/store';

function broadcast(channel: string, payload: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

async function reportLocalSystem(): Promise<LocalSystemReport> {
  const platform = os.platform();
  const memMb = Math.round(os.totalmem() / (1024 * 1024));
  const osLabel =
    platform === 'darwin'
      ? `macOS ${os.release()}`
      : platform === 'linux'
      ? `Linux ${os.release()}`
      : platform === 'win32'
      ? `Windows ${os.release()}`
      : `${platform} ${os.release()}`;

  const health = await dockerHealth();
  return {
    osCompatible: ['darwin', 'linux', 'win32'].includes(platform),
    osLabel,
    memoryMb: memMb,
    memoryOk: memMb >= 2048,
    diskFreeGb: 50,
    diskOk: true,
    dockerInstalled: health.reachable,
    dockerVersion: health.version,
    dockerReachable: health.reachable,
    dockerError: health.error,
  };
}

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.SYSTEM_REPORT, reportLocalSystem);

  // -- Settings --------------------------------------------------------------
  ipcMain.handle(IPC.SETTINGS_GET, () => getSettings());
  ipcMain.handle(IPC.SETTINGS_SET, async (_e, patch: Partial<AppSettings>) => {
    const next = await updateSettings(patch);
    invalidateHealthCache();
    await primeDeploySettings();
    return next;
  });
  ipcMain.handle(IPC.CHAIN_HEALTH, () => healthAll());

  // -- Wallet ----------------------------------------------------------------
  ipcMain.handle(IPC.WALLET_GET, () => getWallet());
  ipcMain.handle(IPC.WALLET_CREATE, () => createWallet());
  ipcMain.handle(IPC.WALLET_RESTORE, (_e, mnemonic: string) => restoreWallet(mnemonic));
  ipcMain.handle(IPC.WALLET_REFRESH_BALANCE, () => refreshWalletBalance());
  ipcMain.handle(IPC.WALLET_SEND, (_e, req: SendTxRequest) => sendTokens(req));
  ipcMain.handle(IPC.WALLET_QR, (_e, text: string) =>
    QRCode.toString(text, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
      color: { dark: '#0B1020', light: '#FFFFFF' },
    }),
  );

  // -- Events ----------------------------------------------------------------
  ipcMain.handle(IPC.EVENTS_LIST, (_e, limit?: number) => listEvents(limit));

  // -- SSH -------------------------------------------------------------------
  ipcMain.handle(
    IPC.SSH_TEST,
    (_e, creds: SSHCredentials): Promise<SSHTestResult> => testSSHConnection(creds),
  );

  // -- Deploy ----------------------------------------------------------------
  ipcMain.handle(IPC.DEPLOY_START, async (_e, req: DeployRequest) => {
    await primeDeploySettings();
    return startDeploy(req, (progress: DeployProgress) => {
      broadcast(IPC.DEPLOY_PROGRESS, progress);
    });
  });
  ipcMain.handle(IPC.DEPLOY_CANCEL, (_e, jobId: string) => cancelDeploy(jobId));

  // -- Nodes -----------------------------------------------------------------
  ipcMain.handle(IPC.NODES_LIST, () => listNodes());
  ipcMain.handle(IPC.NODES_GET, (_e, id: string) => getNode(id));
  ipcMain.handle(IPC.NODES_RESTART, (_e, id: string) => restartNode(id));
  ipcMain.handle(IPC.NODES_STOP, (_e, id: string) => stopNode(id));
  ipcMain.handle(IPC.NODES_START, (_e, id: string) => startNode(id));
  ipcMain.handle(IPC.NODES_REMOVE, (_e, id: string) => removeNode(id));
  ipcMain.handle(IPC.NODES_LOGS, (_e, id: string) => recentLogs(id));
  ipcMain.handle(IPC.NODES_STATUS, (_e, id: string) => nodeStatus(id));
  ipcMain.handle(IPC.NODES_HISTORY, (_e, id: string, window: MetricsWindow) =>
    nodeHistory(id, window),
  );
  ipcMain.handle(IPC.NODES_WITHDRAW, async (_e, req: NodeWithdrawRequest) => {
    const store = await readStore();
    const to = req.to ?? store.wallet?.address;
    if (!to) return { ok: false, error: 'No destination: app wallet not set up.' };
    return withdrawFromNode(req.nodeId, to, req.amountDVPN);
  });
  ipcMain.handle(IPC.NODES_UPDATE_PRICING, async (_e, req: UpdateNodePricingRequest) =>
    updateNodePricing(req.nodeId, req.gigabytePriceDVPN, req.hourlyPriceDVPN),
  );

  ipcMain.handle(IPC.NODES_BACKUP_MNEMONIC, async (_e, nodeId: string, mnemonic: string) => {
    if (!safeStorage.isEncryptionAvailable()) {
      return { ok: false, error: 'OS keychain unavailable — cannot back up.' };
    }
    const store = await readStore();
    store.nodeBackups[nodeId] = safeStorage.encryptString(mnemonic).toString('base64');
    await writeStore(store);
    return { ok: true };
  });

  // -- Diagnostics / online ---------------------------------------------------
  ipcMain.handle(IPC.SYSTEM_ONLINE, () => true); // Renderer-side probe is more meaningful
  ipcMain.handle(IPC.SYSTEM_DIAGNOSTICS, async () => {
    const { filePath } = await dialog.showSaveDialog({
      title: 'Export diagnostics',
      defaultPath: `sentinel-dvpn-diagnostics-${new Date().toISOString().split('T')[0]}.zip`,
      filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
    });
    if (!filePath) return { ok: false, cancelled: true };
    await exportDiagnostics(filePath);
    shell.showItemInFolder(filePath);
    return { ok: true, path: filePath };
  });
}

async function exportDiagnostics(targetZip: string): Promise<void> {
  const store = await readStore();
  const sanitizedStore = {
    wallet: store.wallet ? { address: store.wallet.address, createdAt: store.wallet.createdAt } : null,
    nodes: store.nodes.map((n) => ({
      id: n.id,
      moniker: n.moniker,
      target: n.target,
      status: n.status,
      operatorAddress: n.operatorAddress,
      createdAt: n.createdAt,
      host: n.host,
      port: n.port,
    })),
    eventsLast50: store.events.slice(0, 50),
  };
  const settings = await getSettings();

  const zip = new AdmZip();
  zip.addFile(
    'meta.json',
    Buffer.from(
      JSON.stringify(
        {
          version: app.getVersion(),
          platform: process.platform,
          arch: process.arch,
          electron: process.versions.electron,
          node: process.versions.node,
          chromium: process.versions.chrome,
          ts: new Date().toISOString(),
        },
        null,
        2,
      ),
    ),
  );
  zip.addFile('store.json', Buffer.from(JSON.stringify(sanitizedStore, null, 2)));
  zip.addFile('settings.json', Buffer.from(JSON.stringify(settings, null, 2)));
  try {
    const files = await fs.readdir(logDir());
    for (const f of files) {
      const contents = await fs.readFile(path.join(logDir(), f));
      zip.addFile(`logs/${f}`, contents);
    }
  } catch {
    /* no logs yet */
  }
  zip.writeZip(targetZip);
}
