import { Fragment, createElement, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useApi } from "@/hooks/use-api";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Settings as SettingsIcon, ArrowRight } from "lucide-react";
import type { SetupResponse } from "@/types";

// Inline tags allowed in the trusted `howToFind` help strings (defined in the
// backend constant REQUIRED_CREDENTIALS). Rendered as React elements rather than
// injected as raw HTML, so no dangerouslySetInnerHTML is needed.
const ALLOWED_INLINE_TAGS = new Set(["a", "code", "strong", "kbd", "em", "b"]);

function nodeToReact(node: Node, key: number): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  const children = Array.from(el.childNodes).map((child, i) => nodeToReact(child, i));
  if (!ALLOWED_INLINE_TAGS.has(tag)) {
    // Drop unknown tags but keep their text content.
    return createElement(Fragment, { key }, ...children);
  }
  if (tag === "a") {
    const href = el.getAttribute("href") ?? undefined;
    return createElement(
      "a",
      { key, href, target: "_blank", rel: "noopener noreferrer", className: "underline" },
      ...children,
    );
  }
  return createElement(tag, { key }, ...children);
}

function TrustedInline({ html }: { html: string }) {
  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    return html;
  }
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  return Array.from(doc.body.childNodes).map((node, i) => nodeToReact(node, i));
}

export function SetupPage() {
  const { data: setup, loading } = useApi<SetupResponse>("/api/setup");

  if (loading || !setup) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-10 bg-muted/30">
        <div className="max-w-2xl w-full mx-auto space-y-6">
          <div className="text-center space-y-3">
            <Skeleton className="size-14 mx-auto rounded-full" />
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
            className="inline-flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary"
            aria-hidden="true"
          >
            <SettingsIcon className="size-7" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Configuration requise</h1>
          <p className="text-muted-foreground">
            Le bot a besoin de quelques variables d'environnement pour fonctionner.{' '}
            <strong className="text-foreground">{configuredCount}</strong> sur {totalCount} sont configurées.
          </p>
        </div>

        <div>
          <progress
            className="sr-only"
            value={configuredCount}
            max={totalCount}
            aria-label={`Progression de la configuration : ${configuredCount} sur ${totalCount}`}
          />
          <div className="flex gap-1" aria-hidden="true">
            {credentials.map((cred) => (
              <div
                key={cred.key}
                className={`h-2 flex-1 rounded-full transition-colors ${cred.configured ? 'bg-success' : 'bg-muted-foreground/20'}`}
              />
            ))}
          </div>
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
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    <TrustedInline html={cred.howToFind} />
                  </p>
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
                .reduce<string[]>((lines, c) => {
                  if (!c.configured) {
                    lines.push(`${c.key}=your-${c.key.toLowerCase().replace(/_/g, "-")}-here`);
                  }
                  return lines;
                }, [])
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
              <ArrowRight className="size-4" aria-hidden="true" />
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
