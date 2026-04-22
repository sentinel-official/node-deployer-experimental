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
        <svg
          width="26"
          height="26"
          viewBox="0 0 30 31"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="flex-shrink-0"
        >
          <path
            d="M27.3966 1.4387C27.7459 1.4387 28.0281 1.72093 28.0281 2.07017V12.1372V12.7626C28.0362 14.0032 28.0464 15.5525 27.8291 17.1951C27.5773 19.1099 27.0778 20.6672 26.3103 21.9566C23.8068 26.1535 19.3093 29.2297 15.0879 29.6399C15.0676 29.6419 15.0473 29.6439 15.027 29.6439C15.0067 29.6439 14.9864 29.6439 14.9661 29.6399C10.7407 29.2256 6.24323 26.1515 3.74372 21.9566C2.97214 20.6672 2.47671 19.1078 2.22493 17.1951C2.0097 15.5525 2.01986 14.0053 2.03001 12.7626V12.1372L2.03204 2.07017C2.03204 1.72093 2.31427 1.4387 2.66351 1.4387H27.3966ZM27.3966 0.17981H2.66148C1.61985 0.17981 0.771119 1.02854 0.771119 2.07017V12.7565C0.758936 13.9606 0.746754 15.6154 0.974166 17.3576C1.25031 19.4469 1.80057 21.1606 2.65945 22.6002C3.97926 24.8134 5.82292 26.7667 7.99349 28.253C10.1844 29.7515 12.5458 30.6632 14.826 30.8886C14.891 30.8967 14.958 30.9008 15.025 30.9008C15.092 30.9008 15.157 30.8967 15.224 30.8886C17.5022 30.6632 19.8636 29.7536 22.0545 28.2551C24.225 26.7688 26.0707 24.8134 27.3926 22.6002C28.2535 21.1586 28.8037 19.4449 29.0779 17.3596C29.3053 15.6337 29.2951 14.0418 29.287 12.7606V12.1332V2.0722C29.287 1.02854 28.4383 0.18184 27.3966 0.18184V0.17981Z"
            fill="#0156FC"
          />
          <path
            d="M25.6792 14.1846C25.864 14.3247 26.1279 14.1927 26.1279 13.9612L26.1218 12.6881V3.61598C26.1239 3.45963 25.998 3.33374 25.8416 3.33374H4.21715C4.0608 3.33374 3.93491 3.45963 3.93491 3.61598V9.1957C3.93491 9.43529 3.98974 9.67083 4.09735 9.88402C4.20496 10.0972 4.35928 10.284 4.55217 10.4262L20.8182 22.5907C20.9604 22.6963 20.9705 22.9013 20.8406 23.0232C20.5401 23.3074 20.2233 23.5734 19.8944 23.8252C19.7929 23.9024 19.6548 23.9024 19.5553 23.8272L4.38365 12.4587C4.19887 12.3206 3.93491 12.4505 3.93491 12.684C3.93491 14.6333 3.76232 18.2699 5.40091 21.0557C7.23036 24.1684 10.3715 26.6252 13.604 27.4212C14.071 27.5349 14.538 27.6161 15.005 27.6587C15.0233 27.6608 15.0416 27.6608 15.0578 27.6587C17.1736 27.4679 19.3259 26.5014 21.1736 25.0415C21.6365 24.6739 22.0812 24.278 22.5035 23.8536C23.336 23.0151 24.0629 22.077 24.6619 21.0597C25.2041 20.1399 25.5472 19.1267 25.7645 18.1135C25.8132 17.8942 25.8538 17.6729 25.8904 17.4495C25.9858 16.8688 25.7502 16.282 25.2812 15.9308L11.5086 5.63223C11.2933 5.46979 11.405 5.12664 11.6791 5.12664H13.5025C13.5634 5.12664 13.6223 5.14695 13.673 5.1835L25.6812 14.1866L25.6792 14.1846Z"
            fill="#0156FC"
          />
        </svg>
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
