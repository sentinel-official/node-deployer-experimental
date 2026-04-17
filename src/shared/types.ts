/**
 * Types shared between the Electron main process, the preload bridge,
 * and the React renderer. Nothing in this file should import Node/Electron
 * or DOM APIs so it can be safely consumed by either side.
 */

export type NodeStatus = 'online' | 'offline' | 'loading' | 'error';

export type NodeDeployTarget = 'local' | 'remote';

export type VpnServiceType = 'wireguard' | 'v2ray';

export interface DeployedNode {
  id: string;
  name: string;
  moniker: string;
  target: NodeDeployTarget;
  host?: string;
  region?: string;
  status: NodeStatus;
  createdAt: string;
  /** The on-chain operator address that sentinel-dvpnx generated during init. */
  operatorAddress: string;
  /** Last observed on-chain DVPN balance for the operator address. */
  balanceDVPN: number;
  port: number;
  /** Pricing configured at deploy time (display-friendly DVPN units). */
  gigabytePriceDVPN: number;
  hourlyPriceDVPN: number;
  serviceType: VpnServiceType;
  /** Docker container id (local) OR systemd unit name (remote). */
  runtimeId?: string;
  /** True once `sentinel-dvpnx` has reported status to the chain. */
  registeredOnChain: boolean;
  /** Publicly reachable URL of the node's API (for wallet clients). */
  remoteUrl?: string;
  /** ISO timestamp of when the node process most recently started (persisted). */
  startedAt?: string;
}

export interface UpdateNodePricingRequest {
  nodeId: string;
  gigabytePriceDVPN: number;
  hourlyPriceDVPN: number;
}

export interface WalletState {
  address: string | null;
  balanceDVPN: number;
  createdAt: string | null;
  /** True if the encrypted mnemonic file exists on disk. */
  hasMnemonic: boolean;
}

export interface NodeLiveStatus {
  nodeId: string;
  reachable: boolean;
  /** Currently-open VPN sessions against this node (from on-chain query). */
  sessions: number;
  bytesOut: number;
  bytesIn: number;
  /** Uptime (ms) of the node process, persisted across app restarts. */
  uptimeMs: number;
  chainHeight?: number;
  /** Probe latency from the app to the on-chain data source. */
  apiLatencyMs?: number;
  /** Tail of the container / node logs (~last 200 lines). */
  logTail: string[];
  /** Sentinel's lifecycle status as seen on chain (inactive / active / active_pending). */
  chainStatus?: string;
  /** Node's `sentnode1…` address on chain. */
  chainAddress?: string;
  /** `statusAt` ISO timestamp from the node proto — last time the node reported. */
  lastStatusAt?: string;
  /** Active subscription summary parsed from the subscription query. */
  activeSubscriptions: NodeSession[];
  /** Null when everything is fine. */
  error?: string;
}

export interface NodeSession {
  id: string;
  subscriber: string;
  subscriberShort: string;
  bytesIn: number;
  bytesOut: number;
  durationSeconds: number;
  status?: string;
}

export interface SSHCredentials {
  host: string;
  port: number;
  username: string;
  /** Exactly one of password / privateKey is required. */
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

export interface SSHTestResult {
  ok: boolean;
  message: string;
  osInfo?: string;
  latencyMs?: number;
}

export type DeployPhase =
  | 'connecting'
  | 'preflight'
  | 'docker-check'
  | 'image-build'
  | 'keygen'
  | 'configure'
  | 'starting'
  | 'verifying'
  | 'done'
  | 'error';

export interface DeployProgress {
  jobId: string;
  nodeId: string;
  phase: DeployPhase;
  percent: number;
  message: string;
  log: string;
  /** Populated on the keygen phase so the UI can prompt the user to write it down. */
  mnemonicForBackup?: string;
  operatorAddress?: string;
}

export interface LocalSystemReport {
  osCompatible: boolean;
  osLabel: string;
  memoryMb: number;
  memoryOk: boolean;
  diskFreeGb: number;
  diskOk: boolean;
  dockerInstalled: boolean;
  dockerVersion?: string;
  dockerReachable: boolean;
  dockerError?: string;
}

export interface DeployRequest {
  target: NodeDeployTarget;
  moniker: string;
  gigabytePriceDVPN: number;
  hourlyPriceDVPN: number;
  serviceType: VpnServiceType;
  port: number;
  /** Optional public URL for remote hosts (e.g. `https://1.2.3.4:7777`). */
  remoteUrl?: string;
  /** Required when target === 'remote'. */
  ssh?: SSHCredentials;
}

export type EventKind =
  | 'wallet-created'
  | 'wallet-restored'
  | 'deploy-started'
  | 'deploy-succeeded'
  | 'deploy-failed'
  | 'node-stopped'
  | 'node-restarted'
  | 'node-removed'
  | 'node-unreachable'
  | 'node-online'
  | 'node-registered'
  | 'withdraw-sent'
  | 'withdraw-failed'
  | 'balance-refreshed';

export interface AppEvent {
  id: string;
  kind: EventKind;
  title: string;
  subtitle: string;
  timestamp: string;
  amountDVPN?: number;
  relatedNodeId?: string;
  txHash?: string;
}

export interface SendTxRequest {
  to: string;
  amountDVPN: number;
  memo?: string;
}

export interface NodeWithdrawRequest {
  nodeId: string;
  /** Defaults to the app wallet's own address. */
  to?: string;
  /** If omitted, the full node balance minus gas is withdrawn. */
  amountDVPN?: number;
}

export interface SendTxResult {
  ok: boolean;
  txHash?: string;
  height?: number;
  gasUsed?: number;
  error?: string;
  /** Classified error code so the UI can show a helpful message. */
  errorCode?:
    | 'insufficient-funds'
    | 'sequence-mismatch'
    | 'invalid-address'
    | 'timeout'
    | 'rpc-unavailable'
    | 'chain-mismatch'
    | 'gas-estimation-failed'
    | 'unknown';
}

export interface ChainHealth {
  rpcUrl: string;
  reachable: boolean;
  latencyMs?: number;
  chainId?: string;
  blockHeight?: number;
  error?: string;
}

export interface AppSettings {
  /** Comma-separated list of RPC URLs; app round-robins for health. */
  rpcUrls: string[];
  chainId: string;
  gasPriceUdvpn: string;
  /** Explicit override — if blank the app probes the Docker daemon. */
  dockerSocket: string;
  /** Cosmetic toggle only; persisted across launches. */
  seenOnboarding: boolean;
}

export interface MetricsSample {
  nodeId: string;
  ts: number; // unix ms
  peers: number;
  bytesIn: number;
  bytesOut: number;
  earningsUdvpn: number;
  chainHeight?: number;
  reachable: boolean;
}

export type MetricsWindow = '1h' | '24h' | '7d' | '30d';

export interface DiagnosticsArtifact {
  path: string;
  sizeBytes: number;
}

/** Channel names used for all renderer <-> main IPC. */
export const IPC = {
  // System / environment
  SYSTEM_REPORT: 'system:report',
  SYSTEM_ONLINE: 'system:online',
  SYSTEM_DIAGNOSTICS: 'system:diagnostics',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  CHAIN_HEALTH: 'chain:health',

  // Wallet
  WALLET_GET: 'wallet:get',
  WALLET_CREATE: 'wallet:create',
  WALLET_RESTORE: 'wallet:restore',
  WALLET_REFRESH_BALANCE: 'wallet:refresh-balance',
  WALLET_SEND: 'wallet:send',
  WALLET_QR: 'wallet:qr',

  // Events
  EVENTS_LIST: 'events:list',
  EVENTS_CHANGED: 'events:changed', // main -> renderer push

  // SSH helpers for remote deploy
  SSH_TEST: 'ssh:test',

  // Deploy lifecycle
  DEPLOY_START: 'deploy:start',
  DEPLOY_CANCEL: 'deploy:cancel',
  DEPLOY_PROGRESS: 'deploy:progress', // main -> renderer push

  // Node management
  NODES_LIST: 'nodes:list',
  NODES_GET: 'nodes:get',
  NODES_RESTART: 'nodes:restart',
  NODES_STOP: 'nodes:stop',
  NODES_START: 'nodes:start',
  NODES_REMOVE: 'nodes:remove',
  NODES_LOGS: 'nodes:logs',
  NODES_STATUS: 'nodes:status',
  NODES_HISTORY: 'nodes:history',
  NODES_WITHDRAW: 'nodes:withdraw',
  NODES_BACKUP_MNEMONIC: 'nodes:backup-mnemonic',
  NODES_UPDATE_PRICING: 'nodes:update-pricing',
  NODES_CHANGED: 'nodes:changed', // main -> renderer push
} as const;

export type IPCChannel = (typeof IPC)[keyof typeof IPC];
