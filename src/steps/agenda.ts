/**
 * Agenda steps.
 *
 * `agenda.sync` — pulls events from the ICS feed into the local store. Degradable
 * and a no-op when no feed is configured.
 * `agenda.rappels` — builds today's reminder, emitting `content: null` (so
 * notify.discord skips) when the day is empty. See ADR-0019.
 */
import { upsertCalendarEvents, listEventsForDay } from '../modules/agenda/store.js';
import { getTodayDateParis } from '../date-utils.js';
import type { Step } from '../workflow/types.js';
import type { CalendarEventRecord } from '../db.js';

export interface AgendaSyncOutput {
  synced: number;
  skipped: boolean;
}

export const agendaSyncStep: Step<AgendaSyncOutput> = {
  use: 'agenda.sync',
  degradable: true,
  run: async (ctx) => {
    if (!ctx.connectors.calendar.isConfigured()) {
      ctx.log.info('agenda.sync skipped — no ICS feed configured', { activity: ctx.activityId });
      return { synced: 0, skipped: true };
    }
    const events = await ctx.connectors.calendar.listUpcoming();
    const synced = upsertCalendarEvents(ctx.activityId, events);
    ctx.log.info('agenda.sync complete', { activity: ctx.activityId, synced });
    return { synced, skipped: false };
  },
};

function formatTime(iso: string): string {
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[1]}h${m[2]}` : 'journée';
}

export function renderTodayReminder(events: CalendarEventRecord[]): string | null {
  if (events.length === 0) return null;
  const lines = events.map((e) => `• ${formatTime(e.starts_at)} — ${e.title}${e.location ? ` (${e.location})` : ''}`);
  return [`📅 **AGENDA DU JOUR (${events.length})**`, '', ...lines].join('\n');
}

export interface AgendaRappelsOutput {
  count: number;
  content: string | null;
}

export const agendaRappelsStep: Step<AgendaRappelsOutput> = {
  use: 'agenda.rappels',
  run: async (ctx) => {
    const events = listEventsForDay(ctx.activityId, getTodayDateParis());
    ctx.log.info('agenda.rappels — today events', { activity: ctx.activityId, count: events.length });
    return { count: events.length, content: renderTodayReminder(events) };
  },
};
