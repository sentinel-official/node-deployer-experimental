/**
 * Sentinel Hub chain constants + small helpers.
 *
 * Coin type 118 is the standard Cosmos SLIP-0044 entry. Sentinel's bech32
 * prefix is `sent`. Base denom is `udvpn` with 6 decimals; UI display is
 * `DVPN` = udvpn / 1e6.
 */

export const DENOM = 'udvpn';
export const DISPLAY = 'DVPN';
export const DECIMALS = 6;
export const BECH32_PREFIX = 'sent';

export const DEFAULT_CHAIN_ID = 'sentinelhub-2';
export const DEFAULT_GAS_PRICE_UDVPN = '0.1';

/**
 * Public RPC pool. The app picks whichever endpoint answers fastest and
 * falls through on failure.
 *
 * Synced with blue-js-sdk@2.7.1 RPC_ENDPOINTS (defaults.js, verified
 * 2026-05-02 by `audit-rpc-endpoints.mjs`). Notably excludes
 * `rpc.sentinel.co` — on 2026-05-02 it was ~22k blocks behind tip and
 * returning 0 for funded addresses while reporting `catching_up=false`,
 * which silently breaks balance and node-status queries.
 */
export const DEFAULT_RPC_POOL: readonly string[] = [
  'https://rpc-sentinel.busurnode.com',
  'https://rpc.trinitystake.io',
  'https://sentinel-rpc.publicnode.com',
  'https://sentinel-rpc.polkachu.com',
  'https://rpc.mathnodes.com',
  'https://rpc.dvpn.roomit.xyz',
  'https://rpc.sentinel.suchnode.net',
  'https://rpc.sentinel.chaintools.tech',
  'https://rpc.sentinel.validatus.com',
  'https://rpc.sentinel.quokkastake.io',
  'https://rpc.sentineldao.com',
  'https://rpc-sentinel.chainvibes.com',
];

export const udvpnToDvpn = (u: string | number | bigint): number => {
  const n = typeof u === 'bigint' ? Number(u) : Number(u);
  return n / 1_000_000;
};

export const dvpnToUdvpn = (d: number): string =>
  Math.round(d * 1_000_000).toString();
