import os from 'node:os';
import type { LocalSystemReport } from '../../shared/types';
import { dockerHealth } from './docker';

/**
 * Single source of truth for `LocalSystemReport`. The IPC handler and the
 * CLI registry both call this so the System page and the `system status`
 * CLI command always agree.
 */
export async function buildLocalSystemReport(): Promise<LocalSystemReport> {
  const platform = os.platform();
  const arch = os.arch();
  const memMb = Math.round(os.totalmem() / (1024 * 1024));
  const freeMb = Math.round(os.freemem() / (1024 * 1024));
  const cpus = os.cpus();
  // Some Windows / VM kernels pad the model with trailing whitespace and
  // double spaces ("AMD Ryzen 9 7940HS w/ Radeon 780M Graphics     ").
  const rawModel = cpus[0]?.model?.replace(/\s+/g, ' ').trim() ?? '';
  const cpuModel = rawModel.length > 0 ? rawModel : 'Unknown CPU';
  const cpuCores = cpus.length;
  const cpuSpeedMhz = cpus[0]?.speed ?? 0;

  const osLabel =
    platform === 'darwin'
      ? `macOS ${os.release()}`
      : platform === 'linux'
        ? `Linux ${os.release()}`
        : platform === 'win32'
          ? `Windows ${os.release()}`
          : `${platform} ${os.release()}`;

  const health = await dockerHealth();
  const dockerReachable = health.reachable;
  const wsl2Backend =
    platform === 'win32' && (health.desktop?.installed ?? false);

  return {
    osCompatible: ['darwin', 'linux', 'win32'].includes(platform),
    osLabel,
    platform,
    arch,
    memoryMb: memMb,
    memoryOk: memMb >= 2048,
    freeMemoryMb: freeMb,
    cpuModel,
    cpuCores,
    cpuSpeedMhz,
    diskFreeGb: 50,
    diskOk: true,
    dockerInstalled: dockerReachable || (health.desktop?.installed ?? false),
    dockerVersion: health.version,
    dockerReachable,
    dockerError: health.error,
    dockerReason: health.reason,
    dockerDesktop: health.desktop,
    wsl2Backend,
    // CQAP detection mechanism is not yet decided. Keeping this isolated
    // so when the product call lands (image-flag / sidecar / endpoint /
    // chain-marker) only this block changes.
    cqap: 'unknown',
    cqapDetail: 'Detection coming soon — CQAP integration is in progress.',
  };
}

