/**
 * CRM store — contacts, deals (pipeline) and interactions.
 *
 * Scoped by product_id (activity). Logging an interaction or moving a deal bumps
 * the deal's `updated_at`, which is how staleness is measured. Leads from the
 * Acquisition module can be promoted into contacts here. See ADR-0018.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  getDb,
  DEFAULT_PRODUCT_ID,
  type ContactRecord,
  type DealRecord,
  type InteractionRecord,
} from '../../db.js';
import { getTodayDateParis } from '../../date-utils.js';

export const OPEN_STAGES = ['nouveau', 'qualifie', 'proposition'] as const;
export const CLOSED_STAGES = ['gagne', 'perdu'] as const;
const ALL_STAGES = [...OPEN_STAGES, ...CLOSED_STAGES] as const;

// --- Contacts ---

export const contactCreateSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  company: z.string().optional(),
  phone: z.string().optional(),
  status: z.enum(['lead', 'active', 'inactive']).default('lead'),
  source: z.string().default('manual'),
  notes: z.string().optional(),
});
export type ContactCreateInput = z.infer<typeof contactCreateSchema>;

export function createContact(
  productId: string = DEFAULT_PRODUCT_ID,
  input: ContactCreateInput,
): ContactRecord {
  const data = contactCreateSchema.parse(input);
  const id = randomUUID();
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO contacts (id, product_id, name, email, company, phone, status, source, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      productId,
      data.name,
      data.email ?? null,
      data.company ?? null,
      data.phone ?? null,
      data.status,
      data.source,
      data.notes ?? null,
      now,
      now,
    );
  return getContact(id)!;
}

export function getContact(id: string): ContactRecord | undefined {
  return getDb().prepare('SELECT * FROM contacts WHERE id = ?').get(id) as
    | ContactRecord
    | undefined;
}

export function listContacts(productId: string = DEFAULT_PRODUCT_ID): ContactRecord[] {
  return getDb()
    .prepare('SELECT * FROM contacts WHERE product_id = ? ORDER BY updated_at DESC')
    .all(productId) as ContactRecord[];
}

// --- Deals ---

export const dealCreateSchema = z.object({
  contact_id: z.string().min(1),
  title: z.string().min(1),
  stage: z.enum(['nouveau', 'qualifie', 'proposition', 'gagne', 'perdu']).default('nouveau'),
  amount_cents: z.coerce.number().int().nonnegative().default(0),
});
export type DealCreateInput = z.infer<typeof dealCreateSchema>;

export function createDeal(
  productId: string = DEFAULT_PRODUCT_ID,
  input: DealCreateInput,
): DealRecord {
  const data = dealCreateSchema.parse(input);
  const id = randomUUID();
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO deals (id, product_id, contact_id, title, stage, amount_cents, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, productId, data.contact_id, data.title, data.stage, data.amount_cents, now, now);
  return getDeal(id)!;
}

export function getDeal(id: string): DealRecord | undefined {
  return getDb().prepare('SELECT * FROM deals WHERE id = ?').get(id) as DealRecord | undefined;
}

export function listDeals(productId: string = DEFAULT_PRODUCT_ID): DealRecord[] {
  return getDb()
    .prepare('SELECT * FROM deals WHERE product_id = ? ORDER BY updated_at DESC')
    .all(productId) as DealRecord[];
}

const dealStageSchema = z.enum(['nouveau', 'qualifie', 'proposition', 'gagne', 'perdu']);

export function updateDealStage(id: string, stage: string): DealRecord | undefined {
  const parsed = dealStageSchema.safeParse(stage);
  if (!parsed.success) return undefined;
  const now = Date.now();
  const closedAt = (CLOSED_STAGES as readonly string[]).includes(parsed.data) ? now : null;
  getDb()
    .prepare('UPDATE deals SET stage = ?, updated_at = ?, closed_at = ? WHERE id = ?')
    .run(parsed.data, now, closedAt, id);
  return getDeal(id);
}

// --- Interactions ---

export const interactionCreateSchema = z.object({
  contact_id: z.string().min(1),
  kind: z.enum(['note', 'email', 'call', 'meeting']).default('note'),
  summary: z.string().min(1),
  occurred_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type InteractionCreateInput = z.infer<typeof interactionCreateSchema>;

export function addInteraction(
  productId: string = DEFAULT_PRODUCT_ID,
  input: InteractionCreateInput,
): InteractionRecord {
  const data = interactionCreateSchema.parse(input);
  const id = randomUUID();
  const now = Date.now();
  const db = getDb();
  db.prepare(
    `INSERT INTO interactions (id, product_id, contact_id, kind, summary, occurred_on, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, productId, data.contact_id, data.kind, data.summary, data.occurred_on ?? getTodayDateParis(), now);
  // Touch the contact and its open deals so an interaction resets staleness.
  db.prepare('UPDATE contacts SET updated_at = ? WHERE id = ?').run(now, data.contact_id);
  db.prepare(
    `UPDATE deals SET updated_at = ? WHERE contact_id = ? AND stage IN ('nouveau','qualifie','proposition')`,
  ).run(now, data.contact_id);
  return db.prepare('SELECT * FROM interactions WHERE id = ?').get(id) as InteractionRecord;
}

export function listInteractions(contactId: string): InteractionRecord[] {
  return getDb()
    .prepare('SELECT * FROM interactions WHERE contact_id = ? ORDER BY occurred_on DESC')
    .all(contactId) as InteractionRecord[];
}

// --- Staleness & summary ---

const STALE_DAYS = 14;

export interface StaleDeal extends DealRecord {
  contact_name: string;
  days_stale: number;
}

export function listStaleDeals(
  productId: string = DEFAULT_PRODUCT_ID,
  now: number = Date.now(),
): StaleDeal[] {
  const cutoff = now - STALE_DAYS * 86_400_000;
  const rows = getDb()
    .prepare(
      `SELECT d.*, c.name AS contact_name FROM deals d
       JOIN contacts c ON c.id = d.contact_id
       WHERE d.product_id = ? AND d.stage IN ('nouveau','qualifie','proposition') AND d.updated_at < ?
       ORDER BY d.updated_at ASC`,
    )
    .all(productId, cutoff) as (DealRecord & { contact_name: string })[];
  return rows.map((r) => ({
    ...r,
    days_stale: Math.floor((now - r.updated_at) / 86_400_000),
  }));
}

export interface CrmSummary {
  contacts: number;
  openDeals: number;
  openValueCents: number;
  staleDeals: number;
}

export function crmSummary(
  productId: string = DEFAULT_PRODUCT_ID,
  now: number = Date.now(),
): CrmSummary {
  const db = getDb();
  const contacts = (db
    .prepare('SELECT COUNT(*) AS n FROM contacts WHERE product_id = ?')
    .get(productId) as { n: number }).n;
  const open = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents),0) AS v FROM deals
       WHERE product_id = ? AND stage IN ('nouveau','qualifie','proposition')`,
    )
    .get(productId) as { n: number; v: number };
  return {
    contacts,
    openDeals: open.n,
    openValueCents: open.v,
    staleDeals: listStaleDeals(productId, now).length,
  };
}

export const CRM_STAGES = ALL_STAGES;
