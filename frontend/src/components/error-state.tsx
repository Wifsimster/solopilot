import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AlertCircle, RotateCcw } from 'lucide-react';

interface ErrorStateProps {
  message: string;
  context?: string;
  onRetry?: () => void;
}

function humanizeError(message: string): string {
  if (/401|403|Session cookies/i.test(message)) {
    return 'Vos cookies de session X semblent expirés. Mettez-les à jour dans Paramètres.';
  }
  if (/Failed to fetch|NetworkError|HTTP 0/i.test(message)) {
    return 'Impossible de joindre le serveur. Vérifiez votre connexion.';
  }
  if (/HTTP 5\d\d/i.test(message)) {
    return 'Le serveur a rencontré une erreur. Réessayez dans quelques instants.';
  }
  return message;
}

export function ErrorState({ message, context, onRetry }: ErrorStateProps) {
  return (
    <Alert variant="destructive" role="alert">
      <AlertCircle className="size-4" />
      <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span>
          {context ? `${context} — ` : ''}
          {humanizeError(message)}
        </span>
        {onRetry && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            className="shrink-0"
            aria-label="Réessayer le chargement"
          >
            <RotateCcw className="size-3.5" />
            Réessayer
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
