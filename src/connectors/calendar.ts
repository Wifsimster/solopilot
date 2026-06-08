/**
 * Calendar connector (read-only, ICS feed).
 *
 * Optional: when AGENDA_ICS_URL is unset, `isConfigured()` is false and
 * `listUpcoming()` resolves to []. When set, it fetches an ICS feed (e.g. a
 * Google Calendar secret address) and parses VEVENTs — no OAuth, no dependency.
 * Read-only: Solopilot never writes back to the calendar. The sync step that
 * uses it is degradable, so a feed outage can never fail a run. See ADR-0019.
 */
import type { Config } from '../config.js';
import { logger } from '../logger.js';
import type { CalendarConnector, CalendarEventData } from '../workflow/types.js';

/** Unfold ICS lines (continuation lines begin with a space or tab). */
function unfold(ics: string): string[] {
  const out: string[] = [];
  for (const raw of ics.split(/\r?\n/)) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += raw.slice(1);
    } else {
      out.push(raw);
    }
  }
  return out;
}

function toIso(value: string): string {
  const v = value.trim();
  let m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
  m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return v;
}

export function parseIcs(ics: string): CalendarEventData[] {
  const events: CalendarEventData[] = [];
  let cur: Partial<CalendarEventData> | null = null;
  for (const line of unfold(ics)) {
    if (line.startsWith('BEGIN:VEVENT')) {
      cur = {};
      continue;
    }
    if (line.startsWith('END:VEVENT')) {
      if (cur && cur.title && cur.starts_at) {
        events.push({
          external_id: cur.external_id ?? `${cur.title}-${cur.starts_at}`,
          title: cur.title,
          starts_at: cur.starts_at,
          ends_at: cur.ends_at ?? null,
          location: cur.location ?? null,
        });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const name = line.slice(0, sep).split(';')[0].toUpperCase();
    const value = line.slice(sep + 1);
    if (name === 'UID') cur.external_id = value.trim();
    else if (name === 'SUMMARY') cur.title = value.trim();
    else if (name === 'LOCATION') cur.location = value.trim();
    else if (name === 'DTSTART') cur.starts_at = toIso(value);
    else if (name === 'DTEND') cur.ends_at = toIso(value);
  }
  return events;
}

export function createCalendarConnector(config: Config): CalendarConnector {
  const url = config.AGENDA_ICS_URL;
  return {
    isConfigured: () => !!url,
    listUpcoming: async () => {
      if (!url) return [];
      const res = await fetch(url);
      if (!res.ok) throw new Error(`ICS feed error ${res.status}`);
      const ics = await res.text();
      const now = Date.now();
      const horizon = now + 60 * 86_400_000;
      const events = parseIcs(ics).filter((e) => {
        const t = Date.parse(e.starts_at);
        return Number.isNaN(t) || (t >= now - 86_400_000 && t <= horizon);
      });
      logger.info('Calendar ICS fetched', { count: events.length });
      return events;
    },
  };
}
