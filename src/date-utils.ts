const parisDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const parisDateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export function getTodayDateParis(): string {
  return formatParisDate(new Date());
}

export function parisDateOf(epochMs: number): string {
  return formatParisDate(new Date(epochMs));
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatParisDate(date: Date): string {
  const parts = parisDateFormatter.formatToParts(date);
  const year = parts.find((p) => p.type === 'year')!.value;
  const month = parts.find((p) => p.type === 'month')!.value;
  const day = parts.find((p) => p.type === 'day')!.value;
  return `${year}-${month}-${day}`;
}

export function parisToUtc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const parts = parisDateTimeFormatter.formatToParts(new Date(asUtc));
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const parisDisplayedAsUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  const offset = parisDisplayedAsUtc - asUtc;
  return new Date(asUtc - offset);
}

function toSqliteDatetimeUtc(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`;
}

export function getParisMonthRangeUtc(year: number, month: number): { from: string; to: string } {
  const fromDate = parisToUtc(year, month, 1);
  const toMonth = month === 12 ? 1 : month + 1;
  const toYear = month === 12 ? year + 1 : year;
  const toDate = parisToUtc(toYear, toMonth, 1);
  return { from: toSqliteDatetimeUtc(fromDate), to: toSqliteDatetimeUtc(toDate) };
}

function parseSqliteUtc(utcDateTime: string): Date {
  return new Date(utcDateTime.replace(' ', 'T') + 'Z');
}

export function utcToParisYearMonth(utcDateTime: string): { year: number; month: number } {
  const parts = parisDateTimeFormatter.formatToParts(parseSqliteUtc(utcDateTime));
  return {
    year: Number(parts.find((p) => p.type === 'year')!.value),
    month: Number(parts.find((p) => p.type === 'month')!.value),
  };
}

export function utcToParisDate(utcDateTime: string): string {
  return formatParisDate(parseSqliteUtc(utcDateTime));
}
