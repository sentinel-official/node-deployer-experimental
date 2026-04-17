import * as manager from './node-manager';
import type { DeployedNode, MetricsSample, MetricsWindow, NodeLiveStatus } from '../../shared/types';

/**
 * Thin IPC-layer facade over node-manager.ts. Keeps the IPC surface stable
 * even as the manager internals evolve.
 */

export const listNodes = () => manager.listNodes();
export const getNode = (id: string) => manager.getNode(id);
export const restartNode = (id: string) => manager.restartNode(id);
export const stopNode = (id: string) => manager.stopNode(id);
export const startNode = (id: string) => manager.startNode(id);
export const removeNode = (id: string) => manager.removeNode(id);
export const recentLogs = (id: string) => manager.recentLogs(id);
export const nodeStatus = (id: string) => manager.liveStatus(id);
export const nodeHistory = (id: string, window: MetricsWindow): MetricsSample[] =>
  manager.historyFor(id, window);
export const withdrawFromNode = (id: string, to: string, amount?: number) =>
  manager.withdrawFromNode(id, to, amount);
export const updateNodePricing = (
  id: string,
  gigabytePriceDVPN: number,
  hourlyPriceDVPN: number,
) => manager.updateNodePricing(id, gigabytePriceDVPN, hourlyPriceDVPN);

export type { DeployedNode, NodeLiveStatus };
