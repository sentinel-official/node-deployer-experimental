import { app, safeStorage } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Bip39, EnglishMnemonic, Random, stringToPath } from '@cosmjs/crypto';
import { fromBech32 } from '@cosmjs/encoding';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import {
  BECH32_PREFIX,
  DENOM,
  dvpnToUdvpn,
  udvpnToDvpn,
} from './chain';
import { getSettings } from './settings';
import { readClients, signClient } from './sentinel-client';
import { readStore, writeStore } from './store';
import { addEvent } from './events';
import { log } from './logger';
import type {
  SendTxRequest,
  SendTxResult,
  WalletState,
} from '../../shared/types';

/**
 * App-level wallet.
 *
 *   • Mnemonic — real BIP-39 (24 words from 32 bytes CSPRNG entropy) or
 *     imported from the user.
 *   • Derivation — m/44'/118'/0'/0/0 (app wallet only). Per-node operator
 *     keys live on their respective nodes, not here.
 *   • Address — bech32 with prefix `sent`.
 *   • At rest — Electron safeStorage (OS keychain). Missing encryption =>
 *     refuse to persist.
 *   • Sends — SigningSentinelClient with gas auto-estimate, gas fallback,
 *     chain-id check, classified error codes.
 */

const MNEMONIC_FILE = 'wallet.secret';
const APP_HD_PATH = "m/44'/118'/0'/0/0";
// Sentinel's chain consumes a bit more gas than stock Cosmos MsgSend
// (observed ~122K for a simple send, presumably due to additional ante
// handlers from vpn + wasm modules). 250K gives generous headroom.
const GAS_FALLBACK = 250_000;

function mnemonicPath(): string {
  return path.join(app.getPath('userData'), MNEMONIC_FILE);
}

async function requireEncryption(): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'Encrypted storage is unavailable. Refusing to persist a plaintext mnemonic. ' +
        'On Linux, enable a keyring (gnome-keyring / kwallet). macOS Keychain and Windows DPAPI work by default.',
    );
  }
}

async function saveMnemonic(mnemonic: string): Promise<void> {
  await requireEncryption();
  const enc = safeStorage.encryptString(mnemonic);
  await fs.mkdir(path.dirname(mnemonicPath()), { recursive: true });
  await fs.writeFile(mnemonicPath(), enc);
}

async function loadMnemonic(): Promise<string> {
  await requireEncryption();
  const buf = await fs.readFile(mnemonicPath());
  return safeStorage.decryptString(buf);
}

async function hasMnemonicFile(): Promise<boolean> {
  try {
    await fs.access(mnemonicPath());
    return true;
  } catch {
    return false;
  }
}

async function appSigner(): Promise<DirectSecp256k1HdWallet> {
  const mnemonic = await loadMnemonic();
  return DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
    prefix: BECH32_PREFIX,
    hdPaths: [stringToPath(APP_HD_PATH)],
  });
}

/**
 * Generate a brand-new 24-word mnemonic + derived sent1 address, for a
 * freshly-deployed node. This is produced in-app so we can pre-seed the
 * node's keyring (via sentinelhub inside the container) and know the
 * operator address up-front — without waiting for the first on-chain
 * status heartbeat.
 */
export async function generateNodeKey(): Promise<{ mnemonic: string; address: string }> {
  const entropy = Random.getBytes(32);
  const mnemonic = Bip39.encode(entropy).toString();
  const signer = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
    prefix: BECH32_PREFIX,
    hdPaths: [stringToPath(APP_HD_PATH)],
  });
  const [{ address }] = await signer.getAccounts();
  return { mnemonic, address };
}

/** Build a signer from any mnemonic (used for node-level withdrawals). */
export async function signerFromMnemonic(mnemonic: string): Promise<DirectSecp256k1HdWallet> {
  return DirectSecp256k1HdWallet.fromMnemonic(mnemonic.trim(), {
    prefix: BECH32_PREFIX,
    hdPaths: [stringToPath(APP_HD_PATH)],
  });
}

function isValidBech32(addr: string): boolean {
  try {
    const { prefix } = fromBech32(addr);
    return prefix === BECH32_PREFIX;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getWallet(): Promise<WalletState> {
  const store = await readStore();
  const hasKey = await hasMnemonicFile();
  if (store.wallet && hasKey) {
    return { ...store.wallet, hasMnemonic: true };
  }
  return {
    address: null,
    balanceDVPN: 0,
    createdAt: null,
    hasMnemonic: false,
  };
}

export interface CreateWalletResult {
  wallet: WalletState;
  mnemonic: string;
}

export async function createWallet(): Promise<CreateWalletResult> {
  await requireEncryption();
  const entropy = Random.getBytes(32); // 256 bits → 24 words
  const mnemonic = Bip39.encode(entropy).toString();
  return persistMnemonic(mnemonic, 'wallet-created');
}

export async function restoreWallet(phrase: string): Promise<WalletState> {
  const trimmed = phrase.trim().toLowerCase().replace(/\s+/g, ' ');
  try {
    new EnglishMnemonic(trimmed);
  } catch {
    throw new Error('Invalid mnemonic — expected a BIP-39 English phrase of 12 / 15 / 18 / 21 / 24 words.');
  }
  const { wallet } = await persistMnemonic(trimmed, 'wallet-restored');
  return wallet;
}

async function persistMnemonic(
  mnemonic: string,
  kind: 'wallet-created' | 'wallet-restored',
): Promise<CreateWalletResult> {
  await saveMnemonic(mnemonic);
  const signer = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
    prefix: BECH32_PREFIX,
    hdPaths: [stringToPath(APP_HD_PATH)],
  });
  const [{ address }] = await signer.getAccounts();

  const wallet: WalletState = {
    address,
    balanceDVPN: 0,
    createdAt: new Date().toISOString(),
    hasMnemonic: true,
  };
  const store = await readStore();
  store.wallet = wallet;
  await writeStore(store);

  await addEvent({
    kind,
    title: kind === 'wallet-created' ? 'Wallet created' : 'Wallet restored',
    subtitle: `${address.slice(0, 10)}…${address.slice(-6)}`,
  });

  refreshWalletBalance().catch((err) => log.debug('initial balance refresh skipped', { err: String(err) }));
  return { wallet, mnemonic };
}

/** Query current DVPN balance for the app wallet. Silent on RPC failure. */
export async function refreshWalletBalance(): Promise<WalletState> {
  const store = await readStore();
  if (!store.wallet?.address) return getWallet();
  try {
    const balance = await fetchBalance(store.wallet.address);
    store.wallet.balanceDVPN = balance;
    await writeStore(store);
  } catch (err) {
    log.warn('wallet balance refresh failed', { err: (err as Error).message });
  }
  return store.wallet;
}

export async function fetchBalance(address: string): Promise<number> {
  const { stargate, disconnect } = await readClients();
  try {
    const coin = await stargate.getBalance(address, DENOM);
    return udvpnToDvpn(coin.amount);
  } finally {
    disconnect();
  }
}

/**
 * Sign + broadcast a MsgSend from the app wallet. Returns a
 * structured result so the UI can distinguish insufficient funds from
 * gas-estimation failures from RPC timeouts.
 */
export async function sendTokens(req: SendTxRequest): Promise<SendTxResult> {
  if (!isValidBech32(req.to.trim())) {
    return { ok: false, error: `Recipient "${req.to}" is not a valid sent1 address.`, errorCode: 'invalid-address' };
  }
  if (!(req.amountDVPN > 0)) {
    return { ok: false, error: 'Amount must be greater than 0.', errorCode: 'invalid-address' };
  }

  try {
    const settings = await getSettings();
    const signer = await appSigner();
    const [{ address: from }] = await signer.getAccounts();
    const { client, disconnect, url } = await signClient(signer);

    try {
      // Chain-id guard: abort if the selected RPC is on the wrong chain.
      const actualChainId = await client.getChainId();
      if (actualChainId !== settings.chainId) {
        return {
          ok: false,
          error: `RPC ${url} reports chain ${actualChainId} but app is configured for ${settings.chainId}. Aborting.`,
          errorCode: 'chain-mismatch',
        };
      }

      const coins = [{ denom: DENOM, amount: dvpnToUdvpn(req.amountDVPN) }];
      const memo = req.memo ?? '';
      // Explicit StdFee — using 'auto' would trip the SDK's dual-cosmjs
      // instanceof check on GasPrice. Gas is generous for MsgSend, and we
      // compute fee = gas * gasPriceUdvpn (rounded up).
      const gas = GAS_FALLBACK;
      const feeUdvpn = String(Math.max(1, Math.ceil(gas * Number(settings.gasPriceUdvpn))));
      const fee = { amount: [{ denom: DENOM, amount: feeUdvpn }], gas: String(gas) };
      const result = await client.sendTokens(from, req.to.trim(), coins, fee, memo);

      if (result.code !== 0) {
        const classified = classifyErr(result.rawLog ?? '');
        await addEvent({
          kind: 'withdraw-failed',
          title: 'Send failed',
          subtitle: sanitizeErr(result.rawLog),
          amountDVPN: -req.amountDVPN,
        });
        return { ok: false, error: sanitizeErr(result.rawLog), errorCode: classified };
      }

      await addEvent({
        kind: 'withdraw-sent',
        title: 'Send confirmed',
        subtitle: `to ${req.to.slice(0, 10)}…${req.to.slice(-6)}`,
        amountDVPN: -req.amountDVPN,
        txHash: result.transactionHash,
      });
      refreshWalletBalance().catch(() => undefined);

      return {
        ok: true,
        txHash: result.transactionHash,
        height: result.height,
        gasUsed: Number(result.gasUsed ?? 0),
      };
    } finally {
      disconnect();
    }
  } catch (err) {
    const msg = (err as Error).message ?? 'Unknown broadcast error';
    const classified = classifyErr(msg);
    log.error('sendTokens failed', { err: msg });
    await addEvent({
      kind: 'withdraw-failed',
      title: 'Send failed',
      subtitle: sanitizeErr(msg),
      amountDVPN: -req.amountDVPN,
    });
    return { ok: false, error: sanitizeErr(msg), errorCode: classified };
  }
}

export function classifyErr(rawLog: string): SendTxResult['errorCode'] {
  if (/insufficient funds|insufficient fee/i.test(rawLog)) return 'insufficient-funds';
  if (/account sequence mismatch|sequence mismatch/i.test(rawLog)) return 'sequence-mismatch';
  if (/invalid address|decoding bech32/i.test(rawLog)) return 'invalid-address';
  if (/timeout|context deadline exceeded|abort/i.test(rawLog)) return 'timeout';
  if (/connection refused|Network Error|ECONNREFUSED|ETIMEDOUT/i.test(rawLog)) return 'rpc-unavailable';
  if (/chain mismatch|chain-id/i.test(rawLog)) return 'chain-mismatch';
  if (/simulate|gas estimation/i.test(rawLog)) return 'gas-estimation-failed';
  return 'unknown';
}

function sanitizeErr(msg: string | undefined): string {
  if (!msg) return 'Unknown error';
  // Strip URLs (RPC leaks) and long hex blobs so event log stays clean.
  return msg
    .replace(/https?:\/\/\S+/g, '[rpc]')
    .replace(/0x[a-fA-F0-9]{8,}/g, '[hex]')
    .slice(0, 240);
}
