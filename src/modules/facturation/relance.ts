/**
 * Deterministic French payment-reminder drafting.
 *
 * Produces a staged reminder per overdue invoice — never sent automatically.
 * No AI call, so reminders are free and reproducible. An AI-composed variant
 * (tone matching the activity's voice) can land later behind an `ai.compose`
 * step. See ADR-0016.
 */
import type { InvoiceRecord } from '../../db.js';

export interface RelanceDraft {
  invoiceId: string;
  invoiceNumber: string;
  clientName: string;
  clientEmail: string | null;
  daysOverdue: number;
  subject: string;
  body: string;
}

function formatAmount(cents: number, currency: string): string {
  return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

export function draftRelance(invoice: InvoiceRecord, today: string): RelanceDraft {
  const amount = formatAmount(invoice.amount_cents, invoice.currency);
  const daysOverdue = daysBetween(invoice.due_on, today);
  const subject = `Relance — facture ${invoice.number} (${amount})`;
  const body = [
    `Bonjour ${invoice.client_name},`,
    '',
    `Sauf erreur de notre part, la facture ${invoice.number} d'un montant de ${amount}, ` +
      `échue le ${invoice.due_on} (${daysOverdue} jour(s) de retard), reste à ce jour impayée.`,
    '',
    `Je vous remercie de bien vouloir procéder à son règlement dès que possible. ` +
      `Si le paiement a déjà été effectué, merci d'ignorer ce message.`,
    '',
    'Bien cordialement,',
  ].join('\n');

  return {
    invoiceId: invoice.id,
    invoiceNumber: invoice.number,
    clientName: invoice.client_name,
    clientEmail: invoice.client_email,
    daysOverdue,
    subject,
    body,
  };
}

export function summarizeRelances(drafts: RelanceDraft[]): string {
  if (drafts.length === 0) return 'Aucune facture impayée à relancer. ✅';
  const lines = drafts.map(
    (d) => `• ${d.invoiceNumber} — ${d.clientName} (${d.daysOverdue} j de retard)`,
  );
  return [`💸 **RELANCES À VALIDER (${drafts.length})**`, '', ...lines].join('\n');
}
