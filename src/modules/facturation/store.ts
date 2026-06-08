/**
 * Facturation store — local invoice ledger.
 *
 * Works standalone (manual invoice entry) and is the upsert target for the
 * optional Stripe sync. Scoped by product_id (activity). Idempotent writes via
 * the stripe_id unique index. See ADR-0016.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getDb, DEFAULT_PRODUCT_ID, type InvoiceRecord } from '../../db.js';
import { getTodayDateParis } from '../../date-utils.js';
import type { StripeInvoiceData } from '../../workflow/types.js';

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format YYYY-MM-DD');

export const invoiceCreateSchema = z.object({
  client_name: z.string().min(1),
  client_email: z.string().email().optional(),
  amount_cents: z.coerce.number().int().positive(),
  currency: z.string().min(3).max(3).default('eur'),
  issued_on: DATE.optional(),
  due_on: DATE,
  status: z.enum(['draft', 'sent', 'paid', 'void']).default('sent'),
});

export type InvoiceCreateInput = z.infer<typeof invoiceCreateSchema>;

function nextInvoiceNumber(productId: string, year: number): string {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM invoices WHERE product_id = ? AND issued_on LIKE ?`,
    )
    .get(productId, `${year}-%`) as { n: number };
  return `F-${year}-${String(row.n + 1).padStart(3, '0')}`;
}

export function createInvoice(
  productId: string = DEFAULT_PRODUCT_ID,
  input: InvoiceCreateInput,
): InvoiceRecord {
  // Parse here too so defaults (currency, status) apply regardless of caller.
  const data = invoiceCreateSchema.parse(input);
  const db = getDb();
  const id = randomUUID();
  const issued = data.issued_on ?? getTodayDateParis();
  const year = Number(issued.slice(0, 4));
  const number = nextInvoiceNumber(productId, year);

  db.prepare(
    `INSERT INTO invoices (id, product_id, number, client_name, client_email, amount_cents, currency, status, issued_on, due_on, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    productId,
    number,
    data.client_name,
    data.client_email ?? null,
    data.amount_cents,
    data.currency,
    data.status,
    issued,
    data.due_on,
    Date.now(),
  );

  return getInvoice(id)!;
}

export function getInvoice(id: string): InvoiceRecord | undefined {
  return getDb().prepare('SELECT * FROM invoices WHERE id = ?').get(id) as
    | InvoiceRecord
    | undefined;
}

export function listInvoices(
  productId: string = DEFAULT_PRODUCT_ID,
  opts: { status?: InvoiceRecord['status'] } = {},
): InvoiceRecord[] {
  const db = getDb();
  if (opts.status) {
    return db
      .prepare('SELECT * FROM invoices WHERE product_id = ? AND status = ? ORDER BY due_on ASC')
      .all(productId, opts.status) as InvoiceRecord[];
  }
  return db
    .prepare('SELECT * FROM invoices WHERE product_id = ? ORDER BY issued_on DESC')
    .all(productId) as InvoiceRecord[];
}

/** Invoices that are sent and past their due date — candidates for a reminder. */
export function listOverdueInvoices(
  productId: string = DEFAULT_PRODUCT_ID,
  today: string = getTodayDateParis(),
): InvoiceRecord[] {
  return getDb()
    .prepare(
      `SELECT * FROM invoices WHERE product_id = ? AND status = 'sent' AND due_on < ? ORDER BY due_on ASC`,
    )
    .all(productId, today) as InvoiceRecord[];
}

/** Sum of invoices marked paid within [from, to) — the encaissed turnover (CA). */
export function sumPaidInvoicesCents(productId: string, from: string, to: string): number {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM invoices
       WHERE product_id = ? AND status = 'paid' AND paid_on >= ? AND paid_on < ?`,
    )
    .get(productId, from, to) as { total: number };
  return row.total;
}

export function markInvoicePaid(id: string, paidOn: string = getTodayDateParis()): boolean {
  const res = getDb()
    .prepare(`UPDATE invoices SET status = 'paid', paid_on = ? WHERE id = ? AND status != 'paid'`)
    .run(paidOn, id);
  return res.changes > 0;
}

export interface FacturationSummary {
  total: number;
  unpaid: number;
  overdue: number;
  overdueAmountCents: number;
}

export function facturationSummary(
  productId: string = DEFAULT_PRODUCT_ID,
  today: string = getTodayDateParis(),
): FacturationSummary {
  const db = getDb();
  const total = (db
    .prepare('SELECT COUNT(*) AS n FROM invoices WHERE product_id = ?')
    .get(productId) as { n: number }).n;
  const unpaid = (db
    .prepare(`SELECT COUNT(*) AS n FROM invoices WHERE product_id = ? AND status = 'sent'`)
    .get(productId) as { n: number }).n;
  const overdueRows = listOverdueInvoices(productId, today);
  const overdueAmountCents = overdueRows.reduce((sum, i) => sum + i.amount_cents, 0);
  return { total, unpaid, overdue: overdueRows.length, overdueAmountCents };
}

/** Idempotent upsert from Stripe (matched on stripe_id). Returns rows written. */
export function upsertStripeInvoices(
  productId: string,
  invoices: StripeInvoiceData[],
): number {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO invoices (id, product_id, number, client_name, client_email, amount_cents, currency, status, issued_on, due_on, paid_on, stripe_id, created_at)
     VALUES (@id, @product_id, @number, @client_name, @client_email, @amount_cents, @currency, @status, @issued_on, @due_on, @paid_on, @stripe_id, @created_at)
     ON CONFLICT(stripe_id) DO UPDATE SET
       status = excluded.status, amount_cents = excluded.amount_cents,
       paid_on = excluded.paid_on, due_on = excluded.due_on`,
  );
  const tx = db.transaction((rows: StripeInvoiceData[]) => {
    for (const r of rows) {
      stmt.run({
        ...r,
        id: randomUUID(),
        product_id: productId,
        created_at: Date.now(),
      });
    }
    return rows.length;
  });
  return tx(invoices);
}
