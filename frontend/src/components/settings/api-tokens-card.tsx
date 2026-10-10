import { useState } from 'react';
import { Copy, KeyRound } from 'lucide-react';
import { useApi } from '@/hooks/use-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { CardFlash, type Flash } from './shared';

interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  productIds: string[] | null;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

interface TokensResponse {
  tokens: ApiToken[];
  scopes: { id: string; label: string }[];
}

interface ProductLite {
  id: string;
  name: string;
}

const FULL_ACCESS = '*';

function formatDate(ms: number | null): string {
  if (!ms) return 'jamais';
  return new Date(ms).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
    return body.error;
  }
  return fallback;
}

/** Scoped API tokens (ADR-0029): create (secret shown once), list, revoke. */
export function ApiTokensCard() {
  const { data, loading, error, refetch } = useApi<TokensResponse>('/api/tokens');
  const { data: products } = useApi<ProductLite[]>('/api/products');
  const [flash, setFlash] = useState<Flash>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  // Full access is the default (decision of 2026-10-10); scoped access stays available.
  const [fullAccess, setFullAccess] = useState(true);
  const [scopes, setScopes] = useState<string[]>([]);
  const [allProducts, setAllProducts] = useState(true);
  const [productIds, setProductIds] = useState<string[]>([]);
  const [secret, setSecret] = useState<string | null>(null);

  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setFlash(null);
    setSecret(null);
    try {
      const res = await fetch('/api/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          fullAccess
            ? { name, scopes: [FULL_ACCESS], productIds: null }
            : { name, scopes, productIds: allProducts ? null : productIds },
        ),
      });
      const body = (await res.json()) as unknown;
      if (!res.ok) {
        setFlash({ type: 'error', message: errorMessage(body, 'Création impossible.') });
        return;
      }
      setSecret((body as { secret: string }).secret);
      setName('');
      setFullAccess(true);
      setScopes([]);
      setProductIds([]);
      setAllProducts(true);
      refetch();
    } catch {
      setFlash({ type: 'error', message: 'Erreur lors de la création du jeton.' });
    } finally {
      setSaving(false);
    }
  };

  const handleRevoke = async (token: ApiToken) => {
    setFlash(null);
    try {
      const res = await fetch(`/api/tokens/${encodeURIComponent(token.id)}`, { method: 'DELETE' });
      const body = (await res.json()) as unknown;
      setFlash(
        res.ok
          ? { type: 'success', message: `Jeton « ${token.name} » révoqué.` }
          : { type: 'error', message: errorMessage(body, 'Révocation impossible.') },
      );
      refetch();
    } catch {
      setFlash({ type: 'error', message: 'Erreur lors de la révocation.' });
    }
  };

  const scopedOptions = (data?.scopes ?? []).filter((s) => s.id !== FULL_ACCESS);
  const canCreate =
    name.trim().length > 0 &&
    (fullAccess || (scopes.length > 0 && (allProducts || productIds.length > 0)));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Jetons d'API</CardTitle>
        <CardDescription>
          Accès pour un agent ou un script, sans le mot de passe administrateur. Un jeton en accès
          complet atteint toute l'API, comme l'administrateur ; un jeton limité n'atteint que les
          routes de ses portées (tout le reste est refusé), éventuellement pour certains produits
          seulement. Chaque jeton se révoque à tout moment. Envoi : <code className="font-mono text-xs">Authorization: Bearer sp_…</code>{' '}
          ou <code className="font-mono text-xs">X-Api-Token: sp_…</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <CardFlash flash={flash} />

        {secret && (
          <Alert variant="success" aria-live="polite">
            <AlertDescription className="space-y-2">
              <p>
                <strong>Copiez ce jeton maintenant :</strong> il ne sera plus jamais affiché.
              </p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded bg-muted px-2 py-1 font-mono text-xs">
                  {secret}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void navigator.clipboard?.writeText(secret)}
                  aria-label="Copier le jeton"
                >
                  <Copy className="size-4" />
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleCreate} className="space-y-4 rounded-lg border border-border p-4">
          <div className="space-y-2">
            <Label htmlFor="token-name">Nom</Label>
            <Input
              id="token-name"
              value={name}
              maxLength={80}
              placeholder="ex. agent-budget"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Accès</legend>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="token-access"
                className="mt-0.5 size-4 border-input accent-primary"
                checked={fullAccess}
                onChange={() => setFullAccess(true)}
              />
              <span>
                <span className="font-medium">Accès complet</span>{' '}
                <span className="text-muted-foreground">
                  — toutes les routes et méthodes, tous les produits, comme l'administrateur
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="token-access"
                className="mt-0.5 size-4 border-input accent-primary"
                checked={!fullAccess}
                onChange={() => setFullAccess(false)}
              />
              <span>
                <span className="font-medium">Accès limité</span>{' '}
                <span className="text-muted-foreground">— seulement les portées choisies</span>
              </span>
            </label>
          </fieldset>
          {!fullAccess && (
            <>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Portées</legend>
                {scopedOptions.map((s) => (
                  <label key={s.id} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 rounded border-input accent-primary"
                      checked={scopes.includes(s.id)}
                      onChange={() => setScopes(toggle(scopes, s.id))}
                    />
                    <span>
                      <code className="font-mono text-xs">{s.id}</code>{' '}
                      <span className="text-muted-foreground">— {s.label}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Produits</legend>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 rounded border-input accent-primary"
                    checked={allProducts}
                    onChange={() => setAllProducts(!allProducts)}
                  />
                  Tous les produits
                </label>
                {!allProducts && (
                  <div className="grid gap-1 sm:grid-cols-2">
                    {(products ?? []).map((p) => (
                      <label key={p.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="size-4 rounded border-input accent-primary"
                          checked={productIds.includes(p.id)}
                          onChange={() => setProductIds(toggle(productIds, p.id))}
                        />
                        {p.name}{' '}
                        <code className="font-mono text-xs text-muted-foreground">{p.id}</code>
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>
            </>
          )}
          <Button type="submit" disabled={saving || !canCreate}>
            <KeyRound className="size-4" />
            Créer le jeton
          </Button>
        </form>

        {loading && !data && <Skeleton className="h-24 rounded-lg" />}
        {error && !data && (
          <p className="text-sm text-muted-foreground">Jetons indisponibles : {error}</p>
        )}
        {data && data.tokens.length === 0 && (
          <p className="text-sm text-muted-foreground">Aucun jeton.</p>
        )}
        {data && data.tokens.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {data.tokens.map((t) => (
              <li key={t.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium break-all">{t.name}</span>
                    <code className="font-mono text-xs text-muted-foreground">{t.prefix}…</code>
                    {t.revokedAt ? (
                      <Badge variant="secondary">Révoqué</Badge>
                    ) : (
                      <Badge variant="success">Actif</Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {t.scopes.includes(FULL_ACCESS) ? (
                      <Badge variant="warning">Accès complet</Badge>
                    ) : (
                      <>
                        {t.scopes.map((s) => (
                          <Badge key={s} variant="outline" className="font-mono">
                            {s}
                          </Badge>
                        ))}
                        <Badge variant="brand">
                          {t.productIds ? t.productIds.join(', ') : 'tous les produits'}
                        </Badge>
                      </>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Créé le {formatDate(t.createdAt)} · dernière utilisation : {formatDate(t.lastUsedAt)}
                    {t.revokedAt ? ` · révoqué le ${formatDate(t.revokedAt)}` : ''}
                  </p>
                </div>
                {!t.revokedAt && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm">
                        Révoquer
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Révoquer « {t.name} » ?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Le jeton cessera immédiatement de fonctionner. Cette action est
                          définitive ; l'historique d'utilisation est conservé.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Annuler</AlertDialogCancel>
                        <AlertDialogAction onClick={() => void handleRevoke(t)}>
                          Révoquer
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
