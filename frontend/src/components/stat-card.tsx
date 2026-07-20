import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type StatTone = 'default' | 'success' | 'warning' | 'destructive';

const toneStyles: Record<StatTone, string> = {
  default: 'bg-accent text-accent-foreground ring-accent-foreground/10',
  success: 'bg-success/12 text-success ring-success/25 dark:bg-success/20',
  warning: 'bg-warning/15 text-warning ring-warning/25 dark:bg-warning/25',
  destructive: 'bg-destructive/12 text-destructive ring-destructive/25 dark:bg-destructive/20',
};

interface StatCardProps {
  title: string;
  icon?: LucideIcon;
  tone?: StatTone;
  hint?: string;
  children: React.ReactNode;
}

export function StatCard({ title, icon: Icon, tone = 'default', hint, children }: StatCardProps) {
  return (
    <Card className="group relative overflow-hidden p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-muted-foreground/20 hover:shadow-md sm:p-5">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        aria-hidden="true"
      />
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
        {Icon && (
          <div
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset',
              toneStyles[tone],
            )}
            aria-hidden="true"
          >
            <Icon className="size-4" />
          </div>
        )}
      </div>
      <div className="mt-2 truncate text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">
        {children}
      </div>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}
