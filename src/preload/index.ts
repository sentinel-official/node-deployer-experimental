import { contextBridge, ipcRenderer } from 'electron';
import { IPC_UPDATER, type UpdaterState } from '../shared/updater-types';
import {
  IPC,
  type AppEvent,
  type AppSettings,
  type ChainHealth,
  type CliRunResult,
  type CliServerState,
  type CliStreamEvent,
  type DeployProgress,
  type DockerOverview,
  type DeployRequest,
  type DeployedNode,
  type LiveSystemStats,
  type LocalSystemReport,
  type MetricsSample,
  type MetricsWindow,
  type MnemonicExportResult,
  type NodeLiveStatus,
  type NodeLiveStatusUpdate,
  type NodeLogExportRequest,
  type NodeLogExportResult,
  type NodeWithdrawRequest,
  type SSHCredentials,
  type SSHTestResult,
  type SendTxRequest,
  type SendTxResult,
  type UpdateNodePricingRequest,
  type WalletState,
} from '../shared/types';

const subscribe = <T,>(channel: string, cb: (payload: T) => void): (() => void) => {
  const listener = (_evt: unknown, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

const api = {
  platform: process.platform as NodeJS.Platform,

  system: {
    report: (): Promise<LocalSystemReport> => ipcRenderer.invoke(IPC.SYSTEM_REPORT),
    exportDiagnostics: (): Promise<{ ok: boolean; path?: string; cancelled?: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.SYSTEM_DIAGNOSTICS),
    startLiveStats: (): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.SYSTEM_LIVE_STATS_START),
    stopLiveStats: (): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.SYSTEM_LIVE_STATS_STOP),
    onLiveStats: (cb: (s: LiveSystemStats) => void) =>
      subscribe<LiveSystemStats>(IPC.SYSTEM_LIVE_STATS, cb),
  },

  docker: {
    /**
     * Attempt to start Docker Desktop (Windows/macOS only). The call
     * returns as soon as the launcher is spawned — the daemon itself
     * takes 10–30 s to come up, so callers should poll `system.report()`
     * afterwards to detect when the engine becomes reachable.
     */
    start: (): Promise<{ started: boolean; launchPath?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.DOCKER_START),
    overview: (): Promise<DockerOverview> => ipcRenderer.invoke(IPC.DOCKER_OVERVIEW),
    quit: (): Promise<{ quit: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.DOCKER_QUIT),
    forceQuit: (): Promise<{
      quit: boolean;
      steps: { name: string; ok: boolean; detail?: string }[];
      error?: string;
    }> => ipcRenderer.invoke(IPC.DOCKER_FORCE_QUIT),
    stopAllSentinel: (): Promise<{ stopped: number; failed: number }> =>
      ipcRenderer.invoke(IPC.DOCKER_STOP_ALL_SENTINEL),
    prune: (): Promise<{ removed: number; reclaimedBytes: number }> =>
      ipcRenderer.invoke(IPC.DOCKER_PRUNE),
    openSettings: (): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.DOCKER_OPEN_SETTINGS),
  },

  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.SETTINGS_GET),
    set: (patch: Partial<AppSettings>): Promise<AppSettings> => ipcRenderer.invoke(IPC.SETTINGS_SET, patch),
    chainHealth: (): Promise<ChainHealth[]> => ipcRenderer.invoke(IPC.CHAIN_HEALTH),
  },

  wallet: {
    get: (): Promise<WalletState> => ipcRenderer.invoke(IPC.WALLET_GET),
    create: (): Promise<{ wallet: WalletState; mnemonic: string }> =>
      ipcRenderer.invoke(IPC.WALLET_CREATE),
    restore: (mnemonic: string): Promise<WalletState> =>
      ipcRenderer.invoke(IPC.WALLET_RESTORE, mnemonic),
    refreshBalance: (): Promise<WalletState> => ipcRenderer.invoke(IPC.WALLET_REFRESH_BALANCE),
    send: (req: SendTxRequest): Promise<SendTxResult> => ipcRenderer.invoke(IPC.WALLET_SEND, req),
    qrSvg: (text: string): Promise<string> => ipcRenderer.invoke(IPC.WALLET_QR, text),
    logout: (): Promise<void> => ipcRenderer.invoke(IPC.WALLET_LOGOUT),
  },

  events: {
    list: (limit?: number): Promise<AppEvent[]> => ipcRenderer.invoke(IPC.EVENTS_LIST, limit),
    onChanged: (cb: (e: AppEvent) => void) => subscribe<AppEvent>(IPC.EVENTS_CHANGED, cb),
  },

  updater: {
    status: (): Promise<UpdaterState> => ipcRenderer.invoke(IPC_UPDATER.STATUS),
    check: (): Promise<UpdaterState> => ipcRenderer.invoke(IPC_UPDATER.CHECK),
    install: (): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC_UPDATER.INSTALL),
    onChanged: (cb: (s: UpdaterState) => void) =>
      subscribe<UpdaterState>(IPC_UPDATER.CHANGED, cb),
  },

  ssh: {
    test: (creds: SSHCredentials): Promise<SSHTestResult> => ipcRenderer.invoke(IPC.SSH_TEST, creds),
    forgetHostKey: (req: { host: string; port?: number }): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.SSH_FORGET_HOST_KEY, req),
  },

  deploy: {
    start: (req: DeployRequest): Promise<{ jobId: string; nodeId: string }> =>
      ipcRenderer.invoke(IPC.DEPLOY_START, req),
    cancel: (jobId: string): Promise<boolean> => ipcRenderer.invoke(IPC.DEPLOY_CANCEL, jobId),
    status: (jobId?: string): Promise<DeployProgress | DeployProgress[] | null> =>
      ipcRenderer.invoke(IPC.DEPLOY_STATUS, jobId),
    onProgress: (cb: (p: DeployProgress) => void) => subscribe<DeployProgress>(IPC.DEPLOY_PROGRESS, cb),
  },

  nodes: {
    list: (): Promise<DeployedNode[]> => ipcRenderer.invoke(IPC.NODES_LIST),
    get: (id: string): Promise<DeployedNode | null> => ipcRenderer.invoke(IPC.NODES_GET, id),
    start: (id: string): Promise<void> => ipcRenderer.invoke(IPC.NODES_START, id),
    restart: (id: string): Promise<void> => ipcRenderer.invoke(IPC.NODES_RESTART, id),
    stop: (id: string): Promise<void> => ipcRenderer.invoke(IPC.NODES_STOP, id),
    remove: (id: string): Promise<void> => ipcRenderer.invoke(IPC.NODES_REMOVE, id),
    reapStuck: (): Promise<number> => ipcRenderer.invoke(IPC.NODES_REAP_STUCK),
    logs: (id: string): Promise<string[]> => ipcRenderer.invoke(IPC.NODES_LOGS, id),
    exportLogs: (req: NodeLogExportRequest): Promise<NodeLogExportResult> =>
      ipcRenderer.invoke(IPC.NODES_EXPORT_LOGS, req),
    status: (id: string): Promise<NodeLiveStatus> => ipcRenderer.invoke(IPC.NODES_STATUS, id),
    history: (id: string, window: MetricsWindow): Promise<MetricsSample[]> =>
      ipcRenderer.invoke(IPC.NODES_HISTORY, id, window),
    withdraw: (req: NodeWithdrawRequest): Promise<SendTxResult> =>
      ipcRenderer.invoke(IPC.NODES_WITHDRAW, req),
    updatePricing: (req: UpdateNodePricingRequest): Promise<SendTxResult> =>
      ipcRenderer.invoke(IPC.NODES_UPDATE_PRICING, req),
    publishSpecs: (
      nodeId: string,
      opts?: { force?: boolean },
    ): Promise<{ ok: boolean; txHash?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.NODES_PUBLISH_SPECS, nodeId, opts),
    backupMnemonic: (nodeId: string, mnemonic: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.NODES_BACKUP_MNEMONIC, nodeId, mnemonic),
    exportMnemonic: (nodeId: string, mnemonic: string): Promise<MnemonicExportResult> =>
      ipcRenderer.invoke(IPC.NODES_EXPORT_MNEMONIC, nodeId, mnemonic),
    revealMnemonic: (
      nodeId: string,
    ): Promise<{ ok: true; mnemonic: string } | { ok: false; error: string }> =>
      ipcRenderer.invoke(IPC.NODES_REVEAL_MNEMONIC, nodeId),
    onChanged: (cb: () => void) => subscribe<null>(IPC.NODES_CHANGED, () => cb()),
    onLiveStatus: (cb: (u: NodeLiveStatusUpdate) => void) =>
      subscribe<NodeLiveStatusUpdate>(IPC.NODES_LIVE_STATUS, cb),
  },

  cli: {
    status: (): Promise<CliServerState> => ipcRenderer.invoke(IPC.CLI_STATUS),
    start: (): Promise<CliServerState> => ipcRenderer.invoke(IPC.CLI_START),
    stop: (): Promise<CliServerState> => ipcRenderer.invoke(IPC.CLI_STOP),
    run: (line: string): Promise<CliRunResult> => ipcRenderer.invoke(IPC.CLI_RUN, line),
    openPowerShell: (): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.CLI_OPEN_POWERSHELL),
    onStateChanged: (cb: (s: CliServerState) => void) =>
      subscribe<CliServerState>(IPC.CLI_STATE_CHANGED, cb),
    onStream: (cb: (e: CliStreamEvent) => void) =>
      subscribe<CliStreamEvent>(IPC.CLI_STREAM, cb),
  },
} as const;

export type AppAPI = typeof api;

contextBridge.exposeInMainWorld('api', api);
