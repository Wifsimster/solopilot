import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StatusDot, CardFlash, type Flash } from './shared';
import type { ConfigResponse } from '@/types';

type DigestMode = 'consolidated' | 'per-product';

interface VeilleDigestCardProps {
  mode: DigestMode;
  credentialInfo: ConfigResponse['credentialInfo'];
  onSaved: () => void;
}

const MODE_OPTIONS: { value: DigestMode; label: string }[] = [
  { value: 'per-product', label: 'Un message par produit (par défaut)' },
  { value: 'consolidated', label: 'Digest consolidé (un seul message pour tous les produits)' },
];

const SOURCE_LABELS: Record<ConfigResponse['credentialInfo']['veilleWebhookSource'], string> = {
  VEILLE_DISCORD_WEBHOOK_URL: 'webhook de veille ci-dessous',
  DISCORD_WEBHOOK_URL: 'webhook Discord global (repli)',
  none: 'aucun webhook — le digest consolidé ne sera pas envoyé',
};

export function VeilleDigestCard({ mode, credentialInfo, onSaved }: VeilleDigestCardProps) {
  const [flash, setFlash] = useState<Flash>(null);
  const [savingMode, setSavingMode] = useState(false);
  const [savingWebhook, setSavingWebhook] = useState(false);

  const postJson = async (url: string, method: 'POST' | 'DELETE', body?: unknown) => {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return (await res.json()) as { success: boolean; message: string };
  };

  const handleModeChange = async (value: string) => {
    setSavingMode(true);
    setFlash(null);
    try {
      const data = await postJson('/api/settings', 'POST', { VEILLE_DIGEST_MODE: value });
      setFlash({ type: data.success ? 'success' : 'error', message: data.message });
      if (data.success) onSaved();
    } catch {
      setFlash({ type: 'error', message: "Erreur lors de l'enregistrement du mode." });
    } finally {
      setSavingMode(false);
    }
  };

  const handleWebhookSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    setSavingWebhook(true);
    setFlash(null);
    const formData = new FormData(form);
    try {
      const data = await postJson('/api/veille-discord-webhook', 'POST', {
        VEILLE_DISCORD_WEBHOOK_URL: formData.get('VEILLE_DISCORD_WEBHOOK_URL') as string,
      });
      setFlash({ type: data.success ? 'success' : 'error', message: data.message });
      if (data.success) {
        form.reset();
        onSaved();
      }
    } catch {
      setFlash({ type: 'error', message: "Erreur lors de l'enregistrement du webhook." });
    } finally {
      setSavingWebhook(false);
    }
  };

  const handleWebhookDelete = async () => {
    setSavingWebhook(true);
    setFlash(null);
    try {
      const data = await postJson('/api/veille-discord-webhook', 'DELETE');
      setFlash({ type: data.success ? 'success' : 'error', message: data.message });
      if (data.success) onSaved();
    } catch {
      setFlash({ type: 'error', message: 'Erreur lors de la suppression du webhook.' });
    } finally {
      setSavingWebhook(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle>Digest de veille Discord</CardTitle>
            <CardDescription>
              Choisissez entre un message par produit (webhook de chaque produit) ou un digest
              quotidien consolidé : un seul message, une section par produit (top 3 ou « Rien de
              notable »), découpé automatiquement si les limites Discord sont atteintes.
            </CardDescription>
          </div>
          <div className="shrink-0">
            <StatusDot configured={!!credentialInfo.veilleDiscordWebhookMasked} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <CardFlash flash={flash} />

        <div className="space-y-2">
          <Label htmlFor="veille-digest-mode">Mode d'envoi du digest</Label>
          <Select value={mode} onValueChange={handleModeChange} disabled={savingMode}>
            <SelectTrigger id="veille-digest-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {mode === 'consolidated' && (
            <p className="text-xs text-muted-foreground">
              Destination actuelle : {SOURCE_LABELS[credentialInfo.veilleWebhookSource]}.
            </p>
          )}
        </div>

        <form onSubmit={handleWebhookSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="veille_discord_webhook">Webhook Discord de veille</Label>
            <Input
              id="veille_discord_webhook"
              name="VEILLE_DISCORD_WEBHOOK_URL"
              type="password"
              placeholder="https://discord.com/api/webhooks/..."
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              {credentialInfo.veilleDiscordWebhookMasked ? (
                <>
                  Valeur actuelle :{' '}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                    {credentialInfo.veilleDiscordWebhookMasked}
                  </code>
                </>
              ) : (
                'Non configuré — le webhook Discord global est utilisé en repli.'
              )}
            </p>
          </div>

          <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:gap-4">
            <Button type="submit" disabled={savingWebhook}>
              {savingWebhook ? 'Enregistrement...' : 'Enregistrer le webhook'}
            </Button>
            {credentialInfo.veilleDiscordWebhookMasked && (
              <Button
                type="button"
                variant="outline"
                disabled={savingWebhook}
                onClick={handleWebhookDelete}
              >
                Supprimer
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
