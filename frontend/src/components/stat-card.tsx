import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type StatTone = 'default' | 'success' | 'warning' | 'destructive';

const toneStyles: Record<StatTone, string> = {
  default: 'bg-accent text-accent-foreground',
  success: 'bg-success/12 text-success dark:bg-success/20',
  warning: 'bg-warning/15 text-warning dark:bg-warning/25',
  destructive: 'bg-destructive/12 text-destructive dark:bg-destructive/20',
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
    <Card className="group relative overflow-hidden p-4 transition-colors hover:border-muted-foreground/20 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
        {Icon && (
          <div
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-lg',
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
