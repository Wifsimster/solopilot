import { useState } from 'react';
import { useApi } from '@/hooks/use-api';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
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
import { ProductCreateDialog } from '@/components/product-create-dialog';
import { GithubImportDialog } from '@/components/github-import-dialog';
import { PageHeader } from '@/components/page-header';
import { ErrorState } from '@/components/error-state';
import { Plus, Archive, Loader2, Pencil, ExternalLink, Github, Package } from 'lucide-react';
import { toast } from 'sonner';
import { formatDateFr } from '@/lib/utils';
import { useSelectedProduct } from '@/lib/product-context-hooks';
import type { ProductRecord } from '@/types';

function SourceBadges({ product }: { product: ProductRecord }) {
  const xActive = product.x_enabled;
  const subCount = product.reddit_subreddits?.length ?? 0;
  const redditActive = product.reddit_enabled && subCount > 0;
  const hnCount = product.hn_keywords?.length ?? 0;
  const hnActive = product.hn_enabled && hnCount > 0;
  const ytCount = product.youtube_keywords?.length ?? 0;
  const ytActive = product.youtube_enabled && ytCount > 0;
  const mentionCount = product.mention_keywords?.length ?? 0;
  const intentCount = product.intent_keywords?.length ?? 0;
  const intentActive = product.intent_enabled && intentCount > 0;

  if (!xActive && !redditActive && !hnActive && !ytActive && mentionCount === 0 && !intentActive) {
    return <span className="text-xs text-muted-foreground">Aucune</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {xActive && (
        <Badge variant="secondary" className="text-xs" aria-label="Source X activée">
          X
        </Badge>
      )}
      {redditActive && (
        <Badge
          variant="secondary"
          className="text-xs"
          aria-label={`${subCount} subreddit${subCount !== 1 ? 's' : ''} : ${product.reddit_subreddits?.join(', ')}`}
        >
          r/{subCount}
        </Badge>
      )}
      {hnActive && (
        <Badge
          variant="secondary"
          className="text-xs"
          aria-label={`${hnCount} mot${hnCount !== 1 ? 's' : ''}-clé${hnCount !== 1 ? 's' : ''} Hacker News : ${product.hn_keywords?.join(', ')}`}
        >
          hn:{hnCount}
        </Badge>
      )}
      {ytActive && (
        <Badge
          variant="secondary"
          className="text-xs"
          aria-label={`${ytCount} mot${ytCount !== 1 ? 's' : ''}-clé${ytCount !== 1 ? 's' : ''} YouTube : ${product.youtube_keywords?.join(', ')}`}
        >
          yt:{ytCount}
        </Badge>
      )}
      {mentionCount > 0 && (
        <Badge
          variant="warning"
          className="text-xs"
          aria-label={`${mentionCount} mot${mentionCount !== 1 ? 's' : ''}-clé${mentionCount !== 1 ? 's' : ''} de mention : ${product.mention_keywords?.join(', ')}`}
        >
          📣 {mentionCount}
        </Badge>
      )}
      {product.triage_enabled && (
        <Badge variant="success" className="text-xs" aria-label="Triage IA activé">
          Triage IA
        </Badge>
      )}
      {intentActive && (
        <Badge
          variant="success"
          className="text-xs"
          aria-label={`${intentCount} mot${intentCount !== 1 ? 's' : ''}-clé${intentCount !== 1 ? 's' : ''} d'intention : ${product.intent_keywords?.join(', ')}`}
        >
          Intent: {intentCount}
        </Badge>
      )}
    </div>
  );
}

function truncate(value: string | null, max = 60): string {
  if (!value) return '—';
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function formatCreatedAt(ts: number): string {
  if (!ts) return '—';
  // Backend timestamps are in seconds (unix). Detect ms vs s heuristically.
  const ms = ts > 1e12 ? ts : ts * 1000;
  return formatDateFr(new Date(ms).toISOString());
}

export function ProductsPage() {
  const { data, loading, error, refetch } = useApi<ProductRecord[]>('/api/products');
  const { selectedProductId, setSelectedProductId } = useSelectedProduct();
  const [createOpen, setCreateOpen] = useState(false);
  const [githubImportOpen, setGithubImportOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductRecord | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);

  const handleCreated = (product: ProductRecord) => {
    refetch();
    setSelectedProductId(product.id);
  };

  const handleUpdated = () => {
    refetch();
    setEditingProduct(null);
  };

  const handleArchive = async (id: string) => {
    setArchivingId(id);
    try {
      const res = await fetch(`/api/products/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok || json.success === false) {
        toast.error(json.message || `Erreur HTTP ${res.status}`);
        return;
      }
      toast.success('Produit archivé.');
      refetch();
    } catch {
      toast.error('Erreur réseau lors de l’archivage.');
    } finally {
      setArchivingId(null);
    }
  };

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-10 w-40" />
            <Skeleton className="h-10 w-36" />
          </div>
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Produits" description="Gestion des produits" />
        <ErrorState
          message={error}
          context="Impossible de charger la liste des produits"
          onRetry={refetch}
        />
      </div>
    );
  }

  const products = data ?? [];
  const active = products.filter((p) => !p.archived_at);
  const archived = products.filter((p) => p.archived_at);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Produits"
        description={`${active.length} produit${active.length !== 1 ? 's' : ''} actif${active.length !== 1 ? 's' : ''}`}
        actions={
          <>
            <Button variant="outline" onClick={() => setGithubImportOpen(true)}>
              <Github className="size-4" aria-hidden="true" />
              Importer depuis GitHub
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              Nouveau produit
            </Button>
          </>
        }
      />

      {products.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-4 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <Package className="size-5 text-muted-foreground" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <p className="font-medium">Aucun produit configuré</p>
              <p className="text-sm text-muted-foreground">
                Créez votre premier produit pour commencer à surveiller vos sources.
              </p>
            </div>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              Nouveau produit
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[160px]">Nom</TableHead>
                    <TableHead className="min-w-[120px]">Identifiant</TableHead>
                    <TableHead className="min-w-[120px]">Sources</TableHead>
                    <TableHead className="min-w-[160px]">Requête X</TableHead>
                    <TableHead className="min-w-[110px]">Créé le</TableHead>
                    <TableHead className="min-w-[90px]">Statut</TableHead>
                    <TableHead className="min-w-[160px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map((p) => {
                    const isSelected = p.id === selectedProductId;
                    const isArchived = !!p.archived_at;
                    return (
                      <TableRow
                        key={p.id}
                        className={isSelected ? 'bg-accent/40' : undefined}
                      >
                        <TableCell className="font-medium">
                          <div className="flex flex-wrap items-center gap-2">
                            <span>{p.name}</span>
                            {p.product_url && (
                              <a
                                href={p.product_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-muted-foreground hover:text-foreground transition-colors"
                                title={p.product_url}
                                aria-label={`Ouvrir l'URL de ${p.name}`}
                              >
                                <ExternalLink className="size-3.5" />
                              </a>
                            )}
                            {isSelected && (
                              <Badge variant="secondary" className="text-xs">
                                sélectionné
                              </Badge>
                            )}
                            {p.target_audience && (
                              <Badge variant="success" className="text-xs">
                                Studio configuré
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <code className="text-xs font-mono bg-muted rounded px-1.5 py-0.5">
                            {p.id}
                          </code>
                        </TableCell>
                        <TableCell>
                          <SourceBadges product={p} />
                        </TableCell>
                        <TableCell
                          className="text-sm text-muted-foreground max-w-[200px] truncate"
                          title={p.x_query ?? ''}
                        >
                          {truncate(p.x_query, 50)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {formatCreatedAt(p.created_at)}
                        </TableCell>
                        <TableCell>
                          {isArchived ? (
                            <Badge variant="outline">Archivé</Badge>
                          ) : (
                            <Badge variant="success">Actif</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {!isSelected && !isArchived && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 text-xs"
                                onClick={() => setSelectedProductId(p.id)}
                              >
                                Sélectionner
                              </Button>
                            )}
                            {!isArchived && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setEditingProduct(p)}
                                className="h-8 px-2"
                                title="Éditer le produit"
                              >
                                <Pencil className="size-3.5 mr-1" />
                                Éditer
                              </Button>
                            )}
                            {!isArchived && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={archivingId === p.id}
                                    className="h-8 px-2 text-destructive hover:text-destructive"
                                    title="Archiver le produit"
                                  >
                                    {archivingId === p.id ? (
                                      <Loader2 className="size-3.5 animate-spin" />
                                    ) : (
                                      <Archive className="size-3.5" />
                                    )}
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Archiver « {p.name} » ?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Le produit sera archivé (suppression douce). Ses données
                                      historiques resteront accessibles, mais il ne sera plus utilisé
                                      pour les nouveaux runs.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Annuler</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleArchive(p.id)}>
                                      Archiver
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {archived.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {archived.length} produit{archived.length !== 1 ? 's' : ''} archivé
          {archived.length !== 1 ? 's' : ''}.
        </p>
      )}

      <ProductCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={handleCreated}
      />

      <GithubImportDialog
        open={githubImportOpen}
        onOpenChange={setGithubImportOpen}
        onImported={() => refetch()}
      />

      <ProductCreateDialog
        open={!!editingProduct}
        onOpenChange={(open) => {
          if (!open) setEditingProduct(null);
        }}
        mode="edit"
        initialValues={editingProduct}
        onUpdated={handleUpdated}
      />
    </div>
  );
}
