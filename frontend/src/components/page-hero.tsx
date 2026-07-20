import { cn } from '@/lib/utils';

interface PageHeroProps {
  /** Pill content shown above the title, prefixed with a pulsing live dot. */
  badge?: React.ReactNode;
  /** Hero title — pass a <span className="text-gradient-brand"> for the gradient part. */
  title: React.ReactNode;
  titleId?: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHero({
  badge,
  title,
  titleId,
  description,
  actions,
  className,
}: PageHeroProps) {
  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        'relative overflow-hidden rounded-2xl border border-border bg-card shadow-xs animate-in fade-in slide-in-from-bottom-2 duration-500',
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-brand-aurora" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-0 bg-grid-fade" aria-hidden="true" />
      <div className="relative flex flex-col gap-6 p-6 sm:p-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 max-w-2xl space-y-4">
          {badge && (
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/8 px-3 py-1 text-xs font-medium text-primary dark:border-primary/30 dark:bg-primary/15">
              <span className="relative flex size-1.5" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
              </span>
              {badge}
            </span>
          )}
          <h1 id={titleId} className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {title}
          </h1>
          {description && (
            <p className="max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </section>
  );
}
