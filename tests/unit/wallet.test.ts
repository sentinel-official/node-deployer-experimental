import { describe, expect, it } from 'vitest';
import { Bip39, EnglishMnemonic, Random, stringToPath } from '@cosmjs/crypto';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { fromBech32 } from '@cosmjs/encoding';
import { classifyErr } from '../../src/main/services/wallet';
import { BECH32_PREFIX } from '../../src/main/services/chain';

describe('wallet crypto', () => {
  it('generates a valid 24-word BIP-39 mnemonic and derives a sent1 address', async () => {
    const entropy = Random.getBytes(32);
    const mnemonic = Bip39.encode(entropy).toString();
    expect(mnemonic.split(/\s+/)).toHaveLength(24);
    new EnglishMnemonic(mnemonic); // throws if invalid

    const hd = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
      prefix: BECH32_PREFIX,
      hdPaths: [stringToPath("m/44'/118'/0'/0/0")],
    });
    const [{ address }] = await hd.getAccounts();
    expect(address).toMatch(/^sent1[0-9a-z]{38,58}$/);

    // Bech32 checksum valid
    expect(() => fromBech32(address)).not.toThrow();
    expect(fromBech32(address).prefix).toBe(BECH32_PREFIX);
  });

  it('rejects malformed mnemonics', () => {
    expect(() => new EnglishMnemonic('not a real phrase at all')).toThrow();
    expect(() => new EnglishMnemonic('word '.repeat(11).trim())).toThrow();
  });
});

describe('error classification', () => {
  it('recognises insufficient funds', () => {
    expect(classifyErr('insufficient funds: 1000udvpn < 5000udvpn')).toBe('insufficient-funds');
  });
  it('recognises sequence mismatch', () => {
    expect(classifyErr('account sequence mismatch, expected 5 got 4')).toBe('sequence-mismatch');
  });
  it('recognises invalid address', () => {
    expect(classifyErr('invalid address: decoding bech32 failed')).toBe('invalid-address');
  });
  it('recognises timeout', () => {
    expect(classifyErr('context deadline exceeded')).toBe('timeout');
  });
  it('recognises RPC unavailable', () => {
    expect(classifyErr('connect ECONNREFUSED 1.2.3.4:443')).toBe('rpc-unavailable');
  });
  it('recognises chain mismatch', () => {
    expect(classifyErr('chain-id mismatch')).toBe('chain-mismatch');
  });
  it('defaults to unknown', () => {
    expect(classifyErr('something weird happened')).toBe('unknown');
  });
});

describe('bech32 checksum validation', () => {
  it('accepts our derived addresses and rejects typos', () => {
    const good = 'sent1yftwk6a4h5fk4xzp3znk6puqj92uxw7jhxwd76';
    // tamper one char
    const bad = good.slice(0, -1) + (good.slice(-1) === 'a' ? 'b' : 'a');
    expect(() => fromBech32(good)).not.toThrow();
    expect(() => fromBech32(bad)).toThrow();
  });
});
