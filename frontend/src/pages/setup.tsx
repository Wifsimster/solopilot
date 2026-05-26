import { Link } from "react-router-dom";
import { useApi } from "@/hooks/use-api";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Settings as SettingsIcon, ArrowRight } from "lucide-react";
import type { SetupResponse } from "@/types";

export function SetupPage() {
  const { data: setup, loading } = useApi<SetupResponse>("/api/setup");

  if (loading || !setup) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-10 bg-muted/30">
        <div className="max-w-2xl w-full mx-auto space-y-6">
          <div className="text-center space-y-3">
            <Skeleton className="h-14 w-14 mx-auto rounded-full" />
            <Skeleton className="h-8 w-64 mx-auto" />
            <Skeleton className="h-4 w-96 mx-auto" />
          </div>
          <Skeleton className="h-2 w-full rounded-full" />
          <Skeleton className="h-64 rounded-lg" />
        </div>
      </div>
    );
  }

  const { credentials, configured } = setup;
  const configuredCount = credentials.filter((c) => c.configured).length;
  const totalCount = credentials.length;

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 bg-muted/30">
      <div className="max-w-2xl w-full mx-auto space-y-6">
        <div className="text-center space-y-3">
          <div
            className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary"
            aria-hidden="true"
          >
            <SettingsIcon className="h-7 w-7" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Configuration requise</h1>
          <p className="text-muted-foreground">
            Le bot a besoin de quelques variables d'environnement pour fonctionner.{' '}
            <strong className="text-foreground">{configuredCount}</strong> sur {totalCount} sont configurées.
          </p>
        </div>

        <div
          className="flex gap-1"
          role="progressbar"
          aria-valuemin={0}
          aria-valuenow={configuredCount}
          aria-valuemax={totalCount}
          aria-label={`Progression de la configuration : ${configuredCount} sur ${totalCount}`}
        >
          {credentials.map((cred) => (
            <div
              key={cred.key}
              className={`h-2 flex-1 rounded-full transition-colors ${cred.configured ? 'bg-success' : 'bg-muted-foreground/20'}`}
            />
          ))}
        </div>

      <Card>
        <CardHeader>
          <div className="font-semibold">Variables d'environnement</div>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {credentials.map((cred) => (
              <li key={cred.key} className="flex items-start gap-3 py-3">
                <Badge variant={cred.configured ? "success" : "error"} className="mt-0.5 shrink-0">
                  {cred.configured ? "\u2713" : "\u2717"}
                </Badge>
                <div className="space-y-1 flex-1">
                  <p className="font-medium text-sm">{cred.label}</p>
                  <code className="text-xs text-muted-foreground">{cred.key}</code>
                  <p
                    className="text-xs text-muted-foreground leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: cred.howToFind }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {!configured && (
        <Card>
          <CardHeader>
            <div className="font-semibold">Template .env</div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">
              Ajoutez les variables manquantes dans votre fichier <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">.env</code> ou dans votre{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">compose.yml</code> :
            </p>
            <pre className="rounded-lg border bg-muted p-4 font-mono text-xs overflow-x-auto">
              {credentials
                .filter((c) => !c.configured)
                .map((c) => `${c.key}=your-${c.key.toLowerCase().replace(/_/g, "-")}-here`)
                .join("\n")}
            </pre>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="font-semibold">Comment configurer ?</div>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal list-inside space-y-2 text-sm">
            <li>
              Copiez le fichier <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">.env.example</code> en{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">.env</code> et remplissez les valeurs manquantes
            </li>
            <li>
              Ou ajoutez les variables dans la section <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">environment:</code> de votre{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">compose.yml</code>
            </li>
            <li>
              Redémarrez le conteneur : <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">docker compose down && docker compose up -d</code>
            </li>
          </ol>
          <p className="text-xs text-muted-foreground mt-3">
            Les variables d'environnement sont lues au démarrage du conteneur. Un redémarrage est nécessaire après modification.
          </p>
        </CardContent>
      </Card>

        {configured ? (
          <Button asChild className="w-full" size="lg">
            <Link to="/">
              Accéder au dashboard
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
        ) : (
          <Button disabled className="w-full" size="lg">
            En attente de configuration…
          </Button>
        )}
      </div>
    </div>
  );
}
