import { describe, expect, it } from 'vitest';
import { parseInitOutput } from '../../src/main/services/deploy';

describe('parseInitOutput', () => {
  it('extracts the operator address from sentinel-dvpnx init output', () => {
    const sample = `
Generating key "operator"

- name: operator
  type: local
  address: sent1yftwk6a4h5fk4xzp3znk6puqj92uxw7jhxwd76
  pubkey: sentpub1abc
`;
    const r = parseInitOutput(sample);
    expect(r.operatorAddress).toBe('sent1yftwk6a4h5fk4xzp3znk6puqj92uxw7jhxwd76');
  });

  it('extracts a mnemonic from init output when present', () => {
    const sample = `
**Important** write this mnemonic phrase in a safe place.

mnemonic: tribe solution puppy eager nasty lonely advice gym worth above oblige rocket salmon merit cloth exchange ranch bulk flock quote orient vehicle flush vessel

- address: sent1pqr0vsjxuarn7g3aghe4qsyhtnnu2f42qx5vjx
`;
    const r = parseInitOutput(sample);
    expect(r.operatorAddress).toBe('sent1pqr0vsjxuarn7g3aghe4qsyhtnnu2f42qx5vjx');
    expect(r.mnemonic).toBeDefined();
    expect(r.mnemonic?.split(/\s+/).length).toBe(24);
  });

  it('returns undefined when output is empty', () => {
    const r = parseInitOutput('');
    expect(r.operatorAddress).toBeUndefined();
    expect(r.mnemonic).toBeUndefined();
  });
});
