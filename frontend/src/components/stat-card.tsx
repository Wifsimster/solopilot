import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type StatTone = 'default' | 'success' | 'warning' | 'destructive';

const toneStyles: Record<StatTone, string> = {
  default: 'bg-primary/10 text-primary',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  destructive: 'bg-destructive/10 text-destructive',
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
    <Card>
      <CardContent className="flex items-start gap-3 p-4 sm:p-5">
        {Icon && (
          <div
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
              toneStyles[tone],
            )}
            aria-hidden="true"
          >
            <Icon className="size-5" />
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {title}
          </p>
          <div className="text-xl sm:text-2xl font-semibold tracking-tight truncate">
            {children}
          </div>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
