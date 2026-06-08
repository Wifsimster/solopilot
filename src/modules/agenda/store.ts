/**
 * Agenda store — local calendar events.
 *
 * Works standalone (manual events) and is the upsert target for the optional
 * ICS sync (matched on external_id). Scoped by product_id (activity). See
 * ADR-0019.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getDb, DEFAULT_PRODUCT_ID, type CalendarEventRecord } from '../../db.js';
import { getTodayDateParis } from '../../date-utils.js';
import type { CalendarEventData } from '../../workflow/types.js';

export const eventCreateSchema = z.object({
  title: z.string().min(1),
  starts_at: z.string().min(1),
  ends_at: z.string().optional(),
  location: z.string().optional(),
});
export type EventCreateInput = z.infer<typeof eventCreateSchema>;

export function createEvent(
  productId: string = DEFAULT_PRODUCT_ID,
  input: EventCreateInput,
): CalendarEventRecord {
  const data = eventCreateSchema.parse(input);
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO calendar_events (id, product_id, external_id, title, starts_at, ends_at, location, source, created_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, 'manual', ?)`,
    )
    .run(id, productId, data.title, data.starts_at, data.ends_at ?? null, data.location ?? null, Date.now());
  return getDb().prepare('SELECT * FROM calendar_events WHERE id = ?').get(id) as CalendarEventRecord;
}

export function listUpcomingEvents(
  productId: string = DEFAULT_PRODUCT_ID,
  fromIso: string = new Date().toISOString(),
  limit = 50,
): CalendarEventRecord[] {
  return getDb()
    .prepare(
      `SELECT * FROM calendar_events WHERE product_id = ? AND starts_at >= ? ORDER BY starts_at ASC LIMIT ?`,
    )
    .all(productId, fromIso, limit) as CalendarEventRecord[];
}

export function listEventsForDay(
  productId: string = DEFAULT_PRODUCT_ID,
  day: string = getTodayDateParis(),
): CalendarEventRecord[] {
  return getDb()
    .prepare(
      `SELECT * FROM calendar_events WHERE product_id = ? AND substr(starts_at, 1, 10) = ? ORDER BY starts_at ASC`,
    )
    .all(productId, day) as CalendarEventRecord[];
}

/** Idempotent upsert from a calendar feed (matched on external_id). Returns rows written. */
export function upsertCalendarEvents(productId: string, events: CalendarEventData[]): number {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO calendar_events (id, product_id, external_id, title, starts_at, ends_at, location, source, created_at)
     VALUES (@id, @product_id, @external_id, @title, @starts_at, @ends_at, @location, 'ics', @created_at)
     ON CONFLICT(product_id, external_id) DO UPDATE SET
       title = excluded.title, starts_at = excluded.starts_at,
       ends_at = excluded.ends_at, location = excluded.location`,
  );
  const tx = db.transaction((rows: CalendarEventData[]) => {
    for (const r of rows) {
      stmt.run({ ...r, id: randomUUID(), product_id: productId, created_at: Date.now() });
    }
    return rows.length;
  });
  return tx(events);
}

export interface AgendaSummary {
  todayCount: number;
  upcomingCount: number;
  nextTitle: string | null;
  nextStartsAt: string | null;
}

export function agendaSummary(productId: string = DEFAULT_PRODUCT_ID): AgendaSummary {
  const today = listEventsForDay(productId);
  const upcoming = listUpcomingEvents(productId);
  const next = upcoming[0];
  return {
    todayCount: today.length,
    upcomingCount: upcoming.length,
    nextTitle: next?.title ?? null,
    nextStartsAt: next?.starts_at ?? null,
  };
}
