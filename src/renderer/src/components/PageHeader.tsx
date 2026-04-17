interface Props {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  breadcrumb?: React.ReactNode;
}

export function PageHeader({ title, subtitle, right, breadcrumb }: Props) {
  return (
    <div className="mb-8">
      {breadcrumb && <div className="mb-2 text-xs text-text-dim">{breadcrumb}</div>}
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-text">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-text-muted">{subtitle}</p>}
        </div>
        {right && <div className="flex items-center gap-2 flex-wrap justify-end">{right}</div>}
      </div>
    </div>
  );
}
