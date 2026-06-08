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

type Status = 'draft' | 'sent' | 'paid' | 'void';

const STATUS_OPTIONS: { value: Status; label: string }[] = [
  { value: 'draft', label: 'Brouillon' },
  { value: 'sent', label: 'Envoyée' },
  { value: 'paid', label: 'Payée' },
  { value: 'void', label: 'Annulée' },
];

/**
 * Manual invoice creation dialog (ADR-0016). Posts to /api/facturation/invoices.
 * The amount is entered in euros and converted to cents for the API.
 */
export function FacturationInvoiceDialog({
  productId,
  onCreated,
}: {
  productId: string;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clientName, setClientName] = useState('');
  const [amount, setAmount] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [issuedOn, setIssuedOn] = useState('');
  const [status, setStatus] = useState<Status>('sent');

  function reset() {
    setClientName('');
    setAmount('');
    setDueOn('');
    setIssuedOn('');
    setStatus('sent');
  }

  async function submit() {
    const euros = Number.parseFloat(amount.replace(',', '.'));
    if (!clientName.trim() || !dueOn || !Number.isFinite(euros) || euros <= 0) {
      toast.error('Renseignez un client, un montant positif et une échéance.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(withProductId('/api/facturation/invoices', productId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: clientName.trim(),
          amount_cents: Math.round(euros * 100),
          due_on: dueOn,
          issued_on: issuedOn || undefined,
          status,
        }),
      });
      if (!res.ok) throw new Error(`Erreur HTTP ${res.status}`);
      toast.success('Facture créée.');
      reset();
      setOpen(false);
      onCreated();
    } catch {
      toast.error('Impossible de créer la facture.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-2 h-3.5 w-3.5" />
        Nouvelle facture
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouvelle facture</DialogTitle>
            <DialogDescription>
              Ajoutée au ledger local. Le numéro est attribué automatiquement.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="invoice-client">Client</Label>
              <Input
                id="invoice-client"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Société Dupont"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="invoice-amount">Montant (€)</Label>
                <Input
                  id="invoice-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="1200.00"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invoice-status">Statut</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
                  <SelectTrigger id="invoice-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="invoice-issued">Émise le (optionnel)</Label>
                <Input
                  id="invoice-issued"
                  type="date"
                  value={issuedOn}
                  onChange={(e) => setIssuedOn(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invoice-due">Échéance</Label>
                <Input
                  id="invoice-due"
                  type="date"
                  value={dueOn}
                  onChange={(e) => setDueOn(e.target.value)}
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
