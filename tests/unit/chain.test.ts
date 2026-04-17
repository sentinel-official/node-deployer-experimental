import { describe, expect, it } from 'vitest';
import { BECH32_PREFIX, DEFAULT_CHAIN_ID, DEFAULT_RPC_POOL, DENOM, dvpnToUdvpn, udvpnToDvpn } from '../../src/main/services/chain';

describe('chain constants', () => {
  it('locks Sentinel mainnet chain id', () => {
    expect(DEFAULT_CHAIN_ID).toBe('sentinelhub-2');
    expect(BECH32_PREFIX).toBe('sent');
    expect(DENOM).toBe('udvpn');
  });

  it('has at least three RPC endpoints for failover', () => {
    expect(DEFAULT_RPC_POOL.length).toBeGreaterThanOrEqual(3);
    for (const url of DEFAULT_RPC_POOL) {
      expect(url).toMatch(/^https:\/\//);
    }
  });
});

describe('denom conversion', () => {
  it('round-trips DVPN → udvpn → DVPN', () => {
    expect(udvpnToDvpn(dvpnToUdvpn(12.34))).toBeCloseTo(12.34, 6);
    expect(udvpnToDvpn(dvpnToUdvpn(0))).toBe(0);
    expect(udvpnToDvpn(dvpnToUdvpn(0.000001))).toBeCloseTo(0.000001, 6);
  });

  it('normalizes integer udvpn input', () => {
    expect(udvpnToDvpn('1000000')).toBe(1);
    expect(udvpnToDvpn(2_500_000n)).toBe(2.5);
    expect(dvpnToUdvpn(5)).toBe('5000000');
  });
});
