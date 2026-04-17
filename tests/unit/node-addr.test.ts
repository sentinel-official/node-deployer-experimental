import { describe, expect, it } from 'vitest';
import { fromBech32, toBech32 } from '@cosmjs/encoding';

/**
 * Verify the account→node address conversion the manager relies on.
 * The `sent1…` account address and its `sentnode1…` node counterpart
 * share the same 20-byte payload; only the HRP differs. This is the
 * re-encode that makes chain probes find the node record.
 */
function accountToNodeAddr(addr: string): string {
  const { data } = fromBech32(addr);
  return toBech32('sentnode', data);
}

describe('accountToNodeAddr', () => {
  it('re-encodes a known account into its sentnode equivalent with matching payload', () => {
    // Real address observed in a deploy log.
    const account = 'sent1dgu245yeukdrfl6ze5m3ya5rnjlugpncl58wt5';
    const node = accountToNodeAddr(account);
    expect(node).toMatch(/^sentnode1/);
    expect(fromBech32(node).prefix).toBe('sentnode');
    expect(Buffer.from(fromBech32(node).data).toString('hex')).toBe(
      Buffer.from(fromBech32(account).data).toString('hex'),
    );
  });

  it('produces a valid bech32 with the correct HRP', () => {
    const account = 'sent1zsp0d48parruv603nwawm7av5mwwv4w5t36gwf';
    const node = accountToNodeAddr(account);
    expect(() => fromBech32(node)).not.toThrow();
    expect(node.startsWith('sentnode1')).toBe(true);
  });
});
