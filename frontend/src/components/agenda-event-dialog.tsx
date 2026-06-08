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
import { withProductId } from '@/lib/product-context-hooks';

/**
 * Manual event creation dialog (ADR-0019). Posts to /api/agenda/events; the
 * starts_at is built from the date plus an optional time (all-day when omitted).
 */
export function AgendaEventDialog({
  productId,
  onCreated,
}: {
  productId: string;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [location, setLocation] = useState('');

  function reset() {
    setTitle('');
    setDate('');
    setTime('');
    setLocation('');
  }

  async function submit() {
    if (!title.trim() || !date) {
      toast.error('Renseignez au moins un titre et une date.');
      return;
    }
    setSaving(true);
    try {
      const starts_at = time ? `${date}T${time}` : date;
      const res = await fetch(withProductId('/api/agenda/events', productId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), starts_at, location: location.trim() || undefined }),
      });
      if (!res.ok) throw new Error(`Erreur HTTP ${res.status}`);
      toast.success('Événement ajouté.');
      reset();
      setOpen(false);
      onCreated();
    } catch {
      toast.error("Impossible d'ajouter l'événement.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-2 h-3.5 w-3.5" />
        Ajouter un événement
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouvel événement</DialogTitle>
            <DialogDescription>
              Ajouté à votre agenda local. Laissez l'heure vide pour un événement sur la journée.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="event-title">Titre</Label>
              <Input
                id="event-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Rendez-vous client"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="event-date">Date</Label>
                <Input
                  id="event-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="event-time">Heure (optionnelle)</Label>
                <Input
                  id="event-time"
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="event-location">Lieu (optionnel)</Label>
              <Input
                id="event-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Visio, adresse…"
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
