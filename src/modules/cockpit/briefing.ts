/**
 * Cockpit briefing aggregation.
 *
 * Builds the single daily picture of the company-of-one by reading existing
 * stores read-only: the latest veille digest and pending items, hot acquisition
 * leads, and workflow health. Modules not yet built (facturation, compta,
 * agenda) report a `planned` status so the cockpit shows the full roadmap
 * without faking data. See ADR-0015.
 */
import { getLastRun } from '../../run-service.js';
import { getUnpublishedTweets } from '../../tweet-store.js';
import { listIntentSignals } from '../../intent-service.js';
import { listWorkflowRuns } from '../../workflow/run-store.js';
import { facturationSummary } from '../facturation/store.js';
import { comptaStatus } from '../comptabilite/compta.js';
import { getTodayDateParis } from '../../date-utils.js';
import { DEFAULT_PRODUCT_ID } from '../../db.js';

export type ModuleStatus = 'live' | 'planned';

export interface Briefing {
  activityId: string;
  date: string;
  generatedAt: string;
  veille: {
    status: ModuleStatus;
    lastDigestAt: string | null;
    lastDigestStatus: string | null;
    summary: string | null;
    pendingItems: number;
  };
  acquisition: { status: ModuleStatus; newLeads: number };
  facturation: {
    status: ModuleStatus;
    unpaid: number;
    overdue: number;
    overdueAmountCents: number;
  };
  compta: {
    status: ModuleStatus;
    caCents: number;
    plafondPct: number;
    approachingPlafond: boolean;
    tvaExceeded: boolean;
  };
  agenda: { status: ModuleStatus };
  workflows: { total: number; byStatus: Record<string, number> };
}

export function buildBriefing(activityId: string = DEFAULT_PRODUCT_ID): Briefing {
  const lastRun = getLastRun(activityId);
  const pendingItems = getUnpublishedTweets(activityId).length;
  const newLeads = listIntentSignals({ productId: activityId, status: 'new', limit: 500 }).length;

  const recentRuns = listWorkflowRuns(50, 0, { activityId });
  const byStatus: Record<string, number> = {};
  for (const run of recentRuns) {
    byStatus[run.status] = (byStatus[run.status] ?? 0) + 1;
  }

  const facturation = facturationSummary(activityId);
  const compta = comptaStatus(activityId);

  return {
    activityId,
    date: getTodayDateParis(),
    generatedAt: new Date().toISOString(),
    veille: {
      status: 'live',
      lastDigestAt: lastRun?.started_at ?? null,
      lastDigestStatus: lastRun?.status ?? null,
      summary: lastRun?.summary ?? null,
      pendingItems,
    },
    acquisition: { status: 'live', newLeads },
    facturation: {
      status: 'live',
      unpaid: facturation.unpaid,
      overdue: facturation.overdue,
      overdueAmountCents: facturation.overdueAmountCents,
    },
    compta: {
      status: 'live',
      caCents: compta.caCents,
      plafondPct: compta.plafondPct,
      approachingPlafond: compta.approachingPlafond,
      tvaExceeded: compta.tvaExceeded,
    },
    agenda: { status: 'planned' },
    workflows: { total: recentRuns.length, byStatus },
  };
}

/**
 * Deterministic French markdown rendering of the briefing — no AI call, so the
 * daily brief is cheap and reproducible. An AI-composed variant can land later
 * behind a separate step.
 */
export function renderBriefingText(b: Briefing): string {
  const lines: string[] = [`📋 **BRIEF DU JOUR — ${b.date}**`, ''];

  lines.push('**VEILLE**');
  if (b.veille.summary) {
    const excerpt =
      b.veille.summary.length > 600 ? `${b.veille.summary.slice(0, 597)}...` : b.veille.summary;
    lines.push(excerpt);
  } else {
    lines.push('_Pas encore de digest disponible._');
  }
  if (b.veille.pendingItems > 0) {
    lines.push(`• ${b.veille.pendingItems} élément(s) en attente de résumé.`);
  }
  lines.push('');

  lines.push('**ACQUISITION**');
  lines.push(
    b.acquisition.newLeads > 0
      ? `• ${b.acquisition.newLeads} nouveau(x) signal(aux) d'intérêt à traiter.`
      : '_Aucun nouveau signal._',
  );
  lines.push('');

  lines.push('**FACTURATION**');
  if (b.facturation.overdue > 0) {
    const amount = `${(b.facturation.overdueAmountCents / 100).toFixed(2)} EUR`;
    lines.push(`• ${b.facturation.overdue} facture(s) impayée(s) en retard (${amount}) à relancer.`);
  } else if (b.facturation.unpaid > 0) {
    lines.push(`• ${b.facturation.unpaid} facture(s) en attente de paiement (aucun retard).`);
  } else {
    lines.push('_Aucune facture en attente._');
  }
  lines.push('');

  lines.push('**COMPTABILITÉ**');
  const ca = `${(b.compta.caCents / 100).toFixed(2)} €`;
  if (b.compta.approachingPlafond || b.compta.tvaExceeded) {
    lines.push(`• ⚠️ CA ${ca} — ${b.compta.plafondPct}% du plafond micro${b.compta.tvaExceeded ? ', seuil TVA dépassé' : ''}.`);
  } else {
    lines.push(`• CA encaissé cette année : ${ca} (${b.compta.plafondPct}% du plafond).`);
  }
  lines.push('');

  lines.push('**À VENIR**');
  lines.push('• L\'Agenda (Google Calendar) arrive dans le prochain module.');

  return lines.join('\n');
}
