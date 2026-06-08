import { useMemo, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { withProductId } from '@/lib/product-context-hooks';

/**
 * Stripe Embedded Checkout to collect payment on an invoice (ADR-0016 / ADR-0021).
 * The backend creates the embedded session; on completion Stripe redirects the
 * page to the session's return_url. Only mounted when both Stripe keys are set.
 */
export function StripeCheckoutDialog({
  invoiceId,
  invoiceLabel,
  publishableKey,
  productId,
}: {
  invoiceId: string;
  invoiceLabel: string;
  publishableKey: string;
  productId: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const stripePromise = useMemo(() => loadStripe(publishableKey), [publishableKey]);

  async function start() {
    setOpen(true);
    setLoading(true);
    setClientSecret(null);
    try {
      const res = await fetch(
        withProductId(`/api/facturation/invoices/${invoiceId}/checkout`, productId),
        { method: 'POST' },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Erreur HTTP ${res.status}`);
      setClientSecret(data.clientSecret);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Échec du paiement Stripe.');
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={start}>
        Encaisser
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Encaisser {invoiceLabel}</DialogTitle>
            <DialogDescription>Paiement sécurisé via Stripe.</DialogDescription>
          </DialogHeader>
          {loading || !clientSecret ? (
            <Skeleton className="h-72 w-full" />
          ) : (
            <div className="max-h-[70vh] overflow-y-auto">
              <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret }}>
                <EmbeddedCheckout />
              </EmbeddedCheckoutProvider>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
