import type { AppEvent, EventKind } from '../../../shared/types';

export const KIND_TONE: Record<EventKind, 'ok' | 'err' | 'warn' | 'accent'> = {
  'wallet-created': 'ok',
  'wallet-restored': 'ok',
  'deploy-started': 'accent',
  'deploy-succeeded': 'ok',
  'deploy-failed': 'err',
  'node-stopped': 'warn',
  'node-restarted': 'accent',
  'node-removed': 'warn',
  'node-unreachable': 'err',
  'node-online': 'ok',
  'node-registered': 'ok',
  'withdraw-sent': 'ok',
  'withdraw-failed': 'err',
  'balance-refreshed': 'accent',
};

export const KIND_ICON_M: Record<EventKind, string> = {
  'wallet-created': 'shield',
  'wallet-restored': 'key',
  'deploy-started': 'rocket_launch',
  'deploy-succeeded': 'check_circle',
  'deploy-failed': 'error',
  'node-stopped': 'pause_circle',
  'node-restarted': 'restart_alt',
  'node-removed': 'delete',
  'node-unreachable': 'cloud_off',
  'node-online': 'check',
  'node-registered': 'verified',
  'withdraw-sent': 'arrow_upward',
  'withdraw-failed': 'error',
  'balance-refreshed': 'refresh',
};

export function summarize(e: AppEvent): { title: string; subtitle: string } {
  return { title: e.title, subtitle: e.subtitle };
}
