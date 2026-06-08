/**
 * Comptabilité steps.
 *
 * `compta.seuils` — checks micro-entreprise plafond and TVA-franchise thresholds,
 * emitting an alert only when approaching/exceeded (otherwise a quiet no-op).
 * `compta.echeance` — prepares the URSSAF declaration reminder for the period
 * that just closed. Both produce estimates only; nothing is filed. See ADR-0017.
 */
import {
  comptaStatus,
  urssafDeclaration,
  renderSeuilsAlert,
  renderUrssafReminder,
  type ComptaStatus,
  type UrssafDeclaration,
} from '../modules/comptabilite/compta.js';
import { getTodayDateParis } from '../date-utils.js';
import type { Step } from '../workflow/types.js';

export interface SeuilsOutput {
  status: ComptaStatus;
  alert: boolean;
  content: string | null;
}

export const comptaSeuilsStep: Step<SeuilsOutput> = {
  use: 'compta.seuils',
  run: async (ctx) => {
    const status = comptaStatus(ctx.activityId, getTodayDateParis());
    const content = renderSeuilsAlert(status);
    ctx.log.info('compta.seuils evaluated', {
      activity: ctx.activityId,
      plafondPct: status.plafondPct,
      alert: content !== null,
    });
    return { status, alert: content !== null, content };
  },
};

export interface EcheanceOutput {
  declaration: UrssafDeclaration;
  content: string;
}

export const comptaEcheanceStep: Step<EcheanceOutput> = {
  use: 'compta.echeance',
  run: async (ctx) => {
    const declaration = urssafDeclaration(ctx.activityId, getTodayDateParis());
    ctx.log.info('compta.echeance prepared', {
      activity: ctx.activityId,
      period: declaration.periodLabel,
    });
    return { declaration, content: renderUrssafReminder(declaration) };
  },
};
