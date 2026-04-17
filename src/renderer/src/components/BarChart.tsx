interface Props {
  data: number[];
  height?: number;
  labels?: string[];
}

/**
 * Ultra-lightweight SVG bar chart — used by the Node Details page for the
 * "Connections over time" card. Good enough visually; we avoid a heavy
 * charting dep until something calls for it.
 */
export function BarChart({ data, height = 160, labels }: Props) {
  const max = Math.max(1, ...data);
  return (
    <div>
      <svg viewBox={`0 0 ${data.length * 10} ${height}`} className="w-full" preserveAspectRatio="none" style={{ height }}>
        <defs>
          <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6A8BFF" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#3A64E8" stopOpacity="0.15" />
          </linearGradient>
        </defs>
        {data.map((v, i) => {
          const h = (v / max) * (height - 20);
          return (
            <rect
              key={i}
              x={i * 10 + 2}
              y={height - h - 8}
              width={6}
              height={h}
              rx={2}
              fill="url(#barGrad)"
            />
          );
        })}
      </svg>
      {labels && (
        <div className="mt-2 flex justify-between text-[10px] text-text-dim">
          {labels.map((l) => (
            <span key={l}>{l}</span>
          ))}
        </div>
      )}
    </div>
  );
}
