import { create } from 'zustand';
import type {
  AppEvent,
  AppSettings,
  ChainHealth,
  DeployProgress,
  DeployedNode,
  MetricsSample,
  MetricsWindow,
  NodeLiveStatus,
  WalletState,
} from '../../../shared/types';

export type Route =
  | { name: 'wallet-setup' }
  | { name: 'overview' }
  | { name: 'nodes' }
  | { name: 'node-details'; id: string }
  | { name: 'deploy-local' }
  | { name: 'deploy-ssh' }
  | { name: 'deploy-ssh-batch' }
  | { name: 'progress'; jobId: string; moniker: string; origin?: 'local' | 'ssh' }
  | { name: 'wallet' }
  | { name: 'settings' }
  | { name: 'manage-docker' }
  | { name: 'cli' }
  | { name: 'help' };

export interface Toast {
  id: string;
  title: string;
  body?: string;
  tone?: 'success' | 'error' | 'warn' | 'info';
  durationMs?: number;
}

export interface ConfirmPrompt {
  id: string;
  title: string;
  body?: string;
  tone?: 'info' | 'warning' | 'danger';
  confirmLabel?: string;
  cancelLabel?: string;
  /** When set, user must type this string to enable the confirm button. */
  requireType?: string;
  resolve: (ok: boolean) => void;
}

interface AppState {
  // routing
  route: Route;
  history: Route[];
  navigate: (r: Route) => void;
  goBack: () => void;
  canGoBack: boolean;

  // data
  wallet: WalletState | null;
  walletBootstrapped: boolean;
  bootError: string | null;
  setWallet: (w: WalletState | null) => void;
  refreshWallet: () => Promise<void>;
  logoutWallet: () => Promise<void>;

  nodes: DeployedNode[];
  refreshNodes: () => Promise<void>;

  events: AppEvent[];
  refreshEvents: () => Promise<void>;

  settings: AppSettings | null;
  refreshSettings: () => Promise<void>;
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>;

  chainHealth: ChainHealth[];
  refreshChainHealth: () => Promise<void>;

  liveStatuses: Record<string, NodeLiveStatus>;
  refreshStatus: (id: string) => Promise<NodeLiveStatus>;

  nodeHistory: Record<string, MetricsSample[]>;
  loadHistory: (id: string, window: MetricsWindow) => Promise<MetricsSample[]>;

  progress: DeployProgress | null;
  setProgress: (p: DeployProgress | null) => void;

  // chrome: toasts + confirm + connectivity
  toasts: Toast[];
  pushToast: (t: Omit<Toast, 'id'>) => string;
  dismissToast: (id: string) => void;

  confirmPrompt: ConfirmPrompt | null;
  confirm: (opts: Omit<ConfirmPrompt, 'id' | 'resolve'>) => Promise<boolean>;
  resolveConfirm: (ok: boolean) => void;

  online: boolean;

  bootstrap: () => Promise<void>;
}

const genId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

export const useApp = create<AppState>((set, get) => ({
  route: { name: 'wallet-setup' },
  history: [],
  canGoBack: false,
  navigate: (r) =>
    set((s) => ({
      route: r,
      history: [...s.history, s.route].slice(-30),
      canGoBack: true,
    })),
  goBack: () => {
    const { history } = get();
    const prev = history[history.length - 1];
    if (!prev) return;
    set({
      route: prev,
      history: history.slice(0, -1),
      canGoBack: history.length - 1 > 0,
    });
  },

  wallet: null,
  walletBootstrapped: false,
  bootError: null,
  setWallet: (wallet) => set({ wallet }),
  refreshWallet: async () => {
    try {
      const wallet = await window.api.wallet.refreshBalance();
      set({ wallet });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[refreshWallet]', e);
    }
  },
  logoutWallet: async () => {
    await window.api.wallet.logout();
    set({ wallet: null, history: [], canGoBack: false, route: { name: 'wallet-setup' } });
  },

  nodes: [],
  refreshNodes: async () => {
    try {
      set({ nodes: await window.api.nodes.list() });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[refreshNodes]', e);
    }
  },

  events: [],
  refreshEvents: async () => {
    try {
      set({ events: await window.api.events.list(50) });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[refreshEvents]', e);
    }
  },

  settings: null,
  refreshSettings: async () => {
    try {
      set({ settings: await window.api.settings.get() });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[refreshSettings]', e);
    }
  },
  saveSettings: async (patch) => set({ settings: await window.api.settings.set(patch) }),

  chainHealth: [],
  refreshChainHealth: async () => {
    try {
      set({ chainHealth: await window.api.settings.chainHealth() });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[refreshChainHealth]', e);
    }
  },

  liveStatuses: {},
  refreshStatus: async (id) => {
    const status = await window.api.nodes.status(id);
    set((s) => ({ liveStatuses: { ...s.liveStatuses, [id]: status } }));
    return status;
  },

  nodeHistory: {},
  loadHistory: async (id, w) => {
    const samples = await window.api.nodes.history(id, w);
    set((s) => ({ nodeHistory: { ...s.nodeHistory, [id]: samples } }));
    return samples;
  },

  progress: null,
  setProgress: (progress) => set({ progress }),

  toasts: [],
  pushToast: (t) => {
    const id = genId();
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
    return id;
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  confirmPrompt: null,
  confirm: (opts) =>
    new Promise<boolean>((resolve) => {
      set({
        confirmPrompt: {
          ...opts,
          id: genId(),
          resolve,
        },
      });
    }),
  resolveConfirm: (ok) => {
    const p = get().confirmPrompt;
    if (!p) return;
    p.resolve(ok);
    set({ confirmPrompt: null });
  },

  online: typeof navigator !== 'undefined' ? navigator.onLine : true,

  bootstrap: async () => {
    if (bootstrapped) return;
    bootstrapped = true;
    try {
      const [walletR, nodesR, eventsR, settingsR, chainR] = await Promise.allSettled([
        window.api.wallet.get(),
        window.api.nodes.list(),
        window.api.events.list(50),
        window.api.settings.get(),
        window.api.settings.chainHealth(),
      ]);
      const wallet = walletR.status === 'fulfilled' ? walletR.value : null;
      const nodes = nodesR.status === 'fulfilled' ? nodesR.value : [];
      const events = eventsR.status === 'fulfilled' ? eventsR.value : [];
      const settings = settingsR.status === 'fulfilled' ? settingsR.value : null;
      const chainHealth = chainR.status === 'fulfilled' ? chainR.value : [];

      const critical = [walletR, settingsR].filter((r) => r.status === 'rejected');
      if (critical.length > 0 && !wallet && !settings) {
        const reason = (critical[0] as PromiseRejectedResult).reason;
        set({
          bootError:
            reason instanceof Error ? reason.message : String(reason ?? 'Bootstrap failed'),
          walletBootstrapped: true,
        });
        return;
      }

      const hasWallet = Boolean(wallet?.address);
      set({
        wallet,
        nodes,
        events,
        settings,
        chainHealth,
        walletBootstrapped: true,
        bootError: null,
        route: hasWallet ? { name: 'overview' } : { name: 'wallet-setup' },
      });

      window.api.deploy.onProgress((p) => {
        get().setProgress(p);
        if (p.phase === 'done') {
          get().pushToast({
            title: 'Node deployed',
            body: `${p.message} · ${p.operatorAddress?.slice(0, 12) ?? ''}…`,
            tone: 'success',
          });
        } else if (p.phase === 'error') {
          get().pushToast({ title: 'Deployment failed', body: p.message, tone: 'error' });
        }
        if (p.phase === 'done' || p.phase === 'error') void get().refreshNodes();
      });
      window.api.nodes.onChanged(() => void get().refreshNodes());
      window.api.events.onChanged(() => void get().refreshEvents());

      window.addEventListener('online', () => set({ online: true }));
      window.addEventListener('offline', () => set({ online: false }));

      window.addEventListener('keydown', (e) => {
        const mod = e.metaKey || e.ctrlKey;
        if (mod && e.key === 'r') {
          e.preventDefault();
          void get().refreshWallet();
          void get().refreshNodes();
        }
        if (mod && e.key === ',') {
          e.preventDefault();
          get().navigate({ name: 'settings' });
        }
        if (e.key === 'Escape') {
          if (get().confirmPrompt) get().resolveConfirm(false);
        }
      });

      if (hasWallet) void get().refreshWallet();
    } catch (e) {
      bootstrapped = false;
      set({
        bootError: e instanceof Error ? e.message : String(e),
        walletBootstrapped: true,
      });
    }
  },
}));

let bootstrapped = false;
