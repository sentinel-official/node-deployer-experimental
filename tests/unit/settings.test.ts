import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

vi.mock('electron', () => ({
  app: { getPath: () => process.env['SENTINEL_TEST_USERDATA'] ?? '' },
}));

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sentinel-settings-'));
  process.env['SENTINEL_TEST_USERDATA'] = tmp;
  vi.resetModules();
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
  delete process.env['SENTINEL_TEST_USERDATA'];
});

describe('settings persistence', () => {
  it('returns defaults when no settings.json exists', async () => {
    const { getSettings } = await import('../../src/main/services/settings');
    const s = await getSettings();
    expect(s.chainId).toBe('sentinelhub-2');
    expect(s.rpcUrls.length).toBeGreaterThanOrEqual(3);
    expect(s.dockerSocket).toBe('');
    expect(s.seenOnboarding).toBe(false);
  });

  it('persists a patch and returns it on the next read', async () => {
    const { getSettings, updateSettings } = await import('../../src/main/services/settings');
    await updateSettings({
      gasPriceUdvpn: '0.3',
      dockerSocket: '/custom/sock',
      seenOnboarding: true,
    });
    const s = await getSettings();
    expect(s.gasPriceUdvpn).toBe('0.3');
    expect(s.dockerSocket).toBe('/custom/sock');
    expect(s.seenOnboarding).toBe(true);
  });

  it('filters empty RPC URLs and resets to defaults when list becomes empty', async () => {
    const { updateSettings } = await import('../../src/main/services/settings');
    const s = await updateSettings({ rpcUrls: ['  ', '', ''] });
    // Empty list → defaults back to the pool
    expect(s.rpcUrls.length).toBeGreaterThanOrEqual(3);
  });
});
