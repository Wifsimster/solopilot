import { CheckCircle2, XCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

export type Flash = { type: 'success' | 'error'; message: string } | null;

export function StatusDot({ configured }: { configured: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
        configured
          ? 'bg-success/10 text-success ring-1 ring-success/20'
          : 'bg-destructive/10 text-destructive ring-1 ring-destructive/20',
      )}
      aria-label={configured ? 'Configuré' : 'Non configuré'}
    >
      {configured ? (
        <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <XCircle className="size-3.5 shrink-0" aria-hidden="true" />
      )}
      {configured ? 'Configuré' : 'Non configuré'}
    </span>
  );
}

export function CardFlash({ flash }: { flash: Flash }) {
  if (!flash) return null;
  return (
    <Alert
      variant={flash.type === 'success' ? 'success' : 'destructive'}
      aria-live="polite"
    >
      <AlertDescription>{flash.message}</AlertDescription>
    </Alert>
  );
}
