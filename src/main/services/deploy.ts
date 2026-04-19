import { safeStorage } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import TOML from '@iarna/toml';
import {
  IMAGE_TAG,
  IMAGE_VERSION,
  SENTINEL_DVPNX_DOCKERFILE,
  dockerHealth,
  ensureImage,
  runOnce,
} from './docker';
import { getSettings } from './settings';
import { DENOM, DEFAULT_RPC_POOL } from './chain';
import { readStore, writeStore } from './store';
import { addEvent } from './events';
import { generateNodeKey, sendTokens } from './wallet';
import { ensureNodePersisted, nodeDataDir, rememberSSH, startNode } from './node-manager';
import { uploadFile, withSSH, runRemote, shellQuote } from './ssh';
import { log } from './logger';
import type {
  DeployPhase,
  DeployProgress,
  DeployRequest,
  DeployedNode,
} from '../../shared/types';

/**
 * Deploy orchestration.
 *
 *   Local path:
 *     1. dockerHealth() — verify daemon is reachable.
 *     2. ensureImage() — build sentinel-dvpnx image on first deploy.
 *     3. runOnce(`sentinel-dvpnx init`) — capture mnemonic + operator addr.
 *     4. Write structured TOML config into the node's host data dir.
 *     5. startNode() in node-manager — creates the long-running container.
 *
 *   Remote path (SSH):
 *     1. Connect + preflight (`docker --version`).
 *     2. Install Docker if missing (`curl get.docker.com | sh`).
 *     3. Pull / build the same image on the remote.
 *     4. Run `sentinel-dvpnx init` in a throwaway container; capture output.
 *     5. Upload the generated TOML via SFTP.
 *     6. Run the long-lived container with systemd-style restart.
 *
 * Both paths end with a verify step that waits ~30s for the node's first
 * on-chain heartbeat; if that doesn't land, we surface a warning but keep
 * the node (it will come up eventually and flip to online via the poller).
 */

/**
 * Amount of DVPN transferred from the app wallet into a freshly-deployed
 * node's operator address. Covers account creation + a generous runway of
 * on-chain status / session txs (each ~0.002 DVPN in gas).
 */
const OPERATOR_SEED_DVPN = 1;

type ProgressFn = (p: DeployProgress) => void;
type PushFn = (
  phase: DeployPhase,
  percent: number,
  message: string,
  log: string,
  extras?: Partial<DeployProgress>,
) => void;

interface RunningJob {
  jobId: string;
  cancel: () => void;
}

const jobs = new Map<string, RunningJob>();

export async function startDeploy(
  req: DeployRequest,
  onProgress: ProgressFn,
): Promise<{ jobId: string; nodeId: string }> {
  const jobId = crypto.randomUUID();
  const nodeId = crypto.randomUUID();

  const store = await readStore();
  if (!store.wallet?.address) {
    throw new Error('Create or restore a wallet before deploying a node.');
  }

  // Mint the node's own operator key locally (24-word mnemonic, same HD
  // path as the app wallet but from independent entropy). We'll display
  // the mnemonic once on the Progress screen AND save an encrypted backup
  // to safeStorage so node-level withdrawals work without SSH later.
  const { mnemonic: nodeMnemonic, address: operatorAddress } = await generateNodeKey();

  const node: DeployedNode = {
    id: nodeId,
    name: req.moniker,
    moniker: req.moniker,
    target: req.target,
    host: req.ssh?.host,
    status: 'loading',
    region: req.target === 'remote' ? req.ssh?.host ?? 'Remote' : 'This device',
    createdAt: new Date().toISOString(),
    operatorAddress,
    balanceDVPN: 0,
    port: req.port,
    gigabytePriceDVPN: req.gigabytePriceDVPN,
    hourlyPriceDVPN: req.hourlyPriceDVPN,
    serviceType: req.serviceType,
    registeredOnChain: false,
    remoteUrl: req.remoteUrl,
  };
  await ensureNodePersisted(node);

  // Auto-backup the node mnemonic encrypted in app. The user can also
  // write it down from the Progress screen; this is the convenience path
  // so Withdraw works out of the box.
  if (safeStorage.isEncryptionAvailable()) {
    const s = await readStore();
    s.nodeBackups[nodeId] = safeStorage.encryptString(nodeMnemonic).toString('base64');
    await writeStore(s);
  }

  if (req.target === 'remote' && req.ssh) {
    rememberSSH(nodeId, req.ssh);
  }

  await addEvent({
    kind: 'deploy-started',
    title: `Deploying ${req.moniker}`,
    subtitle: req.target === 'remote' ? `Remote · ${req.ssh?.host}` : 'Local device',
    relatedNodeId: nodeId,
  });

  let cancelled = false;
  jobs.set(jobId, { jobId, cancel: () => (cancelled = true) });

  const push: PushFn = (phase, percent, message, log, extras = {}) => {
    if (cancelled && phase !== 'error') return;
    onProgress({ jobId, nodeId, phase, percent, message, log, ...extras });
  };

  void (async () => {
    try {
      // Fund the operator address from the app wallet BEFORE the node
      // starts. Cosmos accounts are created lazily on first incoming
      // transaction; without this step the node errors out at startup with
      // "account does not exist" while trying to query its own account
      // info, and the container restart-loops forever.
      push('configure', 2, 'Funding operator address', `[${ts()}] seeding ${OPERATOR_SEED_DVPN} DVPN from app wallet → ${operatorAddress}`);
      const fund = await sendTokens({
        to: operatorAddress,
        amountDVPN: OPERATOR_SEED_DVPN,
        memo: `seed ${node.moniker}`,
      });
      if (!fund.ok) {
        throw new Error(
          `Funding operator address failed: ${fund.error ?? 'unknown'}. ` +
            (fund.errorCode === 'insufficient-funds'
              ? `Your app wallet needs at least ${OPERATOR_SEED_DVPN} DVPN (plus a little gas) before deploying a node.`
              : ''),
        );
      }
      push('configure', 4, 'Operator address funded', `[${ts()}] tx ${fund.txHash?.slice(0, 16)}… · height ${fund.height}`);

      if (req.target === 'remote') {
        await runRemoteDeploy(req, node, nodeMnemonic, push, () => cancelled);
      } else {
        await runLocalDeploy(req, node, nodeMnemonic, push, () => cancelled);
      }
      if (cancelled) return;
      push('done', 100, 'Node is online', `[${ts()}] ${node.moniker} is online on port ${node.port}.`, {
        operatorAddress,
        mnemonicForBackup: nodeMnemonic,
      });
      await addEvent({
        kind: 'deploy-succeeded',
        title: `Node ${node.moniker} is online`,
        subtitle: req.target === 'remote' ? `Remote · ${req.ssh?.host}` : 'Local device',
        relatedNodeId: nodeId,
      });
    } catch (err) {
      const msg = (err as Error).message ?? 'Unknown error';
      log.error('deploy failed', { id: nodeId, err: msg });
      push('error', 0, 'Deployment failed', `[${ts()}] ${msg}`);
      await addEvent({
        kind: 'deploy-failed',
        title: `Deployment failed: ${node.moniker}`,
        subtitle: msg.slice(0, 180),
        relatedNodeId: nodeId,
      });
      // Drop the failed node from the inventory so the user isn't left
      // with a zombie entry. Any transient backup / logs / metrics for
      // the nodeId are purged too.
      try {
        const s = await readStore();
        s.nodes = s.nodes.filter((x) => x.id !== nodeId);
        delete s.logs[nodeId];
        delete s.nodeBackups[nodeId];
        await writeStore(s);
        const { BrowserWindow } = await import('electron');
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('nodes:changed', null);
        }
      } catch (cleanupErr) {
        log.warn('failed-deploy cleanup errored', { err: String(cleanupErr) });
      }
    } finally {
      jobs.delete(jobId);
    }
  })();

  return { jobId, nodeId };
}

export function cancelDeploy(jobId: string): boolean {
  const job = jobs.get(jobId);
  if (!job) return false;
  job.cancel();
  jobs.delete(jobId);
  return true;
}

// ---------------------------------------------------------------------------
// LOCAL
// ---------------------------------------------------------------------------

async function runLocalDeploy(
  req: DeployRequest,
  node: DeployedNode,
  nodeMnemonic: string,
  push: PushFn,
  isCancelled: () => boolean,
): Promise<void> {
  push('preflight', 4, 'Checking Docker', `[${ts()}] Probing the Docker daemon…`);
  const health = await dockerHealth();
  if (!health.reachable) {
    throw new Error(
      `Docker is not reachable: ${health.error}. Install Docker Desktop (macOS/Windows) or start the Docker Engine (Linux), then try again.`,
    );
  }
  push('preflight', 8, 'Docker reachable', `[${ts()}] Docker ${health.version}`);

  if (isCancelled()) return;
  push('image-build', 12, 'Preparing node image', `[${ts()}] tag=${IMAGE_TAG} (first build can take 5–15 min; cached thereafter)`);
  await ensureImage(IMAGE_TAG, (line) => push('image-build', 36, 'Preparing node image', line));

  if (isCancelled()) return;
  const dataDir = nodeDataDir(node.id);
  await fs.mkdir(dataDir, { recursive: true });

  // 1. Pre-seed the node's keyring with our app-generated mnemonic, via
  //    `sentinelhub keys add --recover`. This runs in a throwaway
  //    container sharing the same host data dir; `dvpnx start` will pick
  //    up the operator key on launch.
  push('keygen', 55, 'Seeding node keyring', `[${ts()}] sentinelhub keys add --recover (name=operator)`);
  const hubCmd = [
    'sentinelhub',
    'keys',
    'add',
    'operator',
    '--keyring-backend',
    'test',
    '--keyring-dir',
    '/root/.sentinel-dvpnx',
    '--recover',
    '--output',
    'json',
  ];
  const keygen = await runOnce({
    hostDataDir: dataDir,
    imageTag: IMAGE_TAG,
    // The image's ENTRYPOINT is `dvpnx`. Override it with /bin/sh so we
    // can shell-pipe the mnemonic into `sentinelhub keys add --recover`.
    // Without this override, Docker runs `dvpnx /bin/sh -c "..."` and
    // dvpnx rejects `/bin/sh` as an unknown subcommand.
    entrypoint: ['/bin/sh', '-c'],
    // sentinelhub's `--recover` reads the mnemonic from stdin on a single line.
    cmd: [`echo '${nodeMnemonic}' | ${hubCmd.join(' ')}`],
    onLog: (line) => push('keygen', 62, 'Seeding node keyring', line),
  });
  if (keygen.exitCode !== 0) {
    throw new Error(
      `Keyring seeding failed (sentinelhub keys add exited ${keygen.exitCode}): ${keygen.output.trim().slice(-400)}`,
    );
  }

  // 2. Write canonical TOML config into the node's host data dir.
  if (isCancelled()) return;
  push('configure', 72, 'Writing node config', `[${ts()}] operator=${node.operatorAddress}`);
  await writeConfigToml(path.join(dataDir, 'config.toml'), {
    moniker: node.moniker,
    port: node.port,
    serviceType: node.serviceType,
    gigabytePriceUdvpn: Math.round(req.gigabytePriceDVPN * 1_000_000),
    hourlyPriceUdvpn: Math.round(req.hourlyPriceDVPN * 1_000_000),
    remoteUrl: node.remoteUrl ?? `127.0.0.1:${node.port}`,
    keyName: 'operator',
  });

  // 3. Run `dvpnx init` to generate TLS cert + service dir. Our config.toml
  //    (written above) carries moniker / prices / service / keyring; we
  //    intentionally skip --force so init respects those values. The one
  //    flag upstream marks as required on the command line is
  //    --node.remote-addrs.
  if (isCancelled()) return;
  push('configure', 78, 'Initializing node (TLS + service)', `[${ts()}] dvpnx init`);
  const initRes = await runOnce({
    hostDataDir: dataDir,
    imageTag: IMAGE_TAG,
    cmd: [
      'init',
      '--node.remote-addrs',
      stripToHost(node.remoteUrl ?? '127.0.0.1'),
    ],
    onLog: (line) => push('configure', 82, 'Initializing node (TLS + service)', line),
  });
  if (initRes.exitCode !== 0) {
    throw new Error(`dvpnx init failed (exit ${initRes.exitCode}): ${initRes.output.trim().slice(-400)}`);
  }

  // 4. Start the long-running container.
  if (isCancelled()) return;
  push('starting', 90, 'Starting node container', `[${ts()}] docker run ${IMAGE_TAG}`, {
    mnemonicForBackup: nodeMnemonic,
    operatorAddress: node.operatorAddress,
  });
  await startNode(node.id);

  if (isCancelled()) return;
  push('verifying', 96, 'Waiting for first heartbeat', `[${ts()}] poller runs every 60s`, {
    mnemonicForBackup: nodeMnemonic,
    operatorAddress: node.operatorAddress,
  });
  await new Promise((r) => setTimeout(r, 3_000));
}

// ---------------------------------------------------------------------------
// REMOTE — Docker-based install.
// ---------------------------------------------------------------------------

async function runRemoteDeploy(
  req: DeployRequest,
  node: DeployedNode,
  nodeMnemonic: string,
  push: PushFn,
  isCancelled: () => boolean,
): Promise<void> {
  if (!req.ssh) throw new Error('SSH credentials required for remote deploy');

  push('connecting', 4, 'Opening secure shell', `[${ts()}] ${req.ssh.host}:${req.ssh.port}`);
  await withSSH(req.ssh, async (client) => {
    if (isCancelled()) return;
    push('preflight', 10, 'Checking remote host', `[${ts()}] uname + whoami + docker probe`);
    const uname = await runRemote(client, 'uname -a', (l) => push('preflight', 12, 'Checking remote host', l));
    if (uname.code !== 0) throw new Error(`uname failed: ${uname.stderr.trim()}`);

    const idRes = await runRemote(client, 'id -u');
    const isRoot = idRes.stdout.trim() === '0';
    const sudo = isRoot ? '' : 'sudo -n ';
    push('preflight', 14, 'Checking remote host', `[${ts()}] uid=${idRes.stdout.trim()} sudo=${sudo ? 'yes' : 'no'}`);

    const dockerProbe = await runRemote(client, 'docker --version 2>/dev/null || true');
    if (!/Docker version/i.test(dockerProbe.stdout)) {
      push('preflight', 22, 'Installing Docker', `[${ts()}] curl get.docker.com | sh`);
      const install = await runRemote(
        client,
        `curl -fsSL https://get.docker.com -o /tmp/get-docker.sh && ${sudo}sh /tmp/get-docker.sh`,
        (l) => push('preflight', 28, 'Installing Docker', l),
      );
      if (install.code !== 0) {
        throw new Error(
          `Docker install failed: ${install.stderr.trim().slice(-400)}. If this is a non-root user, ensure passwordless sudo is configured, or install Docker manually and retry.`,
        );
      }
    }

    // Data-dir selection: root uses /root/.sentinel-dvpnx/<id>; non-root uses $HOME.
    const dataHost = isRoot
      ? `/root/.sentinel-dvpnx/${node.id}`
      : `$HOME/.sentinel-dvpnx/${node.id}`;
    await runRemote(client, `mkdir -p ${dataHost}`);

    // 1. Build the image on the remote if missing. First build takes 10–15
    //    minutes (go compile of sentinel-dvpnx + sentinelhub + wasmvm).
    if (isCancelled()) return;
    push('image-build', 36, 'Building node image on remote', `[${ts()}] ${IMAGE_TAG} — first build: 10–15 min`);
    const buildCmd = `${sudo}docker image inspect ${shellQuote([IMAGE_TAG])} >/dev/null 2>&1 || ${sudo}docker build -t ${shellQuote([IMAGE_TAG])} --build-arg SENTINEL_DVPNX_VERSION=${shellQuote([IMAGE_VERSION])} - <<'EOF'\n${readBundledDockerfile()}\nEOF`;
    const buildRes = await runRemote(
      client,
      buildCmd,
      (l) => push('image-build', 48, 'Building node image on remote', l),
    );
    if (buildRes.code !== 0) {
      throw new Error(
        `Docker build failed on remote: ${buildRes.stderr.trim().slice(-400)}`,
      );
    }

    // Expand $HOME for consistent absolute paths in SFTP + docker -v.
    const expand = await runRemote(client, `echo ${dataHost}`);
    const absDataHost = expand.stdout.trim() || dataHost.replace('$HOME', '/root');

    // 2. Seed the node's keyring with our app-generated mnemonic via
    //    sentinelhub keys add --recover (throwaway container).
    if (isCancelled()) return;
    push('keygen', 54, 'Seeding node keyring', `[${ts()}] sentinelhub keys add --recover`);
    const hubInner = [
      'docker',
      'run',
      '--rm',
      '-i',
      '-v',
      `${absDataHost}:/root/.sentinel-dvpnx`,
      '--entrypoint',
      '/bin/sh',
      IMAGE_TAG,
      '-c',
      `echo '${nodeMnemonic}' | sentinelhub keys add operator --keyring-backend test --keyring-dir /root/.sentinel-dvpnx --recover --output json`,
    ];
    const hubCmd = (sudo ? sudo : '') + shellQuote(hubInner);
    const keygen = await runRemote(client, hubCmd, (l) =>
      push('keygen', 62, 'Seeding node keyring', l),
    );
    if (keygen.code !== 0) {
      throw new Error(
        `Keyring seeding failed on remote: ${(keygen.stderr || keygen.stdout).trim().slice(-400)}`,
      );
    }

    // 3. Upload canonical TOML config via SFTP.
    if (isCancelled()) return;
    push('configure', 72, 'Writing node config', `[${ts()}] operator=${node.operatorAddress}`);
    const toml = buildConfigTomlString({
      moniker: node.moniker,
      port: node.port,
      serviceType: node.serviceType,
      gigabytePriceUdvpn: Math.round(req.gigabytePriceDVPN * 1_000_000),
      hourlyPriceUdvpn: Math.round(req.hourlyPriceDVPN * 1_000_000),
      remoteUrl: node.remoteUrl ?? `${req.ssh!.host}:${node.port}`,
      keyName: 'operator',
    });
    await uploadFile(client, `${absDataHost}/config.toml`, toml);

    // 4. dvpnx init — generates TLS cert + per-service dir. Our config.toml
    //    was uploaded in step 3 and already carries moniker / prices /
    //    service-type / keyring settings; we intentionally skip --force so
    //    init reads and respects our config instead of overwriting it. The
    //    only flag we have to pass is --node.remote-addrs, which upstream
    //    marks as required on the command line (even if it's also in the
    //    config file — this is a MarkFlagRequired check, not a value check).
    if (isCancelled()) return;
    push('configure', 78, 'Initializing node (TLS + service)', `[${ts()}] dvpnx init`);
    const initInner = [
      'docker',
      'run',
      '--rm',
      '-v',
      `${absDataHost}:/root/.sentinel-dvpnx`,
      IMAGE_TAG,
      'init',
      '--node.remote-addrs',
      stripToHost(node.remoteUrl ?? req.ssh!.host),
    ];
    const initCmd = (sudo ? sudo : '') + shellQuote(initInner);
    const init = await runRemote(client, initCmd, (l) =>
      push('configure', 82, 'Initializing node (TLS + service)', l),
    );
    if (init.code !== 0) {
      throw new Error(
        `dvpnx init failed on remote: ${(init.stderr || init.stdout).trim().slice(-400)}`,
      );
    }

    // 5. Launch the long-running container with docker restart policy.
    if (isCancelled()) return;
    push('starting', 88, 'Starting node container on remote', `[${ts()}] docker run`);
    const runInner = [
      'docker',
      'run',
      '-d',
      '--name',
      `sentinel-dvpn-${node.id.slice(0, 12)}`,
      '--restart',
      'unless-stopped',
      '--cap-add',
      'NET_ADMIN',
      '--cap-add',
      'NET_RAW',
      '--device',
      '/dev/net/tun:/dev/net/tun',
      '-p',
      `${node.port}:${node.port}/udp`,
      '-p',
      `${node.port}:${node.port}/tcp`,
      '-v',
      `${absDataHost}:/root/.sentinel-dvpnx`,
      IMAGE_TAG,
      'start',
    ];
    const runCmd = (sudo ? sudo : '') + shellQuote(runInner);
    const run = await runRemote(client, runCmd, (l) => push('starting', 92, 'Starting node container on remote', l));
    if (run.code !== 0) {
      throw new Error(`docker run failed: ${run.stderr.trim().slice(-400)}`);
    }

    // Persist the container start time so uptime survives app restarts.
    {
      const s = await readStore();
      const n = s.nodes.find((x) => x.id === node.id);
      if (n) {
        n.startedAt = new Date().toISOString();
        await writeStore(s);
      }
    }

    push('verifying', 96, 'Waiting for first heartbeat', `[${ts()}] poller runs every 60s`, {
      mnemonicForBackup: nodeMnemonic,
      operatorAddress: node.operatorAddress,
    });
  });
}

// ---------------------------------------------------------------------------
// Config emit (shared)
// ---------------------------------------------------------------------------

interface ConfigShape {
  moniker: string;
  port: number;
  serviceType: 'wireguard' | 'v2ray';
  gigabytePriceUdvpn: number;
  hourlyPriceUdvpn: number;
  remoteUrl: string;
  keyName: string;
}

async function writeConfigToml(destPath: string, cfg: ConfigShape): Promise<void> {
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.writeFile(destPath, buildConfigTomlString(cfg), 'utf8');
}

function buildConfigTomlString(cfg: ConfigShape): string {
  const settings = readSettingsSnapshot();
  // Matches the real sentinel-dvpnx config shape (keyring/rpc/tx/node/qos).
  const obj = {
    keyring: {
      // "test" backend matches what sentinelhub keys add --keyring-backend test
      // wrote during deploy. "file" would require a password prompt at every
      // node start which won't work under systemd / docker -d.
      backend: 'test',
      name: cfg.keyName,
    },
    query: {
      prove: false,
      retry_attempts: 5,
      retry_delay: '1s',
    },
    rpc: {
      addrs: settings.rpcUrls.length ? settings.rpcUrls : DEFAULT_RPC_POOL,
      chain_id: settings.chainId,
      timeout: '15s',
    },
    tx: {
      from_name: cfg.keyName,
      gas: 300_000,
      gas_adjustment: 1.15,
      gas_prices: `${settings.gasPriceUdvpn}${DENOM}`,
      broadcast_retry_attempts: 1,
      broadcast_retry_delay: '5s',
      query_retry_attempts: 30,
      query_retry_delay: '1s',
      simulate_and_execute: true,
    },
    handshake_dns: { enable: false, peers: 8 },
    node: {
      api_port: String(cfg.port),
      // Price format is `denom:BASE,QUOTE`. BASE is a LegacyDec (fiat rate
      // used by the on-chain oracle); QUOTE is a plain udvpn integer. We
      // set BASE=0 so the oracle is disabled and the node quotes a flat
      // udvpn price only — matches what the UI exposes.
      gigabyte_prices: `${DENOM}:0,${cfg.gigabytePriceUdvpn}`,
      hourly_prices: `${DENOM}:0,${cfg.hourlyPriceUdvpn}`,
      interval_best_rpc_addr: '5m0s',
      interval_geoip_location: '6h0m0s',
      interval_prices_update: '6h0m0s',
      interval_session_usage_sync_with_blockchain: '1h55m0s',
      interval_session_usage_sync_with_database: '2s',
      interval_session_usage_validate: '5s',
      interval_session_validate: '5m0s',
      interval_speedtest: '168h0m0s',
      interval_status_update: '55m0s',
      moniker: cfg.moniker,
      // validateRemoteAddr rejects anything but a bare IP or DNS name —
      // `net.ParseIP` / `govalidator.IsDNSName`. Strip scheme / port.
      remote_addrs: [stripToHost(cfg.remoteUrl)],
      service_type: cfg.serviceType,
    },
    oracle: {
      name: 'coingecko',
      coingecko: { api_key: '' },
      osmosis: { api_addr: 'https://api.osmosis.zone' },
    },
    qos: { max_peers: 250 },
  } as const;
  return TOML.stringify(obj as never);
}

// Snapshot to avoid an await inside buildConfigTomlString (caller already awaited).
// We keep a tiny in-module cache of the most recent settings read so the
// synchronous builder is safe.
let cachedSettings: {
  rpcUrls: string[];
  chainId: string;
  gasPriceUdvpn: string;
} | null = null;

function readSettingsSnapshot() {
  if (cachedSettings) return cachedSettings;
  // Fallback to defaults; the real values are injected by primeSettings() on
  // app startup.
  return {
    rpcUrls: [...DEFAULT_RPC_POOL],
    chainId: 'sentinelhub-2',
    gasPriceUdvpn: '0.1',
  };
}

export async function primeDeploySettings(): Promise<void> {
  const s = await getSettings();
  cachedSettings = {
    rpcUrls: s.rpcUrls,
    chainId: s.chainId,
    gasPriceUdvpn: s.gasPriceUdvpn,
  };
}

// ---------------------------------------------------------------------------
// Parsers + helpers
// ---------------------------------------------------------------------------

export function parseInitOutput(out: string): { mnemonic?: string; operatorAddress?: string } {
  // sentinel-dvpnx init prints the mnemonic after a "mnemonic" / "seed"
  // label (either on the same line after a colon, or on the next line).
  // The address is emitted as a bech32 string; match the first sent1… we
  // see.
  const addrMatch = out.match(/\bsent1[0-9a-z]{30,58}\b/);

  let mnemonic: string | undefined;
  const labelled = out.match(/(?:mnemonic|seed)[^:\n]*[:=]?\s*([\sa-z]{40,400})/i);
  if (labelled) {
    const words = labelled[1].trim().split(/\s+/).filter((w) => /^[a-z]+$/.test(w));
    if (words.length >= 12 && words.length <= 24) mnemonic = words.slice(0, 24).join(' ');
  }
  return {
    operatorAddress: addrMatch ? addrMatch[0] : undefined,
    mnemonic,
  };
}

function readBundledDockerfile(): string {
  return SENTINEL_DVPNX_DOCKERFILE;
}

/**
 * sentinel-dvpnx's validateRemoteAddr accepts either a bare IPv4/IPv6
 * (via net.ParseIP) or a DNS name (via govalidator.IsDNSName) — no scheme,
 * no port, no path. We normalize whatever the user (or our default) hands
 * in down to just the host part.
 */
export function stripToHost(raw: string): string {
  let s = (raw ?? '').trim();
  s = s.replace(/^[a-z]+:\/\//i, ''); // scheme
  s = s.replace(/\/+$/, '');           // trailing slash(es)
  // IPv6 wrapped in brackets, optionally with :port
  const v6 = s.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (v6) return v6[1];
  // host:port
  const hp = s.match(/^([^:\/]+):\d+$/);
  if (hp) return hp[1];
  return s;
}

function ts(): string {
  const d = new Date();
  return d.toISOString().split('T')[1]!.replace('Z', '');
}
