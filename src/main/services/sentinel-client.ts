import {
  SigningSentinelClient,
  buildSentinelQueryClient,
  type SentinelQueryClient,
} from '@sentinel-official/sentinel-js-sdk';
import { StargateClient } from '@cosmjs/stargate';
import { Comet38Client } from '@cosmjs/tendermint-rpc';
import type { OfflineSigner } from '@cosmjs/proto-signing';

/**
 * The Sentinel JS SDK bundles its own (slightly older) @cosmjs stack. The
 * app uses the newer one at the root of node_modules. They are
 * runtime-compatible (same wire format) but TypeScript sees two distinct
 * class identities. We cast at the boundary via `unknown`; there's no
 * actual behavior difference.
 *
 * One consequence: do NOT pass `gasPrice` to `connectWithSigner`. The SDK
 * internally checks `gasPrice instanceof GasPrice` against *its* bundled
 * GasPrice class, which rejects instances created from our top-level
 * copy. We handle fees explicitly at every call site instead of using
 * 'auto'.
 */
type AnyTm = Parameters<typeof buildSentinelQueryClient>[0];
import { DENOM } from './chain';
import { getSettings } from './settings';
import { log } from './logger';
import type { ChainHealth } from '../../shared/types';

/**
 * Sentinel / Cosmos RPC plumbing.
 *
 *   • pickRPC() iterates the Settings rpcUrls in order, returns the first
 *     one whose `.getChainId()` succeeds inside the 4s probe budget.
 *   • readClient()  returns a StargateClient + SentinelQueryClient against
 *     the first healthy RPC. Callers disconnect when done.
 *   • signClient(signer) returns a SigningSentinelClient with gas-price set.
 *   • healthAll() is a fan-out used by the Settings screen to show per-RPC
 *     reachability.
 *
 * All I/O here is typed-retryable. A caller that cares about failures
 * classifies the thrown `Error.message` further up the stack.
 */

const PROBE_TIMEOUT_MS = 4_000;
const PROBE_CACHE_TTL_MS = 30_000;

interface CachedHealth {
  ok: boolean;
  at: number;
  chainId?: string;
  blockHeight?: number;
  latencyMs?: number;
  error?: string;
}

const healthCache = new Map<string, CachedHealth>();

export async function pickRPC(): Promise<string> {
  const { rpcUrls, chainId } = await getSettings();
  for (const url of rpcUrls) {
    if (await isHealthy(url, chainId)) return url;
  }
  // All unhealthy — return the first one and let the caller surface the failure.
  throw new Error(
    `No healthy RPC. Tried: ${rpcUrls.join(', ')}. Check your internet connection or update the RPC list in Settings.`,
  );
}

export async function readClients(): Promise<{
  stargate: StargateClient;
  sentinel: SentinelQueryClient | undefined;
  url: string;
  disconnect: () => void;
}> {
  const url = await pickRPC();
  const tm = await Comet38Client.connect(url);
  const stargate = await StargateClient.create(tm);
  const sentinel = buildSentinelQueryClient(tm as unknown as AnyTm);
  return {
    stargate,
    sentinel,
    url,
    disconnect: () => {
      try {
        tm.disconnect();
      } catch {
        /* already closed */
      }
    },
  };
}

export async function signClient(signer: OfflineSigner): Promise<{
  client: SigningSentinelClient;
  url: string;
  disconnect: () => void;
}> {
  const url = await pickRPC();
  // No gasPrice in options — every broadcast passes an explicit StdFee.
  const client = await SigningSentinelClient.connectWithSigner(url, signer);
  return {
    client,
    url,
    disconnect: () => {
      try {
        client.disconnect();
      } catch {
        /* already closed */
      }
    },
  };
}

async function isHealthy(url: string, expectedChainId: string): Promise<boolean> {
  const cached = healthCache.get(url);
  if (cached && Date.now() - cached.at < PROBE_CACHE_TTL_MS && cached.ok) {
    return true;
  }
  const start = Date.now();
  try {
    const tm = await Comet38Client.connect(url);
    try {
      const sg = await StargateClient.create(tm);
      const chainId = await sg.getChainId();
      const height = await sg.getHeight();
      if (chainId !== expectedChainId) {
        healthCache.set(url, {
          ok: false,
          at: Date.now(),
          error: `chain mismatch: ${chainId} vs ${expectedChainId}`,
          chainId,
          blockHeight: height,
          latencyMs: Date.now() - start,
        });
        return false;
      }
      healthCache.set(url, {
        ok: true,
        at: Date.now(),
        chainId,
        blockHeight: height,
        latencyMs: Date.now() - start,
      });
      return true;
    } finally {
      tm.disconnect();
    }
  } catch (err) {
    log.debug('RPC probe failed', { url, err: (err as Error).message });
    healthCache.set(url, {
      ok: false,
      at: Date.now(),
      error: (err as Error).message,
      latencyMs: Date.now() - start,
    });
    return false;
  } finally {
    // Guarantee the probe doesn't hang forever
    setTimeout(() => undefined, PROBE_TIMEOUT_MS);
  }
}

export async function healthAll(): Promise<ChainHealth[]> {
  const { rpcUrls, chainId } = await getSettings();
  const out: ChainHealth[] = [];
  await Promise.all(
    rpcUrls.map(async (url) => {
      await isHealthy(url, chainId);
      const c = healthCache.get(url);
      out.push({
        rpcUrl: url,
        reachable: !!c?.ok,
        latencyMs: c?.latencyMs,
        chainId: c?.chainId,
        blockHeight: c?.blockHeight,
        error: c?.error,
      });
    }),
  );
  return out;
}

export function invalidateHealthCache(): void {
  healthCache.clear();
}
