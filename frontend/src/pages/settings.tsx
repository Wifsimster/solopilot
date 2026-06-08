import { useApi } from '@/hooks/use-api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { CookiesCard } from '@/components/settings/cookies-card';
import { GraphqlCard } from '@/components/settings/graphql-card';
import { ProductSettingsCard } from '@/components/settings/product-settings-card';
import { PageHeader } from '@/components/page-header';
import { ErrorState } from '@/components/error-state';
import { ShieldAlert } from 'lucide-react';
import type { ConfigResponse } from '@/types';

export function SettingsPage() {
  const { data: config, loading, error, refetch } = useApi<ConfigResponse>('/api/config');

  if (loading && !config) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-5 w-96" />
        </div>
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
    );
  }

  if (error || !config) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Paramètres"
          description="Configuration globale et par produit"
        />
        <ErrorState
          message={error ?? 'Configuration indisponible'}
          context="Impossible de charger les paramètres"
          onRetry={refetch}
        />
      </div>
    );
  }

  const { credentialInfo } = config;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Paramètres"
        description="Configuration globale (identité X) et configuration par produit (requête, webhook, plannings, prompt IA)."
      />

      {!credentialInfo.hasAuth && (
        <Alert variant="warning" role="alert">
          <ShieldAlert className="size-4" />
          <AlertDescription>
            <strong>Dashboard non protégé :</strong> configurez la variable d'environnement{' '}
            <code className="font-mono text-xs">ADMIN_PASSWORD</code> pour sécuriser l'accès aux
            cookies de session et aux paramètres sensibles.
          </AlertDescription>
        </Alert>
      )}

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Paramètres par produit</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Surcharges appliquées uniquement au produit sélectionné.
          </p>
        </div>
        <ProductSettingsCard />
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Paramètres globaux</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Ces paramètres s'appliquent à l'ensemble des produits (identité X partagée). Reddit et
            Hacker News (Algolia) ne nécessitent pas d'authentification.
          </p>
        </div>
        <CookiesCard credentialInfo={credentialInfo} onSaved={refetch} />
        <GraphqlCard envDefaults={config.envDefaults} onSaved={refetch} />
      </section>
    </div>
  );
}
