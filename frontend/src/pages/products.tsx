import { useState } from 'react';
import { useApi } from '@/hooks/use-api';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { AlertCircle, Plus, Archive, Loader2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { formatDateFr } from '@/lib/utils';
import { useSelectedProduct } from '@/lib/product-context';
import type { ProductRecord } from '@/types';

function SourceBadges({ product }: { product: ProductRecord }) {
  const xActive = product.x_enabled;
  const subCount = product.reddit_subreddits?.length ?? 0;
  const redditActive = product.reddit_enabled && subCount > 0;
  const hnCount = product.hn_keywords?.length ?? 0;
  const hnActive = product.hn_enabled && hnCount > 0;
  const intentCount = product.intent_keywords?.length ?? 0;
  const intentActive = product.intent_enabled && intentCount > 0;

  if (!xActive && !redditActive && !hnActive && !intentActive) {
    return <span className="text-xs text-muted-foreground">Aucune</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {xActive && (
        <Badge variant="secondary" className="text-xs" title="Source X activée">
          X
        </Badge>
      )}
      {redditActive && (
        <Badge
          variant="secondary"
          className="text-xs"
          title={`Subreddits : ${product.reddit_subreddits?.join(', ')}`}
        >
          r/{subCount}
        </Badge>
      )}
      {hnActive && (
        <Badge
          variant="secondary"
          className="text-xs"
          title={`Mots-clés Hacker News : ${product.hn_keywords?.join(', ')}`}
        >
          hn:{hnCount}
        </Badge>
      )}
      {intentActive && (
        <Badge
          variant="success"
          className="text-xs"
          title={`Mots-clés d'intention : ${product.intent_keywords?.join(', ')}`}
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
        <div>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="mt-2 h-4 w-72" />
        </div>
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Produits</h1>
          <p className="text-muted-foreground">Gestion des produits</p>
        </div>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Impossible de charger la liste des produits : {error}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const products = data ?? [];
  const active = products.filter((p) => !p.archived_at);
  const archived = products.filter((p) => p.archived_at);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Produits</h1>
          <p className="text-muted-foreground">
            {active.length} produit{active.length !== 1 ? 's' : ''} actif
            {active.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Nouveau produit
        </Button>
      </div>

      {products.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Aucun produit configuré. Cliquez sur « Nouveau produit » pour en créer un.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom</TableHead>
                  <TableHead>Identifiant</TableHead>
                  <TableHead>Sources</TableHead>
                  <TableHead>Requête X</TableHead>
                  <TableHead>Créé le</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((p) => {
                  const isSelected = p.id === selectedProductId;
                  const isArchived = !!p.archived_at;
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {p.name}
                          {isSelected && (
                            <Badge variant="secondary" className="text-xs">
                              sélectionné
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <code className="text-xs font-mono">{p.id}</code>
                      </TableCell>
                      <TableCell>
                        <SourceBadges product={p} />
                      </TableCell>
                      <TableCell className="text-sm" title={p.x_query ?? ''}>
                        {truncate(p.x_query, 50)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
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
                        <div className="flex items-center justify-end gap-2">
                          {!isSelected && !isArchived && (
                            <Button
                              variant="ghost"
                              size="sm"
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
                              <Pencil className="h-3.5 w-3.5 mr-1" />
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
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Archive className="h-3.5 w-3.5" />
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
