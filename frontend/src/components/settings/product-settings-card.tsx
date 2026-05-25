import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useApi } from '@/hooks/use-api';
import { useSelectedProduct } from '@/lib/product-context';
import { CardFlash, type Flash } from './shared';
import type { ProductRecord } from '@/types';

/**
 * Field definitions for the per-product settings record.
 * Backend stores arbitrary string key/value pairs in `product_settings`;
 * these are the well-known keys the UI exposes.
 */
interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'password' | 'textarea';
  placeholder?: string;
  help?: string;
}

const FIELDS: FieldDef[] = [
  {
    key: 'x_query',
    label: 'Requête X',
    type: 'text',
    placeholder: 'from:OpenAI OR from:AnthropicAI',
    help: 'Filtre appliqué à la timeline X pour ce produit.',
  },
  {
    key: 'discord_webhook',
    label: 'Webhook Discord',
    type: 'password',
    placeholder: 'https://discord.com/api/webhooks/...',
    help: 'URL du webhook pour les notifications de ce produit.',
  },
  {
    key: 'collect_cron',
    label: 'Cron de collecte',
    type: 'text',
    placeholder: '0 * * * *',
    help: 'Fréquence de collecte des tweets (laisser vide pour utiliser la valeur globale).',
  },
  {
    key: 'publish_cron',
    label: 'Cron de publication',
    type: 'text',
    placeholder: '30 7 * * *',
    help: 'Fréquence de publication du résumé (laisser vide pour utiliser la valeur globale).',
  },
  {
    key: 'ai_prompt_override',
    label: 'Prompt IA personnalisé',
    type: 'textarea',
    placeholder: 'Surcharge facultative du prompt par défaut.',
    help: 'Si renseigné, ce prompt remplace le prompt par défaut pour ce produit.',
  },
];

export function ProductSettingsCard() {
  const { selectedProductId } = useSelectedProduct();
  const productPath = `/api/products/${encodeURIComponent(selectedProductId)}`;

  // Re-fetch each time the selected product changes
  const {
    data: product,
    loading: loadingProduct,
    error: productError,
    refetch: refetchProduct,
  } = useApi<ProductRecord>(productPath);

  const {
    data: settings,
    loading: loadingSettings,
    error: settingsError,
    refetch: refetchSettings,
  } = useApi<Record<string, string>>(`${productPath}/settings`);

  const [flash, setFlash] = useState<Flash>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const lastSyncedRef = useRef<string>('');

  // Merge product columns + product_settings into a single editable map.
  // Precedence: settings record value wins over the corresponding product column.
  const initialValues = useMemo(() => {
    const v: Record<string, string> = {};
    if (product) {
      for (const f of FIELDS) {
        const colVal = (product as unknown as Record<string, unknown>)[f.key];
        if (typeof colVal === 'string') v[f.key] = colVal;
      }
    }
    if (settings) {
      for (const [k, val] of Object.entries(settings)) {
        v[k] = val;
      }
    }
    return v;
  }, [product, settings]);

  // Reset local edits when the source changes (e.g. product switch or refetch)
  useEffect(() => {
    const signature = `${selectedProductId}:${JSON.stringify(initialValues)}`;
    if (signature !== lastSyncedRef.current) {
      lastSyncedRef.current = signature;
      setValues(initialValues);
      setFlash(null);
    }
  }, [initialValues, selectedProductId]);

  const handleSave = async (key: string) => {
    setSavingKey(key);
    setFlash(null);
    try {
      const res = await fetch(`${productPath}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: values[key] ?? '' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        setFlash({
          type: 'error',
          message: data.message || `Erreur HTTP ${res.status}`,
        });
        return;
      }
      setFlash({ type: 'success', message: `« ${key} » mis à jour.` });
      refetchSettings();
      refetchProduct();
    } catch {
      setFlash({ type: 'error', message: 'Erreur réseau lors de la sauvegarde.' });
    } finally {
      setSavingKey(null);
    }
  };

  const loading = loadingProduct || loadingSettings;
  const error = productError || settingsError;

  return (
    <Card>
      <CardHeader>
        <div className="font-semibold">Paramètres du produit</div>
        <p className="text-sm text-muted-foreground">
          Ces paramètres s'appliquent au produit sélectionné.
          {product?.name && (
            <>
              {' '}
              Actuellement : <strong>{product.name}</strong>{' '}
              <code className="font-mono text-xs">({product.id})</code>
            </>
          )}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <CardFlash flash={flash} />

        {error && (
          <Alert variant="destructive">
            <AlertDescription>
              Impossible de charger les paramètres du produit : {error}
            </AlertDescription>
          </Alert>
        )}

        {loading && !product ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <div className="space-y-5">
            {FIELDS.map((field) => {
              const value = values[field.key] ?? '';
              const saving = savingKey === field.key;
              return (
                <div key={field.key} className="space-y-2">
                  <Label htmlFor={`product-setting-${field.key}`}>{field.label}</Label>
                  {field.type === 'textarea' ? (
                    <Textarea
                      id={`product-setting-${field.key}`}
                      value={value}
                      onChange={(e) =>
                        setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                      }
                      placeholder={field.placeholder}
                      rows={4}
                    />
                  ) : (
                    <Input
                      id={`product-setting-${field.key}`}
                      type={field.type === 'password' ? 'password' : 'text'}
                      value={value}
                      onChange={(e) =>
                        setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                      }
                      placeholder={field.placeholder}
                      autoComplete={field.type === 'password' ? 'off' : undefined}
                    />
                  )}
                  {field.help && (
                    <p className="text-xs text-muted-foreground">{field.help}</p>
                  )}
                  <div>
                    <Button
                      type="button"
                      size="sm"
                      disabled={saving}
                      onClick={() => handleSave(field.key)}
                    >
                      {saving ? 'Enregistrement...' : 'Enregistrer'}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
