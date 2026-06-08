/**
 * Stripe connector (read-only).
 *
 * Optional: when STRIPE_API_KEY is unset, `isConfigured()` is false and
 * `listInvoices()` resolves to [] — the Facturation module then works as a
 * purely local ledger. When configured, it reads invoices from the Stripe REST
 * API and maps them to the core `StripeInvoiceData` shape. Read-only: Solopilot
 * never creates or sends anything on Stripe without explicit user action.
 *
 * The configured path is exercised only when a key is present; the sync step
 * that calls it is degradable, so a Stripe outage can never fail a workflow run.
 */
import type { Config } from '../config.js';
import { logger } from '../logger.js';
import type { StripeConnector, StripeInvoiceData } from '../workflow/types.js';

const STRIPE_API = 'https://api.stripe.com/v1';

interface StripeInvoice {
  id: string;
  number: string | null;
  customer_name: string | null;
  customer_email: string | null;
  amount_due: number;
  currency: string;
  status: string | null;
  created: number;
  due_date: number | null;
  status_transitions?: { paid_at: number | null };
}

function unixToDate(unix: number | null): string | null {
  if (!unix) return null;
  return new Date(unix * 1000).toISOString().slice(0, 10);
}

function mapStatus(status: string | null): StripeInvoiceData['status'] {
  switch (status) {
    case 'paid':
      return 'paid';
    case 'draft':
      return 'draft';
    case 'void':
    case 'uncollectible':
      return 'void';
    default:
      return 'sent';
  }
}

function mapInvoice(inv: StripeInvoice): StripeInvoiceData {
  const issued = unixToDate(inv.created) ?? new Date().toISOString().slice(0, 10);
  return {
    stripe_id: inv.id,
    number: inv.number ?? inv.id,
    client_name: inv.customer_name ?? inv.customer_email ?? 'Client',
    client_email: inv.customer_email ?? null,
    amount_cents: inv.amount_due,
    currency: inv.currency,
    status: mapStatus(inv.status),
    issued_on: issued,
    due_on: unixToDate(inv.due_date) ?? issued,
    paid_on: unixToDate(inv.status_transitions?.paid_at ?? null),
  };
}

export function createStripeConnector(config: Config): StripeConnector {
  const apiKey = config.STRIPE_API_KEY;

  return {
    isConfigured: () => !!apiKey,
    listInvoices: async () => {
      if (!apiKey) return [];
      const res = await fetch(`${STRIPE_API}/invoices?limit=100`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) {
        throw new Error(`Stripe API error ${res.status}`);
      }
      const body = (await res.json()) as { data?: StripeInvoice[] };
      const invoices = (body.data ?? []).map(mapInvoice);
      logger.info('Stripe invoices fetched', { count: invoices.length });
      return invoices;
    },
  };
}
