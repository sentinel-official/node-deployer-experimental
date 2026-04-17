import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

// `electron` is a native module we don't have in test — stub it.
vi.mock('electron', () => ({
  app: {
    getPath: () => {
      // Each test case gets its own temp dir via beforeEach(), but electron
      // itself calls through getPath('userData'); we keep a single dir.
      const dir = process.env['SENTINEL_TEST_USERDATA'];
      if (!dir) throw new Error('SENTINEL_TEST_USERDATA not set');
      return dir;
    },
  },
}));

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sentinel-metrics-'));
  process.env['SENTINEL_TEST_USERDATA'] = tmp;
  // Force fresh DB instance per test — reset module cache.
  vi.resetModules();
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
  delete process.env['SENTINEL_TEST_USERDATA'];
});

describe('metrics store', () => {
  it('records and queries samples for a node within the window', async () => {
    const { recordSample, history } = await import('../../src/main/services/metrics');
    const now = Date.now();
    recordSample({
      nodeId: 'n1',
      ts: now - 10_000,
      peers: 4,
      bytesIn: 1000,
      bytesOut: 2000,
      earningsUdvpn: 123,
      chainHeight: 100,
      reachable: true,
    });
    recordSample({
      nodeId: 'n1',
      ts: now,
      peers: 5,
      bytesIn: 1500,
      bytesOut: 3000,
      earningsUdvpn: 200,
      chainHeight: 101,
      reachable: true,
    });
    const rows = history('n1', '1h');
    expect(rows.length).toBe(2);
    expect(rows[0].peers).toBe(4);
    expect(rows[1].peers).toBe(5);
  });

  it('purges samples when a node is removed', async () => {
    const { recordSample, history, purgeNode } = await import('../../src/main/services/metrics');
    recordSample({
      nodeId: 'n2',
      ts: Date.now(),
      peers: 1,
      bytesIn: 0,
      bytesOut: 0,
      earningsUdvpn: 0,
      reachable: true,
    });
    expect(history('n2', '1h').length).toBe(1);
    purgeNode('n2');
    expect(history('n2', '1h').length).toBe(0);
  });

  it('filters out samples older than the window', async () => {
    const { recordSample, history } = await import('../../src/main/services/metrics');
    const old = Date.now() - 2 * 60 * 60 * 1000;
    recordSample({
      nodeId: 'n3',
      ts: old,
      peers: 9,
      bytesIn: 0,
      bytesOut: 0,
      earningsUdvpn: 0,
      reachable: true,
    });
    expect(history('n3', '1h').length).toBe(0);
    expect(history('n3', '24h').length).toBe(1);
  });
});
