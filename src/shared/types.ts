/**
 * Types shared between the Electron main process, the preload bridge,
 * and the React renderer. Nothing in this file should import Node/Electron
 * or DOM APIs so it can be safely consumed by either side.
 */

export type NodeStatus = 'online' | 'offline' | 'loading' | 'error';

export type NodeDeployTarget = 'local' | 'remote';

export type VpnServiceType = 'wireguard' | 'v2ray';

/**
 * How the node quotes its gigabyte/hour prices on chain.
 *
 * - `'flat'` (default): the udvpn fields are the literal price the node
 *   advertises. Predictable revenue in DVPN, swings in fiat value.
 * - `'oracle'`: the chain's Hub-v12 oracle module multiplies the USD
 *   target by the DVPN spot price at session-settlement time. Predictable
 *   USD revenue, DVPN amount floats. The udvpn fields become the fallback
 *   the node uses when the oracle feed is offline.
 */
export type PriceMode = 'flat' | 'oracle';

export interface DeployedNode {
  id: string;
  name: string;
  moniker: string;
  target: NodeDeployTarget;
  host?: string;
  region?: string;
  /** ISO-3166-1 alpha-2 country code resolved via geoip (e.g. 'US', 'DE'). */
  country?: string;
  /** Human-readable country name matching `country` (e.g. 'United States'). */
  countryName?: string;
  status: NodeStatus;
  createdAt: string;
  /** The on-chain operator address that sentinel-dvpnx generated during init. */
  operatorAddress: string;
  /** Last observed on-chain DVPN balance for the operator address. */
  balanceDVPN: number;
  port: number;
  /** Pricing configured at deploy time (display-friendly DVPN units).
   *  When `priceMode === 'oracle'`, these are the udvpn fallback the node
   *  uses if the oracle is offline; the primary price is `usdGigabytePrice`
   *  / `usdHourlyPrice`. */
  gigabytePriceDVPN: number;
  hourlyPriceDVPN: number;
  /** Pricing mode. Defaults to `'flat'` for nodes deployed before the
   *  oracle option existed (field will be undefined in old records). */
  priceMode?: PriceMode;
  /** USD target per GB. Only meaningful when `priceMode === 'oracle'`. */
  usdGigabytePrice?: number;
  /** USD target per hour. Only meaningful when `priceMode === 'oracle'`. */
  usdHourlyPrice?: number;
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
  /** udvpn-denominated values. In oracle mode these become the fallback. */
  gigabytePriceDVPN: number;
  hourlyPriceDVPN: number;
  priceMode?: PriceMode;
  usdGigabytePrice?: number;
  usdHourlyPrice?: number;
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
  | 'error'
  | 'cancelled';

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

export type DockerUnreachableReason =
  | 'desktop-not-installed'
  | 'desktop-not-running'
  | 'engine-not-running';

export interface DockerDesktopStatus {
  /** Docker Desktop is installed on disk (Windows/macOS). Always false on Linux. */
  installed: boolean;
  launchPath?: string;
  /** True if we can start it from the app (Windows/macOS only). */
  startable: boolean;
}

export interface SentinelContainerSummary {
  id: string;
  name: string;
  state: string;
  status: string;
  image: string;
  createdUnix: number;
}

export interface SentinelImageSummary {
  id: string;
  tag: string;
  sizeBytes: number;
  createdUnix: number;
}

export interface DockerOverview {
  reachable: boolean;
  version?: string;
  apiVersion?: string;
  os?: string;
  arch?: string;
  kernel?: string;
  serverTime?: string;
  totalMemoryMb?: number;
  ncpu?: number;
  rootDir?: string;
  containers: { total: number; running: number; paused: number; stopped: number };
  images: { count: number; sizeBytes: number };
  sentinelContainers: SentinelContainerSummary[];
  sentinelImages: SentinelImageSummary[];
  desktop?: DockerDesktopStatus;
  error?: string;
  reason?: DockerUnreachableReason;
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
  /** Why the daemon isn't reachable, if !dockerReachable. Lets UI show the right recovery action. */
  dockerReason?: DockerUnreachableReason;
  /** Install / launch state for Docker Desktop, if applicable. */
  dockerDesktop?: DockerDesktopStatus;
}

export interface DeployRequest {
  target: NodeDeployTarget;
  moniker: string;
  gigabytePriceDVPN: number;
  hourlyPriceDVPN: number;
  /** Pricing mode. Defaults to `'flat'` (current behaviour) when omitted. */
  priceMode?: PriceMode;
  /** USD target per GB. Required when `priceMode === 'oracle'`. */
  usdGigabytePrice?: number;
  /** USD target per hour. Required when `priceMode === 'oracle'`. */
  usdHourlyPrice?: number;
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
  | 'wallet-logout'
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
  /**
   * When true, closing the window hides it to the system tray instead of
   * quitting. The user explicitly picks "Quit" from the tray to exit.
   * Containers are never touched by close/hide — they follow their own
   * lifecycle so earnings aren't interrupted when the dashboard is closed.
   */
  minimizeToTrayOnClose: boolean;
  /**
   * When true, picking "Quit" from the tray menu also docker-stops every
   * running node before exiting. Off by default because most operators
   * want the node to keep earning even when the manager isn't running.
   */
  stopNodesOnQuit: boolean;
  /**
   * One-time flag — set to true once we've shown the "still running in
   * the tray" toast, so we don't nag the user every close.
   */
  trayHintShown: boolean;
  /**
   * When true, stops the local CLI server when the app quits. When false,
   * the server keeps running so already-connected PowerShell / agent
   * sessions aren't yanked out from under the user.
   */
  stopCliServerOnQuit: boolean;
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

export type NodeLogExportFormat = 'txt' | 'json' | 'log';

export interface NodeLogExportRequest {
  nodeId: string;
  format: NodeLogExportFormat;
  /** Raw log lines captured by the renderer (ANSI-stripped by the writer). */
  lines: string[];
}

export interface NodeLogExportResult {
  ok: boolean;
  path?: string;
  cancelled?: boolean;
  error?: string;
}

/** Channel names used for all renderer <-> main IPC. */
export const IPC = {
  // System / environment
  SYSTEM_REPORT: 'system:report',
  SYSTEM_ONLINE: 'system:online',
  SYSTEM_DIAGNOSTICS: 'system:diagnostics',
  DOCKER_START: 'docker:start',
  DOCKER_OVERVIEW: 'docker:overview',
  DOCKER_QUIT: 'docker:quit',
  DOCKER_FORCE_QUIT: 'docker:force-quit',
  DOCKER_STOP_ALL_SENTINEL: 'docker:stop-all-sentinel',
  DOCKER_PRUNE: 'docker:prune',

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
  WALLET_LOGOUT: 'wallet:logout',

  // Events
  EVENTS_LIST: 'events:list',
  EVENTS_CHANGED: 'events:changed', // main -> renderer push

  // SSH helpers for remote deploy
  SSH_TEST: 'ssh:test',

  // Deploy lifecycle
  DEPLOY_START: 'deploy:start',
  DEPLOY_CANCEL: 'deploy:cancel',
  DEPLOY_STATUS: 'deploy:status',
  DEPLOY_PROGRESS: 'deploy:progress', // main -> renderer push

  // Node management
  NODES_LIST: 'nodes:list',
  NODES_GET: 'nodes:get',
  NODES_RESTART: 'nodes:restart',
  NODES_STOP: 'nodes:stop',
  NODES_START: 'nodes:start',
  NODES_REMOVE: 'nodes:remove',
  NODES_LOGS: 'nodes:logs',
  NODES_EXPORT_LOGS: 'nodes:export-logs',
  NODES_STATUS: 'nodes:status',
  NODES_HISTORY: 'nodes:history',
  NODES_WITHDRAW: 'nodes:withdraw',
  NODES_BACKUP_MNEMONIC: 'nodes:backup-mnemonic',
  NODES_REVEAL_MNEMONIC: 'nodes:reveal-mnemonic',
  NODES_UPDATE_PRICING: 'nodes:update-pricing',
  NODES_CHANGED: 'nodes:changed', // main -> renderer push

  // CLI server (local pipe / unix socket)
  CLI_STATUS: 'cli:status',
  CLI_START: 'cli:start',
  CLI_STOP: 'cli:stop',
  CLI_RUN: 'cli:run',
  CLI_OPEN_POWERSHELL: 'cli:open-powershell',
  CLI_STATE_CHANGED: 'cli:state-changed', // main -> renderer push
  CLI_STREAM: 'cli:stream', // main -> renderer push
} as const;

export type IPCChannel = (typeof IPC)[keyof typeof IPC];

/** Who currently holds the single-active-client lock on the CLI server. */
export type CliClientKind = 'app' | 'shell' | 'agent';

export type CliServerStatus = 'off' | 'app-active' | 'shell-active' | 'agent-active';

export interface CliServerState {
  status: CliServerStatus;
  /** Filesystem path to the named pipe / unix socket, when running. */
  endpoint: string | null;
  /** When the active session was opened (ISO). */
  sessionStartedAt: string | null;
  /** Path to the discovery file the binary reads to find the endpoint. */
  discoveryPath: string | null;
  /** Last error from the server (start failure, etc.). */
  error: string | null;
}

/**
 * Stream events broadcast to the in-app CLI screen. Mirrors what an
 * external PowerShell / agent client sees on stdout.
 */
export interface CliStreamEvent {
  /** Monotonic per-session id so clients can dedupe. */
  seq: number;
  /** ISO timestamp. */
  ts: string;
  /** Originating client. `system` is the server itself (state changes). */
  source: CliClientKind | 'system';
  /** What the line represents. */
  kind: 'input' | 'ok' | 'err' | 'info';
  /** Already-formatted text. JSON is pretty-printed before broadcast. */
  text: string;
}

export interface CliRunRequest {
  /** Raw command line, e.g. `nodes.history abc --window 1h`. */
  line: string;
}

export interface CliRunResult {
  ok: boolean;
  /** Pretty-printed response text. Empty when ok===false. */
  text: string;
  error?: string;
}
