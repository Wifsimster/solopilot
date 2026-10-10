import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { useApi } from '@/hooks/use-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { MarkdownContent } from '@/components/markdown-content';
import { CardFlash, type Flash } from './shared';
import type { RadarProposal, RadarProposalStatus, RadarResponse } from '@/types';

const STATUS: Record<
  RadarProposalStatus,
  { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary' | 'brand' }
> = {
  created: { label: 'Issue créée', variant: 'success' },
  dry_run: { label: 'Simulation', variant: 'brand' },
  failed: { label: 'Échec', variant: 'destructive' },
  capped: { label: 'Plafond atteint', variant: 'secondary' },
  creating: { label: 'En cours', variant: 'warning' },
};

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return (await res.json()) as { success: boolean; message: string; url?: string };
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

export function RadarProduitCard() {
  const { data, loading, error, refetch } = useApi<RadarResponse>('/api/veille/radar');
  const [flash, setFlash] = useState<Flash>(null);
  const [saving, setSaving] = useState(false);
  const [creatingId, setCreatingId] = useState<number | null>(null);

  const save = async (body: Record<string, string>) => {
    setSaving(true);
    setFlash(null);
    try {
      const res = await postJson('/api/settings', body);
      setFlash({ type: res.success ? 'success' : 'error', message: res.message });
      if (res.success) refetch();
    } catch {
      setFlash({ type: 'error', message: "Erreur lors de l'enregistrement." });
    } finally {
      setSaving(false);
    }
  };

  const handleLimits = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    await save({
      RADAR_SCORE_THRESHOLD: String(form.get('RADAR_SCORE_THRESHOLD') ?? ''),
      RADAR_MAX_PER_PRODUCT_PER_DAY: String(form.get('RADAR_MAX_PER_PRODUCT_PER_DAY') ?? ''),
      RADAR_MAX_PER_DAY: String(form.get('RADAR_MAX_PER_DAY') ?? ''),
    });
  };

  const handleCreate = async (proposal: RadarProposal) => {
    setCreatingId(proposal.id);
    setFlash(null);
    try {
      const res = await postJson(`/api/veille/radar/proposals/${proposal.id}/create`);
      setFlash({ type: res.success ? 'success' : 'error', message: res.message });
      refetch();
    } catch {
      setFlash({ type: 'error', message: "Erreur lors de la création de l'issue." });
    } finally {
      setCreatingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Radar produit</CardTitle>
        <CardDescription>
          Quand une actualité de veille est très en rapport avec un produit lié à un dépôt GitHub,
          Solopilot rédige un rapport marketing (idées à reprendre, pour et contre, effort, impact)
          et le propose sous forme d'issue dans le dépôt du produit.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <CardFlash flash={flash} />

        {loading && !data && <Skeleton className="h-32 rounded-lg" />}
        {error && !data && (
          <p className="text-sm text-muted-foreground">Radar indisponible : {error}</p>
        )}

        {data && (
          <>
            {!data.tokenConfigured && (
              <Alert variant="warning">
                <AlertDescription>
                  <code className="font-mono text-xs">GITHUB_ISSUES_TOKEN</code> n'est pas
                  configuré : le radar reste en simulation (aucune issue créée). Ajoutez un token
                  fine-grained avec la permission <strong>Issues : lecture et écriture</strong> sur
                  les dépôts des produits, dans le fichier <code className="font-mono text-xs">.env</code>.
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <Label htmlFor="radar-enabled">Activer le radar</Label>
                  <p className="text-xs text-muted-foreground">
                    Analyse horaire (à :45) des actualités triées. Désactivé : aucun appel IA.
                  </p>
                </div>
                <Switch
                  id="radar-enabled"
                  checked={data.settings.enabled}
                  disabled={saving}
                  onCheckedChange={(v) => save({ RADAR_ENABLED: String(v) })}
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <Label htmlFor="radar-dry-run">Mode simulation</Label>
                  <p className="text-xs text-muted-foreground">
                    Les propositions sont listées ici et sur Discord, sans créer d'issue.
                  </p>
                </div>
                <Switch
                  id="radar-dry-run"
                  checked={data.settings.dryRun}
                  disabled={saving}
                  onCheckedChange={(v) => save({ RADAR_DRY_RUN: String(v) })}
                />
              </div>
            </div>

            <form onSubmit={handleLimits} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="radar-threshold">Seuil de pertinence (0-1)</Label>
                  <Input
                    id="radar-threshold"
                    name="RADAR_SCORE_THRESHOLD"
                    inputMode="decimal"
                    defaultValue={String(data.settings.scoreThreshold)}
                    key={`t-${data.settings.scoreThreshold}`}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="radar-cap-product">Max par produit / jour</Label>
                  <Input
                    id="radar-cap-product"
                    name="RADAR_MAX_PER_PRODUCT_PER_DAY"
                    inputMode="numeric"
                    defaultValue={String(data.settings.maxPerProductPerDay)}
                    key={`p-${data.settings.maxPerProductPerDay}`}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="radar-cap-day">Max total / jour</Label>
                  <Input
                    id="radar-cap-day"
                    name="RADAR_MAX_PER_DAY"
                    inputMode="numeric"
                    defaultValue={String(data.settings.maxPerDay)}
                    key={`d-${data.settings.maxPerDay}`}
                  />
                </div>
              </div>
              <Button type="submit" disabled={saving}>
                {saving ? 'Enregistrement...' : 'Enregistrer les limites'}
              </Button>
            </form>

            <p className="text-xs text-muted-foreground">
              Produits ciblés (URL du produit = dépôt GitHub) :{' '}
              {data.repoProducts.length > 0
                ? data.repoProducts.map((p) => `${p.name} (${p.repo})`).join(', ')
                : 'aucun'}
              . Le radar ne lit que les actualités triées (triage IA activé sur le produit).
            </p>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Propositions récentes</h3>
              {data.proposals.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune proposition pour le moment.</p>
              ) : (
                <ul className="space-y-3">
                  {data.proposals.map((p) => (
                    <li key={p.id} className="rounded-lg border p-3 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={STATUS[p.status].variant}>{STATUS[p.status].label}</Badge>
                        <span className="text-sm font-medium">
                          {p.title ?? '(rapport non généré)'}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {p.product_name ?? p.product_id} · {p.repo} · pertinence{' '}
                        {p.score.toFixed(2)} · {formatDate(p.created_at)}
                      </p>
                      {p.error && <p className="text-xs text-destructive">{p.error}</p>}
                      <div className="flex flex-wrap items-center gap-3 text-sm">
                        {p.issue_url && (
                          <a
                            href={p.issue_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-primary underline"
                          >
                            Voir l'issue #{p.issue_number}
                            <ExternalLink className="size-3.5" aria-hidden="true" />
                          </a>
                        )}
                        {p.source_url && (
                          <a
                            href={p.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-muted-foreground underline"
                          >
                            Source
                            <ExternalLink className="size-3.5" aria-hidden="true" />
                          </a>
                        )}
                        {(p.status === 'dry_run' || p.status === 'failed') && p.body && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!data.tokenConfigured || creatingId !== null}
                            onClick={() => handleCreate(p)}
                          >
                            {creatingId === p.id ? 'Création...' : "Créer l'issue"}
                          </Button>
                        )}
                      </div>
                      {p.body && (
                        <details className="text-sm">
                          <summary className="cursor-pointer text-muted-foreground">
                            Voir le rapport
                          </summary>
                          <MarkdownContent content={p.body} className="mt-2 text-sm" />
                        </details>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
