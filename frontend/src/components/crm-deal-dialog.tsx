import { useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { withProductId } from '@/lib/product-context-hooks';
import type { Stage } from '@/components/deal-pipeline';

const STAGE_OPTIONS: { value: Stage; label: string }[] = [
  { value: 'nouveau', label: 'Nouveau' },
  { value: 'qualifie', label: 'Qualifié' },
  { value: 'proposition', label: 'Proposition' },
  { value: 'gagne', label: 'Gagné' },
  { value: 'perdu', label: 'Perdu' },
];

/**
 * Manual deal creation dialog (ADR-0018). Posts to /api/crm/deals. Requires at
 * least one contact to attach the opportunity to.
 */
export function CrmDealDialog({
  productId,
  contacts,
  onCreated,
}: {
  productId: string;
  contacts: { id: string; name: string }[];
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [contactId, setContactId] = useState('');
  const [stage, setStage] = useState<Stage>('nouveau');
  const [amount, setAmount] = useState('');

  function reset() {
    setTitle('');
    setContactId('');
    setStage('nouveau');
    setAmount('');
  }

  async function submit() {
    if (!title.trim() || !contactId) {
      toast.error('Renseignez un intitulé et un contact.');
      return;
    }
    const euros = amount ? Number.parseFloat(amount.replace(',', '.')) : 0;
    setSaving(true);
    try {
      const res = await fetch(withProductId('/api/crm/deals', productId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: contactId,
          title: title.trim(),
          stage,
          amount_cents: Number.isFinite(euros) && euros > 0 ? Math.round(euros * 100) : 0,
        }),
      });
      if (!res.ok) throw new Error(`Erreur HTTP ${res.status}`);
      toast.success('Opportunité créée.');
      reset();
      setOpen(false);
      onCreated();
    } catch {
      toast.error("Impossible de créer l'opportunité.");
    } finally {
      setSaving(false);
    }
  }

  const disabled = contacts.length === 0;

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} disabled={disabled}>
        <Plus className="mr-2 h-3.5 w-3.5" />
        Nouvelle opportunité
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouvelle opportunité</DialogTitle>
            <DialogDescription>Rattachée à un contact de votre CRM.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="deal-title">Intitulé</Label>
              <Input
                id="deal-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Refonte du site"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="deal-contact">Contact</Label>
              <Select value={contactId} onValueChange={setContactId}>
                <SelectTrigger id="deal-contact">
                  <SelectValue placeholder="Choisir un contact" />
                </SelectTrigger>
                <SelectContent>
                  {contacts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="deal-stage">Étape</Label>
                <Select value={stage} onValueChange={(v) => setStage(v as Stage)}>
                  <SelectTrigger id="deal-stage">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STAGE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="deal-amount">Montant (€, optionnel)</Label>
                <Input
                  id="deal-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="3000"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
              Annuler
            </Button>
            <Button onClick={submit} disabled={saving}>
              {saving ? 'Création…' : 'Créer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
