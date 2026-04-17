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
 * falls through on failure. These are the three endpoints named by the
 * Sentinel docs + two community validators (AutoStake + Polkachu) with
 * historically strong uptime.
 */
export const DEFAULT_RPC_POOL: readonly string[] = [
  'https://rpc.sentinel.co:443',
  'https://sentinel-mainnet-rpc.autostake.com:443',
  'https://sentinel-rpc.polkachu.com:443',
];

export const udvpnToDvpn = (u: string | number | bigint): number => {
  const n = typeof u === 'bigint' ? Number(u) : Number(u);
  return n / 1_000_000;
};

export const dvpnToUdvpn = (d: number): string =>
  Math.round(d * 1_000_000).toString();
