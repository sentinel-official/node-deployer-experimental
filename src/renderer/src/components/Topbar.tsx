import { useApp } from '../store/app';
import { fmtDVPN } from '../lib/format';
import { MIcon } from './MIcon';

export function Topbar() {
  const { wallet, refreshWallet, settings, online, canGoBack, goBack, chainHealth } = useApp();

  const healthy = chainHealth.filter((h) => h.reachable).length;
  const healthDot =
    chainHealth.length === 0
      ? 'bg-text-dim'
      : healthy === 0
      ? 'bg-danger'
      : healthy < chainHealth.length
      ? 'bg-warning'
      : 'bg-success';

  return (
    <header className="drag-region h-14 border-b border-border flex items-center px-4 gap-2">
      <button
        className={`no-drag h-8 w-8 grid place-items-center rounded-lg text-text-muted hover:text-text hover:bg-bg-elev ${canGoBack ? '' : 'opacity-30 pointer-events-none'}`}
        onClick={goBack}
        title="Back"
        aria-label="Back"
      >
        <MIcon name="arrow_back" size={18} />
      </button>

      <div className="flex-1" />

      {!online && (
        <div className="no-drag chip-warn text-[11px]">
          <MIcon name="wifi_off" size={14} />
          Offline
        </div>
      )}

      <button
        className="no-drag flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] hover:bg-bg-elev"
        onClick={() => void refreshWallet()}
        title="Refresh balance"
      >
        <MIcon name="refresh" size={14} className="text-text-muted" />
        <span className="text-text-muted uppercase tracking-wider">Balance</span>
        <span className="text-text font-semibold text-sm">
          {wallet ? fmtDVPN(wallet.balanceDVPN) : '0.00'} $P2P
        </span>
      </button>

      <div
        className="no-drag flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-bg-elev text-[10px] uppercase tracking-wider text-text-muted"
        title={
          chainHealth.length
            ? chainHealth
                .map((h) => `${h.rpcUrl.replace('https://', '')}: ${h.reachable ? 'ok' : h.error ?? 'down'}`)
                .join('\n')
            : 'probing…'
        }
      >
        <span className={`h-1.5 w-1.5 rounded-full ${healthDot}`} />
        {settings?.chainId ?? 'sentinelhub-2'}
      </div>
    </header>
  );
}
