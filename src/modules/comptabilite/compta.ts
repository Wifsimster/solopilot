/**
 * Comptabilité — micro-entreprise turnover tracking, thresholds and URSSAF.
 *
 * IMPORTANT — these are *estimates and reminders*, not authoritative figures.
 * Solopilot prepares and alerts; it does not télédéclare and does not replace an
 * accountant. Thresholds and rates are the published micro-entreprise values and
 * may change year to year — they are constants here, easy to update. See ADR-0017.
 *
 * Turnover (CA) is computed on encaissements: paid invoices (facturation) plus
 * manual `recette` ledger entries. The micro plafond is assessed on the calendar
 * year.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getDb, DEFAULT_PRODUCT_ID, type LedgerRecord } from '../../db.js';
import { getProductSetting, setProductSetting } from '../../settings-service.js';
import { sumPaidInvoicesCents } from '../facturation/store.js';
import { getTodayDateParis } from '../../date-utils.js';

export type ActivityType = 'services_bnc' | 'services_bic' | 'vente';
export type DeclarationPeriod = 'monthly' | 'quarterly';

const ACTIVITY_TYPES: ActivityType[] = ['services_bnc', 'services_bic', 'vente'];

// Published micro-entreprise values (EUR). Update when the law changes.
const PLAFOND_CENTS: Record<ActivityType, number> = {
  services_bnc: 77_700_00,
  services_bic: 77_700_00,
  vente: 188_700_00,
};
const TVA_FRANCHISE_CENTS: Record<ActivityType, number> = {
  services_bnc: 36_800_00,
  services_bic: 36_800_00,
  vente: 91_900_00,
};
// Social-contribution rates (basis points). Estimates — clearly flagged as such.
const COTISATION_BPS: Record<ActivityType, number> = {
  services_bnc: 2460, // 24.6%
  services_bic: 2120, // 21.2%
  vente: 1230, // 12.3%
};

const KEY_ACTIVITY = 'COMPTA_ACTIVITY_TYPE';
const KEY_PERIOD = 'COMPTA_DECLARATION_PERIOD';

function isActivityType(v: string | undefined): v is ActivityType {
  return !!v && (ACTIVITY_TYPES as string[]).includes(v);
}

export function getActivityType(productId: string = DEFAULT_PRODUCT_ID): ActivityType {
  const v = getProductSetting(productId, KEY_ACTIVITY);
  return isActivityType(v) ? v : 'services_bnc';
}

export function getDeclarationPeriod(productId: string = DEFAULT_PRODUCT_ID): DeclarationPeriod {
  return getProductSetting(productId, KEY_PERIOD) === 'quarterly' ? 'quarterly' : 'monthly';
}

export const comptaConfigSchema = z.object({
  activityType: z.enum(['services_bnc', 'services_bic', 'vente']).optional(),
  declarationPeriod: z.enum(['monthly', 'quarterly']).optional(),
});

export function setComptaConfig(
  productId: string,
  config: z.infer<typeof comptaConfigSchema>,
): void {
  if (config.activityType) setProductSetting(productId, KEY_ACTIVITY, config.activityType);
  if (config.declarationPeriod) setProductSetting(productId, KEY_PERIOD, config.declarationPeriod);
}

// --- Ledger ---

export const ledgerCreateSchema = z.object({
  kind: z.enum(['recette', 'depense']),
  amount_cents: z.coerce.number().int().positive(),
  label: z.string().min(1),
  occurred_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // ADR-0029: idempotency key (bank / store payout reference). Unique per
  // product: a second write with the same reference is refused with the
  // existing entry instead of creating a duplicate.
  external_ref: z.string().trim().min(1).max(128).optional(),
  // ADR-0029: who wrote the entry, e.g. `agent:budget`. Informational; the
  // authenticated token id is stored separately and cannot be spoofed.
  source: z
    .string()
    .regex(/^[a-z0-9][a-z0-9:._-]{0,63}$/, 'source: [a-z0-9:._-], 64 caractères max')
    .optional(),
});
export type LedgerCreateInput = z.infer<typeof ledgerCreateSchema>;

export interface LedgerWriteMeta {
  /** Id of the API token that authenticated the write (ADR-0029). */
  apiTokenId?: string | null;
}

/** Thrown when (product, external_ref) already exists; carries that entry. */
export class LedgerDuplicateError extends Error {
  constructor(public readonly existing: LedgerRecord) {
    super(`Écriture déjà enregistrée (external_ref ${existing.external_ref ?? ''})`);
    this.name = 'LedgerDuplicateError';
  }
}

export function findLedgerByExternalRef(
  productId: string,
  externalRef: string,
): LedgerRecord | undefined {
  return getDb()
    .prepare('SELECT * FROM ledger WHERE product_id = ? AND external_ref = ?')
    .get(productId, externalRef) as LedgerRecord | undefined;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
}

export function addLedgerEntry(
  productId: string = DEFAULT_PRODUCT_ID,
  input: LedgerCreateInput,
  meta: LedgerWriteMeta = {},
): LedgerRecord {
  const data = ledgerCreateSchema.parse(input);
  const id = randomUUID();
  const occurred = data.occurred_on ?? getTodayDateParis();
  const externalRef = data.external_ref ?? null;
  try {
    getDb()
      .prepare(
        `INSERT INTO ledger (id, product_id, kind, amount_cents, label, occurred_on, created_at,
           external_ref, source, api_token_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        productId,
        data.kind,
        data.amount_cents,
        data.label,
        occurred,
        Date.now(),
        externalRef,
        data.source ?? null,
        meta.apiTokenId ?? null,
      );
  } catch (err) {
    // The partial UNIQUE index is the source of truth (no check-then-insert race).
    if (externalRef && isUniqueViolation(err)) {
      const existing = findLedgerByExternalRef(productId, externalRef);
      if (existing) throw new LedgerDuplicateError(existing);
    }
    throw err;
  }
  return getDb().prepare('SELECT * FROM ledger WHERE id = ?').get(id) as LedgerRecord;
}

export function listLedger(
  productId: string = DEFAULT_PRODUCT_ID,
  opts: { since?: string } = {},
): LedgerRecord[] {
  if (opts.since) {
    return getDb()
      .prepare(
        `SELECT * FROM ledger WHERE product_id = ? AND occurred_on >= ?
         ORDER BY occurred_on DESC, created_at DESC`,
      )
      .all(productId, opts.since) as LedgerRecord[];
  }
  return getDb()
    .prepare('SELECT * FROM ledger WHERE product_id = ? ORDER BY occurred_on DESC, created_at DESC')
    .all(productId) as LedgerRecord[];
}

function sumLedgerRecettesCents(productId: string, from: string, to: string): number {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM ledger
       WHERE product_id = ? AND kind = 'recette' AND occurred_on >= ? AND occurred_on < ?`,
    )
    .get(productId, from, to) as { total: number };
  return row.total;
}

/** Encaissed turnover for [from, to): paid invoices + manual recettes. */
export function caForPeriodCents(productId: string, from: string, to: string): number {
  return sumPaidInvoicesCents(productId, from, to) + sumLedgerRecettesCents(productId, from, to);
}

// --- Status & declaration ---

export interface ComptaStatus {
  year: number;
  activityType: ActivityType;
  declarationPeriod: DeclarationPeriod;
  caCents: number;
  plafondCents: number;
  plafondPct: number;
  tvaThresholdCents: number;
  tvaPct: number;
  approachingPlafond: boolean;
  tvaExceeded: boolean;
}

const ALERT_PLAFOND_PCT = 80;

export function comptaStatus(
  productId: string = DEFAULT_PRODUCT_ID,
  today: string = getTodayDateParis(),
): ComptaStatus {
  const year = Number(today.slice(0, 4));
  const activityType = getActivityType(productId);
  const caCents = caForPeriodCents(productId, `${year}-01-01`, `${year + 1}-01-01`);
  const plafondCents = PLAFOND_CENTS[activityType];
  const tvaThresholdCents = TVA_FRANCHISE_CENTS[activityType];
  const plafondPct = Math.round((caCents / plafondCents) * 100);
  const tvaPct = Math.round((caCents / tvaThresholdCents) * 100);
  return {
    year,
    activityType,
    declarationPeriod: getDeclarationPeriod(productId),
    caCents,
    plafondCents,
    plafondPct,
    tvaThresholdCents,
    tvaPct,
    approachingPlafond: plafondPct >= ALERT_PLAFOND_PCT,
    tvaExceeded: caCents >= tvaThresholdCents,
  };
}

export interface UrssafDeclaration {
  periodLabel: string;
  from: string;
  to: string;
  caCents: number;
  cotisationsRateBps: number;
  cotisationsCents: number;
  isEstimate: true;
}

/** Declaration for the period that just closed before `today`. */
export function urssafDeclaration(
  productId: string = DEFAULT_PRODUCT_ID,
  today: string = getTodayDateParis(),
): UrssafDeclaration {
  const activityType = getActivityType(productId);
  const period = getDeclarationPeriod(productId);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)); // 1-12

  let from: string;
  let to: string;
  let periodLabel: string;
  if (period === 'quarterly') {
    // Previous quarter relative to current month.
    const currentQuarter = Math.floor((month - 1) / 3); // 0-3
    const prevQuarter = currentQuarter - 1;
    const qYear = prevQuarter < 0 ? year - 1 : year;
    const q = ((prevQuarter % 4) + 4) % 4; // 0-3
    const startMonth = q * 3 + 1;
    from = `${qYear}-${String(startMonth).padStart(2, '0')}-01`;
    to = q === 3 ? `${qYear + 1}-01-01` : `${qYear}-${String(startMonth + 3).padStart(2, '0')}-01`;
    periodLabel = `T${q + 1} ${qYear}`;
  } else {
    const prevMonth = month - 1 < 1 ? 12 : month - 1;
    const mYear = month - 1 < 1 ? year - 1 : year;
    from = `${mYear}-${String(prevMonth).padStart(2, '0')}-01`;
    to = prevMonth === 12 ? `${mYear + 1}-01-01` : `${mYear}-${String(prevMonth + 1).padStart(2, '0')}-01`;
    periodLabel = `${String(prevMonth).padStart(2, '0')}/${mYear}`;
  }

  const caCents = caForPeriodCents(productId, from, to);
  const rate = COTISATION_BPS[activityType];
  return {
    periodLabel,
    from,
    to,
    caCents,
    cotisationsRateBps: rate,
    cotisationsCents: Math.round((caCents * rate) / 10_000),
    isEstimate: true,
  };
}

// --- French renderers (estimates, for the brief / notifications) ---

const euros = (cents: number): string => `${(cents / 100).toFixed(2)} €`;

export function renderSeuilsAlert(s: ComptaStatus): string | null {
  if (!s.approachingPlafond && !s.tvaExceeded) return null;
  const lines: string[] = [`📊 **SEUILS ${s.year} — ATTENTION**`, ''];
  lines.push(`• CA encaissé : ${euros(s.caCents)} (${s.plafondPct}% du plafond ${euros(s.plafondCents)}).`);
  if (s.approachingPlafond) {
    lines.push(`• ⚠️ Vous approchez du plafond micro-entreprise.`);
  }
  if (s.tvaExceeded) {
    lines.push(`• ⚠️ Seuil de franchise TVA (${euros(s.tvaThresholdCents)}) dépassé : TVA potentiellement applicable.`);
  }
  lines.push('', '_Estimations indicatives — vérifiez auprès de l\'URSSAF / votre comptable._');
  return lines.join('\n');
}

export function renderUrssafReminder(d: UrssafDeclaration): string {
  return [
    `🧾 **DÉCLARATION URSSAF — ${d.periodLabel}**`,
    '',
    `• CA à déclarer (encaissé ${d.from} → ${d.to}) : ${euros(d.caCents)}.`,
    `• Cotisations estimées (${(d.cotisationsRateBps / 100).toFixed(1)}%) : ${euros(d.cotisationsCents)}.`,
    '',
    '_Estimation. Solopilot prépare le rappel ; la télédéclaration reste à faire sur autoentrepreneur.urssaf.fr._',
  ].join('\n');
}
