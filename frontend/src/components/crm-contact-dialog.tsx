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

type Status = 'lead' | 'active' | 'inactive';

/**
 * Manual contact creation dialog (ADR-0018). Posts to /api/crm/contacts.
 */
export function CrmContactDialog({
  productId,
  onCreated,
}: {
  productId: string;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('lead');

  function reset() {
    setName('');
    setCompany('');
    setEmail('');
    setStatus('lead');
  }

  async function submit() {
    if (!name.trim()) {
      toast.error('Renseignez au moins un nom.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(withProductId('/api/crm/contacts', productId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          company: company.trim() || undefined,
          email: email.trim() || undefined,
          status,
        }),
      });
      if (!res.ok) throw new Error(`Erreur HTTP ${res.status}`);
      toast.success('Contact ajouté.');
      reset();
      setOpen(false);
      onCreated();
    } catch {
      toast.error("Impossible d'ajouter le contact.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-2 h-3.5 w-3.5" />
        Nouveau contact
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouveau contact</DialogTitle>
            <DialogDescription>Ajouté à votre CRM pour ce produit.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="contact-name">Nom</Label>
              <Input
                id="contact-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jeanne Dupont"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="contact-company">Société (optionnel)</Label>
                <Input
                  id="contact-company"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="contact-status">Statut</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
                  <SelectTrigger id="contact-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lead">Lead</SelectItem>
                    <SelectItem value="active">Actif</SelectItem>
                    <SelectItem value="inactive">Inactif</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contact-email">Email (optionnel)</Label>
              <Input
                id="contact-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jeanne@exemple.fr"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
              Annuler
            </Button>
            <Button onClick={submit} disabled={saving}>
              {saving ? 'Ajout…' : 'Ajouter'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
