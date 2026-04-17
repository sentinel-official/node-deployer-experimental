import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AppEvent, DeployedNode, WalletState } from '../../shared/types';

/**
 * Minimal on-disk JSON store.
 *
 * Secrets policy:
 *   - App wallet mnemonic lives at userData/wallet.secret, encrypted by
 *     Electron safeStorage (OS keychain).
 *   - Per-node operator mnemonics live on the node itself (in its own
 *     keyring). If the user opts to back one up in the app, it ends up in
 *     store.nodeBackups, also encrypted by safeStorage.
 *   - SSH credentials are never persisted.
 *
 * Everything else is fine to keep in plain JSON.
 */

interface StoreShape {
  wallet: WalletState | null;
  nodes: DeployedNode[];
  events: AppEvent[];
  logs: Record<string, string[]>;
  /** Base64-encoded safeStorage blobs keyed by node id. Nullable by design. */
  nodeBackups: Record<string, string | undefined>;
  /** SSH creds for remote nodes, held in-memory only at runtime; this field
   *  is always serialized as an empty object. */
  sshKeyring?: Record<string, never>;
}

const DEFAULT_STORE: StoreShape = {
  wallet: null,
  nodes: [],
  events: [],
  logs: {},
  nodeBackups: {},
};

let cached: StoreShape | null = null;

function storePath(): string {
  return path.join(app.getPath('userData'), 'store.json');
}

export async function readStore(): Promise<StoreShape> {
  if (cached) return cached;
  try {
    const raw = await fs.readFile(storePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<StoreShape>;
    cached = {
      wallet: parsed.wallet ?? null,
      nodes: parsed.nodes ?? [],
      events: parsed.events ?? [],
      logs: parsed.logs ?? {},
      nodeBackups: parsed.nodeBackups ?? {},
    };
  } catch {
    cached = structuredClone(DEFAULT_STORE);
  }
  return cached;
}

export async function writeStore(next: StoreShape): Promise<void> {
  cached = next;
  const dir = path.dirname(storePath());
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(storePath(), JSON.stringify(next, null, 2), 'utf8');
}
