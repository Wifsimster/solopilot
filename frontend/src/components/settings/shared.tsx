import { CheckCircle2, XCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export type Flash = { type: 'success' | 'error'; message: string } | null;

export function StatusDot({ configured }: { configured: boolean }) {
  return configured ? (
    <CheckCircle2 className="size-4 text-success" aria-label="Configuré" />
  ) : (
    <XCircle className="size-4 text-destructive" aria-label="Non configuré" />
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
