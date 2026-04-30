interface Props {
  title: string;
  /**
   * Accepted for backwards compatibility but no longer rendered — every
   * page header is now title-only by design.
   */
  subtitle?: string;
  right?: React.ReactNode;
  breadcrumb?: React.ReactNode;
}

export function PageHeader({ title, right, breadcrumb }: Props) {
  return (
    <div className="page-header">
      <div>
        {breadcrumb && (
          <div className="mb-1 text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            {breadcrumb}
          </div>
        )}
        <h1 className="page-title">{title}</h1>
      </div>
      {right && <div className="flex items-center gap-2 flex-wrap justify-end">{right}</div>}
    </div>
  );
}
