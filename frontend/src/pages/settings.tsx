import { useApi } from '@/hooks/use-api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { CookiesCard } from '@/components/settings/cookies-card';
import { GraphqlCard } from '@/components/settings/graphql-card';
import { ProductSettingsCard } from '@/components/settings/product-settings-card';
import type { ConfigResponse } from '@/types';

export function SettingsPage() {
  const { data: config, loading, refetch } = useApi<ConfigResponse>('/api/config');

  if (loading || !config) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-8 w-40" />
          <Skeleton className="mt-2 h-4 w-96" />
        </div>
        <Skeleton className="h-48 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
        <Skeleton className="h-32 rounded-lg" />
        <Skeleton className="h-32 rounded-lg" />
      </div>
    );
  }

  const { credentialInfo } = config;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Paramètres</h1>
        <p className="text-muted-foreground">
          Configuration globale (identité X) et configuration par produit (requête, webhook,
          plannings, prompt IA).
        </p>
      </div>

      {/* Page-level auth warning banner */}
      {!credentialInfo.hasAuth && (
        <Alert variant="warning">
          <AlertDescription>
            <strong>Dashboard non protégé</strong> — Configurez la variable d'environnement{' '}
            <code className="font-mono text-xs">ADMIN_PASSWORD</code> pour sécuriser l'accès aux
            cookies de session et aux paramètres sensibles.
          </AlertDescription>
        </Alert>
      )}

      <ProductSettingsCard />

      <div>
        <h2 className="text-base font-semibold mb-1">Paramètres globaux</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Ces paramètres s'appliquent à l'ensemble des produits (identité X partagée).
        </p>
      </div>

      <CookiesCard credentialInfo={credentialInfo} onSaved={refetch} />
      <GraphqlCard envDefaults={config.envDefaults} onSaved={refetch} />
    </div>
  );
}
