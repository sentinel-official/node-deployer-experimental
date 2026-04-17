import { app, BrowserWindow, safeStorage } from 'electron';
import path from 'node:path';
import {
  IMAGE_TAG,
  containerLogs,
  containerName,
  isRunning,
  removeContainer,
  restartContainer,
  runNode,
  stopContainer,
} from './docker';
import { readClients, signClient } from './sentinel-client';
import { readStore, writeStore } from './store';
import { addEvent } from './events';
import { recordSample, purgeNode, history } from './metrics';
import { DENOM, dvpnToUdvpn, udvpnToDvpn } from './chain';
import { signerFromMnemonic } from './wallet';
import { withSSH, runRemote, shellQuote } from './ssh';
import { GasPrice } from '@cosmjs/stargate';
import { getSettings } from './settings';
import { fromBech32, toBech32 } from '@cosmjs/encoding';

/**
 * Sentinel stores the *node* identity under a distinct bech32 HRP
 * (`sentnode…`) even though it shares the underlying 20-byte payload with
 * the operator's `sent…` account address. Any chain-side query about the
 * node needs the re-encoded form.
 */
function accountToNodeAddr(accountAddr: string): string {
  try {
    const { data } = fromBech32(accountAddr);
    return toBech32('sentnode', data);
  } catch {
    return accountAddr;
  }
}

/**
 * The sessions index returns a heterogeneous `Any[]` of session variants
 * (WireGuard, V2Ray). We pick out the fields common to all of them for
 * the Node Details "Active Subscriptions" card. Best-effort — unknown
 * session types fall back to a minimal record.
 */
function summarizeSession(raw: unknown): NodeSession {
  const obj = decodeMaybeAny(raw) ?? (raw as Record<string, unknown>);
  const getField = (k: string) => (obj as Record<string, unknown>)[k];
  const id = String(getField('id') ?? getField('ID') ?? '');
  const accAddress = String(getField('accAddress') ?? getField('acc_address') ?? '');
  const bandwidthObj = (getField('bandwidth') ?? getField('bytes')) as
    | { upload?: unknown; download?: unknown; upload_bytes?: unknown; download_bytes?: unknown }
    | undefined;
  const bytesOut = Number(bandwidthObj?.upload ?? bandwidthObj?.upload_bytes ?? 0);
  const bytesIn = Number(bandwidthObj?.download ?? bandwidthObj?.download_bytes ?? 0);
  const durNs = Number(getField('duration') ?? 0);
  const durationSeconds = durNs > 0 ? Math.round(durNs / 1e9) : 0;
  const status = typeof getField('status') === 'string' ? String(getField('status')) : undefined;
  const short = accAddress ? `${accAddress.slice(0, 10)}…${accAddress.slice(-6)}` : id.slice(0, 12);
  return {
    id,
    subscriber: accAddress || id,
    subscriberShort: short,
    bytesIn,
    bytesOut,
    durationSeconds,
    status,
  };
}

function decodeMaybeAny(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object') return null;
  // An `Any` from the SDK has { typeUrl, value: Uint8Array }. We don't
  // bother decoding the protobuf here — we just fall back to property
  // inspection on the outer object.
  return v as Record<string, unknown>;
}
import type {
  DeployedNode,
  MetricsSample,
  MetricsWindow,
  NodeLiveStatus,
  NodeSession,
  NodeStatus,
  SSHCredentials,
} from '../../shared/types';
import { log } from './logger';

/**
 * Lifecycle + observability for deployed nodes.
 *
 *   • Local nodes run as Docker containers; we keep the container id in
 *     `node.runtimeId` and hit Docker directly for start/stop/logs/status.
 *   • Remote nodes live on a VPS; we keep their SSH credentials in an
 *     in-memory keyring (never persisted). Commands execute over SSH.
 *   • Every 60s we sample each node (on-chain balance + node registration +
 *     session count where available) and insert into the SQLite time-series.
 *     The renderer's chart reads from `history()`.
 */

// In-memory SSH creds keyed by node id. Lost on app restart — by design.
const sshKeyring = new Map<string, SSHCredentials>();

// Per-node container start timestamp (approx uptime computation).
const startedAt = new Map<string, number>();

let poller: NodeJS.Timeout | null = null;

// ---------------------------------------------------------------------------
// Inventory / lifecycle
// ---------------------------------------------------------------------------

export function nodeDataDir(nodeId: string): string {
  return path.join(app.getPath('userData'), 'nodes', nodeId);
}

export async function listNodes(): Promise<DeployedNode[]> {
  const store = await readStore();
  return store.nodes;
}

export async function getNode(id: string): Promise<DeployedNode | null> {
  const store = await readStore();
  return store.nodes.find((n) => n.id === id) ?? null;
}

export function rememberSSH(nodeId: string, creds: SSHCredentials): void {
  sshKeyring.set(nodeId, creds);
}

export function getSSH(nodeId: string): SSHCredentials | undefined {
  return sshKeyring.get(nodeId);
}

export async function ensureNodePersisted(node: DeployedNode): Promise<void> {
  const store = await readStore();
  const idx = store.nodes.findIndex((n) => n.id === node.id);
  if (idx === -1) {
    store.nodes.push(node);
  } else {
    store.nodes[idx] = { ...store.nodes[idx], ...node };
  }
  await writeStore(store);
  broadcast('nodes:changed', null);
}

export async function updateNode(id: string, patch: Partial<DeployedNode>): Promise<void> {
  const store = await readStore();
  const n = store.nodes.find((x) => x.id === id);
  if (!n) return;
  Object.assign(n, patch);
  await writeStore(store);
  broadcast('nodes:changed', null);
}

export async function transition(id: string, status: NodeStatus): Promise<void> {
  await updateNode(id, { status });
}

// ---------------------------------------------------------------------------
// Start / stop / restart
// ---------------------------------------------------------------------------

/** Build a sudo prefix lazily for a remote session. */
async function remoteSudo(client: import('ssh2').Client): Promise<string> {
  const r = await runRemote(client, 'id -u');
  return r.stdout.trim() === '0' ? '' : 'sudo -n ';
}

export async function startNode(id: string): Promise<void> {
  const node = await getNode(id);
  if (!node) throw new Error('Node not found');

  if (node.target === 'local') {
    const name = containerName(node.id);
    try {
      if (node.runtimeId && (await isRunning(node.runtimeId))) {
        await updateNode(id, { status: 'online' });
        return;
      }
    } catch {
      /* fall through to recreate */
    }
    const runtimeId = await runNode({
      nodeId: node.id,
      hostDataDir: nodeDataDir(node.id),
      port: node.port,
      apiPort: 19781,
      imageTag: IMAGE_TAG,
    });
    const now = Date.now();
    startedAt.set(id, now);
    await updateNode(id, { status: 'online', runtimeId, startedAt: new Date(now).toISOString() });
    log.info('node started (local)', { id, name });
  } else {
    const creds = sshKeyring.get(id);
    if (!creds) {
      throw new Error(
        'SSH credentials for this remote node are no longer cached. Re-enter them from Node Details to restart it.',
      );
    }
    await withSSH(creds, async (client) => {
      const sudo = await remoteSudo(client);
      const cmd = sudo + shellQuote(['docker', 'start', containerName(id)]);
      const { code, stderr } = await runRemote(client, cmd);
      if (code !== 0) throw new Error(`docker start failed: ${stderr.trim().slice(-400)}`);
    });
    const now = Date.now();
    startedAt.set(id, now);
    await updateNode(id, { status: 'online', startedAt: new Date(now).toISOString() });
  }
}

export async function stopNode(id: string): Promise<void> {
  const node = await getNode(id);
  if (!node) return;

  if (node.target === 'local') {
    if (node.runtimeId) await stopContainer(node.runtimeId);
  } else {
    const creds = sshKeyring.get(id);
    if (!creds) {
      log.warn('stopNode: remote creds not cached, marking offline only', { id });
    } else {
      await withSSH(creds, async (client) => {
        const sudo = await remoteSudo(client);
        await runRemote(client, sudo + shellQuote(['docker', 'stop', containerName(id)]));
      });
    }
  }
  await updateNode(id, { status: 'offline' });
  await addEvent({
    kind: 'node-stopped',
    title: `Node ${node.moniker} stopped`,
    subtitle: 'Requested by operator',
    relatedNodeId: id,
  });
}

export async function restartNode(id: string): Promise<void> {
  const node = await getNode(id);
  if (!node) return;
  await transition(id, 'loading');

  if (node.target === 'local') {
    if (node.runtimeId) {
      await restartContainer(node.runtimeId);
    } else {
      await startNode(id);
    }
    const now = Date.now();
    startedAt.set(id, now);
    await updateNode(id, { status: 'online', startedAt: new Date(now).toISOString() });
  } else {
    const creds = sshKeyring.get(id);
    if (!creds) throw new Error('Re-enter SSH credentials to restart this remote node.');
    await withSSH(creds, async (client) => {
      const sudo = await remoteSudo(client);
      const { code, stderr } = await runRemote(
        client,
        sudo + shellQuote(['docker', 'restart', containerName(id)]),
      );
      if (code !== 0) throw new Error(`docker restart failed: ${stderr.trim().slice(-400)}`);
    });
    const now = Date.now();
    startedAt.set(id, now);
    await updateNode(id, { status: 'online', startedAt: new Date(now).toISOString() });
  }

  await addEvent({
    kind: 'node-restarted',
    title: `Node ${node.moniker} restarted`,
    subtitle: '',
    relatedNodeId: id,
  });
}

export async function removeNode(id: string): Promise<void> {
  const node = await getNode(id);
  if (!node) return;

  if (node.target === 'local') {
    if (node.runtimeId) {
      try {
        await removeContainer(node.runtimeId);
      } catch (err) {
        log.warn('removeContainer failed', { err: (err as Error).message });
      }
    }
  } else {
    const creds = sshKeyring.get(id);
    if (creds) {
      try {
        await withSSH(creds, async (client) => {
          const sudo = await remoteSudo(client);
          await runRemote(
            client,
            sudo + shellQuote(['docker', 'rm', '-f', containerName(id)]) +
              ` ; rm -rf $HOME/.sentinel-dvpnx/${id} /root/.sentinel-dvpnx/${id} 2>/dev/null || true`,
          );
        });
      } catch (err) {
        log.warn('remote teardown failed', { err: (err as Error).message });
      }
    }
  }

  purgeNode(id);
  sshKeyring.delete(id);
  startedAt.delete(id);

  const store = await readStore();
  store.nodes = store.nodes.filter((n) => n.id !== id);
  delete store.logs[id];
  delete store.nodeBackups[id];
  await writeStore(store);
  broadcast('nodes:changed', null);

  await addEvent({
    kind: 'node-removed',
    title: `Node ${node.moniker} removed`,
    subtitle: node.host ?? 'local',
    relatedNodeId: id,
  });
}

// ---------------------------------------------------------------------------
// Logs + live status
// ---------------------------------------------------------------------------

export async function recentLogs(id: string): Promise<string[]> {
  const node = await getNode(id);
  if (!node) return [];
  if (node.target === 'local') {
    if (node.runtimeId) {
      const lines = await containerLogs(node.runtimeId, 200);
      if (lines.length > 0) return lines;
    }
  } else {
    const creds = sshKeyring.get(id);
    if (creds) {
      try {
        return await withSSH(creds, async (client) => {
          const sudo = await remoteSudo(client);
          const cmd = sudo + shellQuote(['docker', 'logs', '--tail', '200', containerName(id)]);
          const { stdout, stderr } = await runRemote(client, cmd);
          return (stdout + stderr).split(/\r?\n/).filter(Boolean);
        });
      } catch (err) {
        log.debug('recentLogs remote failed', { err: (err as Error).message });
      }
    }
  }
  // Fall back to whatever we last persisted in the store.
  const store = await readStore();
  return store.logs[id] ?? [];
}

export async function liveStatus(id: string): Promise<NodeLiveStatus> {
  const node = await getNode(id);
  if (!node) {
    return {
      nodeId: id,
      reachable: false,
      sessions: 0,
      bytesOut: 0,
      bytesIn: 0,
      uptimeMs: 0,
      logTail: [],
      activeSubscriptions: [],
      error: 'Unknown node',
    };
  }

  const logTail = await recentLogs(id);
  const start = Date.now();
  const uptimeMs = node.startedAt ? Math.max(0, Date.now() - Date.parse(node.startedAt)) : 0;

  try {
    const { sentinel, stargate, disconnect } = await readClients();
    try {
      const nodeAddr = accountToNodeAddr(node.operatorAddress);
      const onChain = sentinel
        ? await sentinel.node.node(nodeAddr).catch(() => undefined)
        : undefined;
      const balanceCoin = await stargate
        .getBalance(node.operatorAddress, DENOM)
        .catch(() => ({ amount: '0' }));
      const chainHeight = await stargate.getHeight().catch(() => undefined);

      const reachable = Boolean(onChain);
      const earnings = udvpnToDvpn(balanceCoin.amount);

      // Sessions currently served by the node. The on-chain sessions index
      // is keyed by the operator's node address.
      let sessionsCount = 0;
      let bytesIn = 0;
      let bytesOut = 0;
      const activeSubscriptions: NodeSession[] = [];
      if (sentinel && reachable) {
        try {
          const res = await sentinel.session.sessionsForNode(nodeAddr);
          sessionsCount = res.sessions.length;
          for (const raw of res.sessions.slice(0, 20)) {
            const summary = summarizeSession(raw);
            bytesIn += summary.bytesIn;
            bytesOut += summary.bytesOut;
            activeSubscriptions.push(summary);
          }
        } catch (err) {
          log.debug('sessions query failed', { err: (err as Error).message });
        }
      }

      // Chain status (active / active_pending / inactive).
      const chainStatusStr = onChain && onChain.status !== undefined ? String(onChain.status) : undefined;
      const lastStatusAt = onChain?.statusAt
        ? new Date(onChain.statusAt).toISOString()
        : undefined;

      // Persist only when changed (avoids write churn on every probe).
      const patch: Partial<typeof node> = {};
      if (earnings !== node.balanceDVPN) patch.balanceDVPN = earnings;
      if (reachable !== node.registeredOnChain) patch.registeredOnChain = reachable;
      if (Object.keys(patch).length) await updateNode(id, patch);

      return {
        nodeId: id,
        reachable,
        sessions: sessionsCount,
        bytesOut,
        bytesIn,
        uptimeMs,
        chainHeight,
        apiLatencyMs: Date.now() - start,
        logTail: logTail.slice(-100),
        chainStatus: chainStatusStr,
        chainAddress: nodeAddr,
        lastStatusAt,
        activeSubscriptions,
      };
    } finally {
      disconnect();
    }
  } catch (err) {
    return {
      nodeId: id,
      reachable: false,
      sessions: 0,
      bytesOut: 0,
      bytesIn: 0,
      uptimeMs,
      logTail: logTail.slice(-100),
      activeSubscriptions: [],
      error: (err as Error).message,
    };
  }
}

export function historyFor(id: string, window: MetricsWindow): MetricsSample[] {
  return history(id, window);
}

// ---------------------------------------------------------------------------
// Background poller — samples every node every 60s
// ---------------------------------------------------------------------------

export function startPoller(): void {
  if (poller) return;
  // Rehydrate startedAt from persisted DeployedNode records so uptime
  // survives app restarts.
  void listNodes().then((nodes) => {
    for (const n of nodes) {
      if (n.startedAt) startedAt.set(n.id, Date.parse(n.startedAt));
    }
  });
  const tick = async () => {
    const nodes = await listNodes();
    for (const node of nodes) {
      try {
        const status = await liveStatus(node.id);
        recordSample({
          nodeId: node.id,
          ts: Date.now(),
          peers: status.sessions,
          bytesIn: status.bytesIn,
          bytesOut: status.bytesOut,
          earningsUdvpn: Math.round(node.balanceDVPN * 1_000_000),
          chainHeight: status.chainHeight,
          reachable: status.reachable,
        });

        // Health transitions fire events so the user sees unreachable alerts.
        // `loading` → `online` on first successful probe (covers freshly-deployed nodes
        // that sit in "Starting" until the chain sees them register).
        if (status.reachable && node.status !== 'online') {
          await transition(node.id, 'online');
          await addEvent({
            kind: 'node-online',
            title: `Node ${node.moniker} is online`,
            subtitle: 'Registered on chain',
            relatedNodeId: node.id,
          });
        } else if (!status.reachable && node.status === 'online') {
          await transition(node.id, 'offline');
          await addEvent({
            kind: 'node-unreachable',
            title: `Node ${node.moniker} is unreachable`,
            subtitle: status.error ?? 'No on-chain status',
            relatedNodeId: node.id,
          });
        }
      } catch (err) {
        log.debug('poll node failed', { id: node.id, err: (err as Error).message });
      }
    }
  };
  // Fire once shortly after startup so history charts have at least one point
  // by the time the user opens them.
  setTimeout(() => void tick(), 5_000);
  poller = setInterval(() => void tick(), 60_000);
}

export function stopPoller(): void {
  if (poller) {
    clearInterval(poller);
    poller = null;
  }
}

// ---------------------------------------------------------------------------
// Node-level withdrawals (from node's own key)
// ---------------------------------------------------------------------------

export async function withdrawFromNode(
  nodeId: string,
  to: string,
  amountDVPN?: number,
): Promise<{ ok: boolean; txHash?: string; error?: string }> {
  const node = await getNode(nodeId);
  if (!node) return { ok: false, error: 'Node not found' };

  // The operator key was generated in-app at deploy time and (by default)
  // backed up encrypted in safeStorage. To withdraw, we decrypt that
  // backup, build a signer, and issue a MsgSend via CosmJS — no need to
  // execute commands inside the container.
  const store = await readStore();
  const backup = store.nodeBackups[nodeId];
  if (!backup) {
    return {
      ok: false,
      error:
        'No encrypted backup of this node\'s operator mnemonic is in the app. Open Node Details and save the backup, then try again.',
    };
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return { ok: false, error: 'OS keychain is unavailable — cannot decrypt the node backup.' };
  }

  let mnemonic: string;
  try {
    mnemonic = safeStorage.decryptString(Buffer.from(backup, 'base64'));
  } catch (err) {
    return { ok: false, error: `Could not decrypt node backup: ${(err as Error).message}` };
  }

  const amountUdvpn =
    amountDVPN && amountDVPN > 0
      ? Math.round(amountDVPN * 1_000_000)
      : Math.max(0, Math.floor(node.balanceDVPN * 1_000_000) - 3_000);
  if (amountUdvpn <= 0) {
    return { ok: false, error: 'Nothing to withdraw (balance under gas buffer).' };
  }

  try {
    const settings = await getSettings();
    const signer = await signerFromMnemonic(mnemonic);
    const [{ address: from }] = await signer.getAccounts();
    if (from !== node.operatorAddress) {
      return {
        ok: false,
        error: `Backup mnemonic derives to ${from} but the node's operator address is ${node.operatorAddress}.`,
      };
    }
    const { client, disconnect, url } = await signClient(signer);
    try {
      const actualChainId = await client.getChainId();
      if (actualChainId !== settings.chainId) {
        return {
          ok: false,
          error: `RPC ${url} reports chain ${actualChainId}, expected ${settings.chainId}.`,
        };
      }
      // Explicit StdFee — the bundled-cosmjs GasPrice instance check
      // rejects 'auto' here (same root cause as the app-wallet send path).
      const gas = 250_000;
      const feeUdvpn = String(Math.max(1, Math.ceil(gas * Number(settings.gasPriceUdvpn))));
      const fee = { amount: [{ denom: DENOM, amount: feeUdvpn }], gas: String(gas) };
      const result = await client.sendTokens(
        from,
        to,
        [{ denom: DENOM, amount: String(amountUdvpn) }],
        fee,
        `withdraw from ${node.moniker}`,
      );
      if (result.code !== 0) {
        await addEvent({
          kind: 'withdraw-failed',
          title: `Withdraw from ${node.moniker} failed`,
          subtitle: (result.rawLog ?? `code ${result.code}`).slice(0, 160),
          amountDVPN: -udvpnToDvpn(amountUdvpn),
          relatedNodeId: nodeId,
        });
        return { ok: false, error: result.rawLog ?? `Broadcast rejected (code ${result.code})` };
      }
      await addEvent({
        kind: 'withdraw-sent',
        title: `Withdrew from ${node.moniker}`,
        subtitle: `to ${to.slice(0, 10)}…${to.slice(-6)}`,
        amountDVPN: -udvpnToDvpn(amountUdvpn),
        relatedNodeId: nodeId,
        txHash: result.transactionHash,
      });
      return { ok: true, txHash: result.transactionHash };
    } finally {
      disconnect();
    }
  } catch (err) {
    const msg = (err as Error).message ?? 'Unknown error';
    await addEvent({
      kind: 'withdraw-failed',
      title: `Withdraw from ${node.moniker} failed`,
      subtitle: msg.slice(0, 160),
      relatedNodeId: nodeId,
    });
    return { ok: false, error: msg };
  }
}

/**
 * Broadcast MsgUpdateNodeDetails for a deployed node, keeping moniker +
 * remote addr + service type but rewriting gigabyte / hourly prices.
 *
 * Returns the tx hash on success. Requires the encrypted backup mnemonic
 * we saved during deploy so we can sign with the node's operator key.
 */
export async function updateNodePricing(
  nodeId: string,
  gigabytePriceDVPN: number,
  hourlyPriceDVPN: number,
): Promise<{ ok: boolean; txHash?: string; error?: string }> {
  const node = await getNode(nodeId);
  if (!node) return { ok: false, error: 'Node not found' };
  if (!(gigabytePriceDVPN >= 0) || !(hourlyPriceDVPN >= 0)) {
    return { ok: false, error: 'Prices must be non-negative' };
  }

  const store = await readStore();
  const backup = store.nodeBackups[nodeId];
  if (!backup) {
    return {
      ok: false,
      error:
        'No encrypted backup of this node\'s mnemonic is in the app — can\'t sign a price update.',
    };
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return { ok: false, error: 'OS keychain unavailable — cannot decrypt backup.' };
  }

  let mnemonic: string;
  try {
    mnemonic = safeStorage.decryptString(Buffer.from(backup, 'base64'));
  } catch (err) {
    return { ok: false, error: `Could not decrypt backup: ${(err as Error).message}` };
  }

  const giga = Math.round(gigabytePriceDVPN * 1_000_000);
  const hour = Math.round(hourlyPriceDVPN * 1_000_000);
  const remoteAddr = node.remoteUrl ?? node.host ?? '127.0.0.1';

  try {
    const signer = await signerFromMnemonic(mnemonic);
    const [{ address: from }] = await signer.getAccounts();
    const { client, disconnect } = await signClient(signer);
    try {
      // One generous fee — MsgUpdateNodeDetails is similar weight to MsgSend.
      const settings = await getSettings();
      const gas = 250_000;
      const feeUdvpn = String(Math.max(1, Math.ceil(gas * Number(settings.gasPriceUdvpn))));
      const fee = { amount: [{ denom: DENOM, amount: feeUdvpn }], gas: String(gas) };
      const result = await client.nodeUpdateDetails({
        from,
        gigabytePrices: [
          { denom: DENOM, baseValue: '0', quoteValue: String(giga) } as never,
        ],
        hourlyPrices: [
          { denom: DENOM, baseValue: '0', quoteValue: String(hour) } as never,
        ],
        remoteUrl: stripToHostSafe(remoteAddr),
        fee,
        memo: `update pricing ${node.moniker}`,
      } as never);
      if (result.code !== 0) {
        await addEvent({
          kind: 'withdraw-failed',
          title: `Pricing update failed: ${node.moniker}`,
          subtitle: (result.rawLog ?? `code ${result.code}`).slice(0, 160),
          relatedNodeId: nodeId,
        });
        return { ok: false, error: result.rawLog ?? `Broadcast rejected (${result.code})` };
      }
      await updateNode(nodeId, {
        gigabytePriceDVPN,
        hourlyPriceDVPN,
      });
      await addEvent({
        kind: 'node-restarted', // re-use a neutral event kind
        title: `Pricing updated: ${node.moniker}`,
        subtitle: `gigabyte=${gigabytePriceDVPN} DVPN · hourly=${hourlyPriceDVPN} DVPN`,
        relatedNodeId: nodeId,
        txHash: result.transactionHash,
      });
      return { ok: true, txHash: result.transactionHash };
    } finally {
      disconnect();
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

function stripToHostSafe(raw: string): string {
  let s = (raw ?? '').trim();
  s = s.replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '');
  const v6 = s.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (v6) return v6[1];
  const hp = s.match(/^([^:/]+):\d+$/);
  return hp ? hp[1] : s;
}

// Keep stable imports referenced (avoid unused-import lint noise).
void GasPrice;
void dvpnToUdvpn;
void containerName;

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}
