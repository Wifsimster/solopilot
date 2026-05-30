import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const DAYS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/**
 * Convert a cron expression to a human-readable French string.
 * Supports standard 5-field cron: minute hour day-of-month month day-of-week
 */
export function humanizeCron(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;

  const [minute, hour, dayOfMonth, , dayOfWeek] = parts;

  const time = `${hour.padStart(2, '0')}h${minute.padStart(2, '0')}`;

  // Every minute
  if (minute === '*' && hour === '*') return 'Chaque minute';

  // Every hour at specific minute
  if (hour === '*' && minute !== '*') return `Toutes les heures à :${minute.padStart(2, '0')}`;

  // Daily at specific time
  if (dayOfMonth === '*' && dayOfWeek === '*') return `Tous les jours à ${time}`;

  // Specific day(s) of week
  if (dayOfMonth === '*' && dayOfWeek !== '*') {
    const dayNames = dayOfWeek.split(',').map((d) => {
      const n = parseInt(d, 10);
      return DAYS_FR[n] ?? d;
    });

    if (dayNames.length === 1) return `Chaque ${dayNames[0]} à ${time}`;
    return `Chaque ${dayNames.join(', ')} à ${time}`;
  }

  // Specific day of month
  if (dayOfMonth !== '*' && dayOfWeek === '*') {
    return `Le ${dayOfMonth} de chaque mois à ${time}`;
  }

  return cron;
}

/**
 * Compute a rough next-run Date from a 5-field cron expression.
 * Handles common patterns (every-hour, daily, weekly).
 * Returns null for complex expressions it cannot parse.
 */
export function nextCronDate(cron: string): Date | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [minuteStr, hourStr, dayOfMonthStr, , dayOfWeekStr] = parts;
  const now = new Date();

  // Every minute
  if (minuteStr === '*' && hourStr === '*') {
    return new Date(now.getTime() + 60_000);
  }

  const minute = minuteStr !== '*' ? parseInt(minuteStr, 10) : NaN;

  // Every hour at :MM
  if (hourStr === '*' && !isNaN(minute)) {
    const next = new Date(now);
    next.setSeconds(0, 0);
    next.setMinutes(minute);
    if (next <= now) next.setHours(next.getHours() + 1);
    return next;
  }

  if (isNaN(minute)) return null;
  const hour = parseInt(hourStr, 10);
  if (isNaN(hour)) return null;

  // Daily at HH:MM
  if (dayOfMonthStr === '*' && dayOfWeekStr === '*') {
    const next = new Date(now);
    next.setSeconds(0, 0);
    next.setHours(hour, minute);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next;
  }

  // Weekly on specific day(s)
  if (dayOfMonthStr === '*' && dayOfWeekStr !== '*') {
    const days = new Set(
      dayOfWeekStr
        .split(',')
        .map((d) => parseInt(d, 10))
        .filter((d) => !isNaN(d)),
    );
    if (days.size === 0) return null;

    for (let offset = 0; offset <= 7; offset++) {
      const candidate = new Date(now);
      candidate.setDate(candidate.getDate() + offset);
      candidate.setHours(hour, minute, 0, 0);
      if (candidate > now && days.has(candidate.getDay())) {
        return candidate;
      }
    }
  }

  return null;
}

/**
 * Format a date string (ISO or any parseable format) as a French localized string.
 * Example: "18 mars 2026 à 14h30"
 */
export function formatDateFr(dateStr: string | null | undefined): string {
  if (!dateStr) return '\u2014';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  });
}

/**
 * Format a past timestamp (epoch seconds or millis) as a relative French label.
 * Falls back to a localized date for anything older than a week.
 */
export function formatRelativeFr(epoch: number | null | undefined): string {
  if (!epoch) return '—';
  const ms = epoch > 1e12 ? epoch : epoch * 1000;
  const diffSec = Math.floor((Date.now() - ms) / 1000);
  if (diffSec < 60) return 'à l’instant';
  const minutes = Math.floor(diffSec / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `il y a ${days} j`;
  return new Date(ms).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Format a duration between now and a future date as a French relative string.
 */
export function formatTimeUntil(target: Date): string {
  const diffMs = target.getTime() - Date.now();
  if (diffMs <= 0) return 'imminent';

  const minutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(minutes / 60);

  if (minutes < 1) return "moins d'une minute";
  if (minutes < 60) return `${minutes} min`;
  if (hours < 24) {
    const remainingMin = minutes % 60;
    return remainingMin > 0 ? `${hours}h${String(remainingMin).padStart(2, '0')}` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return `${days}j ${hours % 24}h`;
}
