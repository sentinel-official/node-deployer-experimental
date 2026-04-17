interface Props {
  percent: number;
  size?: number;
  stroke?: number;
  spinning?: boolean;
  label?: string;
  sublabel?: string;
}

/**
 * Circular progress indicator used on the Progress / Installing Node screen.
 * The "spinning" flag adds a secondary rotating arc for phases that are
 * genuinely indeterminate (e.g. waiting on remote apt).
 */
export function ProgressRing({
  percent,
  size = 200,
  stroke = 14,
  spinning = false,
  label,
  sublabel,
}: Props) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.max(0, Math.min(100, percent)) / 100);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="#1E2A4E"
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="url(#grad)"
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 400ms ease' }}
        />
        <defs>
          <linearGradient id="grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#6A8BFF" />
            <stop offset="100%" stopColor="#3A64E8" />
          </linearGradient>
        </defs>
      </svg>
      {spinning && (
        <svg
          width={size}
          height={size}
          className="absolute inset-0 ring-spin opacity-70"
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke="#4F7CFF"
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${circ * 0.1} ${circ}`}
          />
        </svg>
      )}
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <div className="text-4xl font-semibold text-text">
            {Math.round(percent)}
            <span className="text-xl text-text-muted">%</span>
          </div>
          {label && (
            <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-text-muted">
              {label}
            </div>
          )}
          {sublabel && <div className="mt-1 text-[10px] text-text-dim">{sublabel}</div>}
        </div>
      </div>
    </div>
  );
}
