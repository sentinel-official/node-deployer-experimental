import type { ComponentType } from 'react';
import {
  ArrowCircleUp,
  ArrowsClockwise,
  CheckCircle,
  CircleDashed,
  CloudSlash,
  Cpu,
  Key,
  PauseCircle,
  PlayCircle,
  Plugs,
  Rocket,
  SealCheck,
  ShieldCheck,
  SignOut,
  Trash,
  WarningCircle,
  type IconProps,
} from '@phosphor-icons/react';
import type { AppEvent, EventKind } from '../../../shared/types';

export const KIND_TONE: Record<EventKind, 'ok' | 'err' | 'warn' | 'accent'> = {
  'wallet-created': 'ok',
  'wallet-restored': 'ok',
  'wallet-logout': 'warn',
  'deploy-started': 'accent',
  'deploy-succeeded': 'ok',
  'deploy-failed': 'err',
  'node-started': 'ok',
  'node-stopped': 'warn',
  'node-restarted': 'accent',
  'node-removed': 'warn',
  'node-unreachable': 'err',
  'node-online': 'ok',
  'node-registered': 'ok',
  'specs-reported': 'accent',
  'specs-publish-failed': 'err',
  'withdraw-sent': 'ok',
  'withdraw-failed': 'err',
  'balance-refreshed': 'accent',
};

const KIND_ICON_MAP: Record<EventKind, ComponentType<IconProps>> = {
  'wallet-created': ShieldCheck,
  'wallet-restored': Key,
  'wallet-logout': SignOut,
  'deploy-started': Rocket,
  'deploy-succeeded': CheckCircle,
  'deploy-failed': WarningCircle,
  'node-started': PlayCircle,
  'node-stopped': PauseCircle,
  'node-restarted': ArrowsClockwise,
  'node-removed': Trash,
  'node-unreachable': CloudSlash,
  'node-online': Plugs,
  'node-registered': SealCheck,
  'specs-reported': Cpu,
  'specs-publish-failed': WarningCircle,
  'withdraw-sent': ArrowCircleUp,
  'withdraw-failed': WarningCircle,
  'balance-refreshed': ArrowsClockwise,
};

export function iconForKind(kind: EventKind): ComponentType<IconProps> {
  return KIND_ICON_MAP[kind] ?? CircleDashed;
}

export const KIND_ICON: Record<EventKind, ComponentType<IconProps>> = new Proxy(KIND_ICON_MAP, {
  get(target, prop: string) {
    return target[prop as EventKind] ?? CircleDashed;
  },
});

export function summarize(e: AppEvent): { title: string; subtitle: string } {
  return { title: e.title, subtitle: e.subtitle };
}
