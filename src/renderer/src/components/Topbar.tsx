import { useApp } from '../store/app';
import { fmtDVPN } from '../lib/format';
import { MIcon } from './MIcon';
import { useTheme } from '../lib/theme';

export function Topbar() {
  const {
    wallet,
    refreshWallet,
    settings,
    online,
    canGoBack,
    goBack,
    chainHealth,
    progress,
    route,
    navigate,
    nodes,
  } = useApp();
  const [theme, , toggleTheme] = useTheme();

  const deployActive =
    progress &&
    progress.phase !== 'done' &&
    progress.phase !== 'error' &&
    route.name !== 'progress';
  const activeNode = deployActive
    ? nodes.find((n) => n.id === progress.nodeId)
    : null;
  const deployMoniker = activeNode?.moniker ?? 'node';

  const healthy = chainHealth.filter((h) => h.reachable).length;
  const healthDot =
    chainHealth.length === 0
      ? 'var(--text-dim)'
      : healthy === 0
        ? 'var(--red)'
        : healthy < chainHealth.length
          ? 'var(--yellow)'
          : 'var(--green)';

  return (
    <header
      className="drag-region flex items-center px-6 gap-3 flex-shrink-0"
      style={{
        height: 'var(--header-h)',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg)',
      }}
    >
      <button
        className={`no-drag btn btn-ghost !p-2 ${canGoBack ? '' : 'opacity-30 pointer-events-none'}`}
        onClick={goBack}
        title="Back"
        aria-label="Back"
      >
        <MIcon name="arrow_back" size={18} />
      </button>

      <div className="flex-1" />

      {deployActive && (
        <button
          className="no-drag flex items-center gap-2 px-3 py-1.5"
          onClick={() =>
            navigate({
              name: 'progress',
              jobId: progress.jobId,
              moniker: deployMoniker,
            })
          }
          title={`${progress.message} — click to return`}
          style={{
            background: 'var(--accent-dim)',
            border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--text)',
          }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{
              background: 'var(--accent)',
              animation: 'pulse-dot 1.4s ease-in-out infinite',
            }}
          />
          <span className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
            Deploying
          </span>
          <span className="text-[12px] font-semibold truncate max-w-[140px]">
            {deployMoniker}
          </span>
          <span
            className="tabular-nums text-[12px] font-semibold"
            style={{ color: 'var(--accent-bright, var(--accent))' }}
          >
            {Math.round(progress.percent)}%
          </span>
        </button>
      )}

      {!online && (
        <span className="no-drag chip chip-warn">
          <MIcon name="wifi_off" size={12} />
          Offline
        </span>
      )}

      <button
        className="no-drag flex items-center gap-2 px-3 py-2 text-xs"
        onClick={() => void refreshWallet()}
        title="Refresh balance"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--text-dim)',
        }}
      >
        <MIcon name="refresh" size={14} />
        <span className="uppercase tracking-wider">Balance</span>
        <span className="font-bold text-[13px]" style={{ color: 'var(--text)' }}>
          {wallet ? fmtDVPN(wallet.balanceDVPN) : '0.00'} $P2P
        </span>
      </button>

      <div
        className="no-drag flex items-center gap-2 px-3 py-2 text-[10px] uppercase tracking-wider"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 999,
          color: 'var(--text-dim)',
        }}
        title={
          chainHealth.length
            ? chainHealth
                .map(
                  (h) =>
                    `${h.rpcUrl.replace('https://', '')}: ${h.reachable ? 'ok' : (h.error ?? 'down')}`,
                )
                .join('\n')
            : 'probing…'
        }
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: healthDot }}
        />
        {settings?.chainId ?? 'sentinelhub-2'}
      </div>

      <button
        className="no-drag btn btn-ghost !p-2"
        onClick={toggleTheme}
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        aria-label="Toggle theme"
      >
        <MIcon name={theme === 'dark' ? 'light_mode' : 'dark_mode'} size={18} />
      </button>
    </header>
  );
}
