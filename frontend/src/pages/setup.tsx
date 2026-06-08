import { Fragment, createElement, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useApi } from "@/hooks/use-api";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardContent, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Settings as SettingsIcon, ArrowRight, CheckCircle2, XCircle, Terminal, BookOpen } from "lucide-react";
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
      { key, href, target: "_blank", rel: "noopener noreferrer", className: "underline underline-offset-2 hover:text-foreground transition-colors" },
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

function InlineCode({ children }: { children: string }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
      {children}
    </code>
  );
}

export function SetupPage() {
  const { data: setup, loading } = useApi<SetupResponse>("/api/setup");

  if (loading || !setup) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12">
        <div className="w-full max-w-lg space-y-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <Skeleton className="size-14 rounded-full" />
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-4 w-72" />
          </div>
          <Skeleton className="h-2 w-full rounded-full" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    );
  }

  const { credentials, configured } = setup;
  const configuredCount = credentials.filter((c) => c.configured).length;
  const totalCount = credentials.length;
  const progressPct = totalCount > 0 ? Math.round((configuredCount / totalCount) * 100) : 0;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/30 px-4 py-12">
      <div className="w-full max-w-lg space-y-6">

        {/* Brand mark + heading */}
        <div className="flex flex-col items-center gap-4 text-center">
          <div
            className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/20"
            aria-hidden="true"
          >
            <SettingsIcon className="size-7" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Configuration requise
            </h1>
            <p className="text-sm text-muted-foreground">
              {configuredCount === totalCount
                ? "Toutes les variables sont configurées — vous êtes prêt."
                : <>
                    <strong className="text-foreground">{configuredCount}</strong> sur{" "}
                    <strong className="text-foreground">{totalCount}</strong> variables configurées.
                  </>}
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Progression</span>
            <span className="tabular-nums">{progressPct}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-border">
            <div
              className="h-2 rounded-full bg-primary transition-all duration-500"
              style={{ width: `${progressPct}%` }}
              role="progressbar"
              aria-valuenow={progressPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Progression de la configuration : ${configuredCount} sur ${totalCount}`}
            />
          </div>
        </div>

        {/* Credentials list */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Variables d'environnement</CardTitle>
            <CardDescription>
              Ces secrets sont lus au démarrage — un redémarrage est requis après modification.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="divide-y divide-border">
              {credentials.map((cred) => (
                <li key={cred.key} className="flex items-start gap-3 py-3.5 first:pt-0 last:pb-0">
                  <span className="mt-0.5 shrink-0" aria-hidden="true">
                    {cred.configured ? (
                      <CheckCircle2 className="size-4 text-success" />
                    ) : (
                      <XCircle className="size-4 text-muted-foreground" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium leading-none">{cred.label}</p>
                      <Badge variant={cred.configured ? "success" : "outline"} className="text-xs">
                        {cred.configured ? "Configuré" : "Manquant"}
                      </Badge>
                    </div>
                    <p className="font-mono text-xs text-muted-foreground">{cred.key}</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      <TrustedInline html={cred.howToFind} />
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* .env template — only shown if not fully configured */}
        {!configured && (
          <Card>
            <CardHeader className="pb-4">
              <div className="flex items-center gap-2">
                <Terminal className="size-4 text-muted-foreground" aria-hidden="true" />
                <CardTitle className="text-base">Template .env</CardTitle>
              </div>
              <CardDescription>
                Ajoutez les variables manquantes dans votre <InlineCode>.env</InlineCode>{" "}
                ou dans la section <InlineCode>environment:</InlineCode> de votre{" "}
                <InlineCode>compose.yml</InlineCode>.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <pre className="overflow-x-auto rounded-lg border border-border bg-muted p-4 font-mono text-xs leading-relaxed text-foreground">
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

        {/* How to configure steps */}
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <BookOpen className="size-4 text-muted-foreground" aria-hidden="true" />
              <CardTitle className="text-base">Comment configurer ?</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <ol className="space-y-3">
              {[
                <>Copiez <InlineCode>.env.example</InlineCode> en <InlineCode>.env</InlineCode> et remplissez les valeurs manquantes.</>,
                <>Ou ajoutez les variables dans la section <InlineCode>environment:</InlineCode> de votre <InlineCode>compose.yml</InlineCode>.</>,
                <>Redémarrez le conteneur : <InlineCode>docker compose down && docker compose up -d</InlineCode></>,
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-3 text-sm">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground tabular-nums">
                    {i + 1}
                  </span>
                  <span className="text-muted-foreground leading-relaxed">{step}</span>
                </li>
              ))}
            </ol>
            <p className="mt-4 text-xs text-muted-foreground border-t border-border pt-3">
              Les variables d'environnement sont lues au démarrage. Un redémarrage est nécessaire après modification.
            </p>
          </CardContent>
        </Card>

        {/* CTA */}
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
