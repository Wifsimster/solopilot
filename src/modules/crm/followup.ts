/**
 * Deterministic French follow-up drafting for stale deals.
 *
 * Staged for validation, never sent. No AI call. An AI-composed variant can
 * land later behind `ai.compose`. See ADR-0018.
 */
import type { StaleDeal } from './store.js';

export interface FollowupDraft {
  dealId: string;
  contactName: string;
  title: string;
  daysStale: number;
  message: string;
}

export function draftFollowup(deal: StaleDeal): FollowupDraft {
  const message = [
    `Bonjour ${deal.contact_name},`,
    '',
    `Je reviens vers vous au sujet de « ${deal.title} ». Où en êtes-vous dans votre réflexion ? ` +
      `Je reste disponible pour en discuter ou répondre à vos questions.`,
    '',
    'Bien cordialement,',
  ].join('\n');
  return {
    dealId: deal.id,
    contactName: deal.contact_name,
    title: deal.title,
    daysStale: deal.days_stale,
    message,
  };
}

export function summarizeFollowups(drafts: FollowupDraft[]): string | null {
  if (drafts.length === 0) return null;
  const lines = drafts.map((d) => `• ${d.contactName} — « ${d.title} » (${d.daysStale} j sans contact)`);
  return [`🤝 **OPPORTUNITÉS À RELANCER (${drafts.length})**`, '', ...lines].join('\n');
}
