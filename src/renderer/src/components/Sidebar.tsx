import { useApp, type Route } from '../store/app';
import { shortAddr } from '../lib/format';
import { MIcon } from './MIcon';

interface Item {
  key: Route['name'];
  label: string;
  icon: string;
  route: Route;
}

const TOP: Item[] = [
  { key: 'overview', label: 'Overview', icon: 'dashboard', route: { name: 'overview' } },
  { key: 'nodes', label: 'Nodes', icon: 'dns', route: { name: 'nodes' } },
  { key: 'deploy', label: 'Deploy', icon: 'rocket_launch', route: { name: 'deploy' } },
  { key: 'wallet', label: 'Wallet', icon: 'account_balance_wallet', route: { name: 'wallet' } },
];

const BOTTOM: Item[] = [
  { key: 'settings', label: 'Settings', icon: 'settings', route: { name: 'settings' } },
  { key: 'help', label: 'Help', icon: 'help', route: { name: 'help' } },
];

export function Sidebar() {
  const { route, navigate, wallet } = useApp();
  const activeKey = activeKeyFor(route);

  const renderItem = (it: Item) => {
    const active = it.key === activeKey;
    return (
      <button
        key={it.key}
        onClick={() => navigate(it.route)}
        className={[
          'no-drag flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium w-full transition-colors',
          active
            ? 'bg-accent/15 text-text border border-accent/30'
            : 'text-text-muted hover:text-text hover:bg-bg-elev border border-transparent',
        ].join(' ')}
      >
        <MIcon name={it.icon} size={18} filled={active} />
        <span>{it.label}</span>
      </button>
    );
  };

  // macOS hidden-inset traffic lights sit at ~(14, 14); reserve vertical
  // space in the sidebar header on darwin so they don't overlap the logo.
  const isMac = window.api.platform === 'darwin';
  const headerPad = isMac ? 'pt-10' : 'pt-6';

  return (
    <aside className="w-60 flex-shrink-0 bg-bg-sidebar border-r border-border flex flex-col h-full overflow-hidden">
      <div className={`drag-region px-5 ${headerPad} pb-4 flex items-center gap-2.5 flex-shrink-0`}>
        <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-accent to-accent-strong flex items-center justify-center text-white">
          <MIcon name="shield" size={18} filled />
        </div>
        <div className="leading-tight">
          <div className="text-text font-semibold text-sm">Sentinel dVPN</div>
          <div className="text-[10px] text-text-dim uppercase tracking-[0.14em]">
            Network node operator
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 space-y-1 mt-2">{TOP.map(renderItem)}</nav>
      <nav className="px-3 space-y-1 pb-3 border-t border-border/50 pt-3">{BOTTOM.map(renderItem)}</nav>

      <div className="mx-3 mb-4 mt-1 p-3 rounded-xl bg-bg-card border border-border flex items-center gap-3">
        <div className="h-9 w-9 rounded-full bg-gradient-to-br from-accent/60 to-success/60 grid place-items-center">
          <MIcon name="person" size={18} className="text-white" />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-semibold text-text truncate">
            {wallet?.address ? 'Main wallet' : 'No wallet yet'}
          </div>
          <div className="text-[10px] text-text-dim font-mono truncate">
            {wallet?.address ? shortAddr(wallet.address, 6, 4) : 'create one to get started'}
          </div>
        </div>
      </div>
    </aside>
  );
}

function activeKeyFor(route: Route): Route['name'] {
  if (route.name === 'node-details') return 'nodes';
  if (route.name === 'progress') return 'deploy';
  if (route.name === 'remote-setup') return 'deploy';
  return route.name;
}
