import { useEffect, useMemo } from 'react';
import { ScheduleXCalendar, useCalendarApp } from '@schedule-x/react';
import {
  createViewMonthGrid,
  createViewWeek,
  createViewDay,
  createViewMonthAgenda,
} from '@schedule-x/calendar';
import { createEventsServicePlugin } from '@schedule-x/events-service';
import '@schedule-x/theme-default/dist/index.css';

export interface SxEvent {
  id: string;
  title: string;
  start: string;
  end: string;
}

/**
 * Schedule-X calendar wrapper — see ADR-0021. Schedule-X was chosen over
 * FullCalendar for its MIT licence and Tailwind-friendly theming. Remount this
 * component (via a `key`) to switch light/dark, which is set at creation time.
 */
export function AgendaCalendar({ events, isDark }: { events: SxEvent[]; isDark: boolean }) {
  const eventsService = useMemo(() => createEventsServicePlugin(), []);
  const monthAgenda = useMemo(() => createViewMonthAgenda(), []);

  const calendar = useCalendarApp({
    views: [createViewMonthGrid(), createViewWeek(), createViewDay(), monthAgenda],
    defaultView: monthAgenda.name,
    events,
    isDark,
    plugins: [eventsService],
    locale: 'fr-FR',
    firstDayOfWeek: 1,
  });

  useEffect(() => {
    eventsService.set(events);
  }, [events, eventsService]);

  return (
    <div className="sx-react-calendar-wrapper">
      <ScheduleXCalendar calendarApp={calendar} />
    </div>
  );
}
