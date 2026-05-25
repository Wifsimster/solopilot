import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import type { ProductRecord } from '@/types';

interface ProductCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (product: ProductRecord) => void;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function ProductCreateDialog({ open, onOpenChange, onCreated }: ProductCreateDialogProps) {
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [idTouched, setIdTouched] = useState(false);
  const [xQuery, setXQuery] = useState('');
  const [discordWebhook, setDiscordWebhook] = useState('');
  const [aiPromptOverride, setAiPromptOverride] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state when dialog is closed
  useEffect(() => {
    if (!open) {
      setName('');
      setId('');
      setIdTouched(false);
      setXQuery('');
      setDiscordWebhook('');
      setAiPromptOverride('');
      setSubmitting(false);
      setError(null);
    }
  }, [open]);

  const handleNameBlur = () => {
    if (!idTouched && name.trim() && !id) {
      setId(slugify(name));
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    const trimmedId = id.trim();
    const trimmedName = name.trim();
    if (!trimmedId) {
      setError('Identifiant requis.');
      return;
    }
    if (!/^[a-z0-9-]+$/.test(trimmedId)) {
      setError('Identifiant invalide : minuscules, chiffres et tirets uniquement.');
      return;
    }
    if (!trimmedName) {
      setError('Nom requis.');
      return;
    }

    setSubmitting(true);
    try {
      const body: Record<string, string> = {
        id: trimmedId,
        name: trimmedName,
      };
      if (xQuery.trim()) body.x_query = xQuery.trim();
      if (discordWebhook.trim()) body.discord_webhook = discordWebhook.trim();
      if (aiPromptOverride.trim()) body.ai_prompt_override = aiPromptOverride.trim();

      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) {
        setError(data.message || `Erreur HTTP ${res.status}`);
        return;
      }
      // Backend may return the product directly or under `product`
      const created: ProductRecord = data.product || data;
      toast.success(`Produit "${created.name || trimmedName}" créé.`);
      onCreated?.(created);
      onOpenChange(false);
    } catch {
      setError('Erreur réseau lors de la création.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouveau produit</DialogTitle>
          <DialogDescription>
            Créez un produit pour isoler sa requête X, son webhook Discord et son prompt IA.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="product-name">Nom</Label>
            <Input
              id="product-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={handleNameBlur}
              placeholder="Veille IA"
              required
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="product-id">Identifiant</Label>
            <Input
              id="product-id"
              value={id}
              onChange={(e) => {
                setId(e.target.value);
                setIdTouched(true);
              }}
              placeholder="veille-ia"
              required
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Slug unique (minuscules, chiffres et tirets). Auto-rempli depuis le nom.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="product-x-query">Requête X (optionnel)</Label>
            <Input
              id="product-x-query"
              value={xQuery}
              onChange={(e) => setXQuery(e.target.value)}
              placeholder="from:OpenAI OR from:AnthropicAI"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="product-discord-webhook">Webhook Discord (optionnel)</Label>
            <Input
              id="product-discord-webhook"
              type="password"
              value={discordWebhook}
              onChange={(e) => setDiscordWebhook(e.target.value)}
              placeholder="https://discord.com/api/webhooks/..."
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="product-prompt">Prompt IA personnalisé (optionnel)</Label>
            <Textarea
              id="product-prompt"
              value={aiPromptOverride}
              onChange={(e) => setAiPromptOverride(e.target.value)}
              placeholder="Surcharge facultative du prompt par défaut."
              rows={4}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Annuler
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Création...' : 'Créer le produit'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
