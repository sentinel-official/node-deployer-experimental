interface Props {
  label: string;
  value: React.ReactNode;
  caption?: React.ReactNode;
  icon?: React.ReactNode;
  accent?: 'default' | 'success' | 'warning' | 'accent';
}

export function StatCard({ label, value, caption, icon, accent = 'default' }: Props) {
  const accentCls = {
    default: 'text-text',
    success: 'text-success',
    warning: 'text-warning',
    accent: 'text-accent',
  }[accent];
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wider text-text-muted">
          {label}
        </div>
        {icon && <div className="text-text-muted">{icon}</div>}
      </div>
      <div className={`mt-2 text-2xl font-semibold ${accentCls}`}>{value}</div>
      {caption && <div className="mt-1 text-xs text-text-dim">{caption}</div>}
    </div>
  );
}
