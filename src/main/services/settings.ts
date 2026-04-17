import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_CHAIN_ID,
  DEFAULT_GAS_PRICE_UDVPN,
  DEFAULT_RPC_POOL,
} from './chain';
import type { AppSettings } from '../../shared/types';

let cache: AppSettings | null = null;

function file() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function defaults(): AppSettings {
  return {
    rpcUrls: [...DEFAULT_RPC_POOL],
    chainId: DEFAULT_CHAIN_ID,
    gasPriceUdvpn: DEFAULT_GAS_PRICE_UDVPN,
    dockerSocket: '',
    seenOnboarding: false,
  };
}

export async function getSettings(): Promise<AppSettings> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(file(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    cache = { ...defaults(), ...parsed };
    // Normalize: strip empty strings from rpc pool
    cache.rpcUrls = cache.rpcUrls.filter((u) => u && u.trim()).map((u) => u.trim());
    if (cache.rpcUrls.length === 0) cache.rpcUrls = [...DEFAULT_RPC_POOL];
  } catch {
    cache = defaults();
  }
  return cache;
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings();
  const next: AppSettings = { ...current, ...patch };
  if (patch.rpcUrls) {
    next.rpcUrls = patch.rpcUrls.filter((u) => u && u.trim()).map((u) => u.trim());
    if (next.rpcUrls.length === 0) next.rpcUrls = [...DEFAULT_RPC_POOL];
  }
  cache = next;
  await fs.mkdir(path.dirname(file()), { recursive: true });
  await fs.writeFile(file(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}
