// Display formatting for the « Dépenses IA » page. Amounts arrive at full
// precision; rounding happens here only.

const usd2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usdSmall = new Intl.NumberFormat('fr-FR', { maximumSignificantDigits: 2 });
const int = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });

/** `4,12 $`; sub-cent amounts keep two significant digits (`0,0042 $`). */
export function usd(value: number): string {
  const abs = Math.abs(value);
  if (abs > 0 && abs < 0.01) return `${usdSmall.format(value)}\u00a0$`;
  return `${usd2.format(value)}\u00a0$`;
}

const usdAxisSmall = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const usdAxis = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

/** Axis ticks (values come from `niceScale`, so they are already round). */
export function usdTick(value: number): string {
  if (value === 0) return '0\u00a0$';
  if (Math.abs(value) < 1) return `${usdAxisSmall.format(value)}\u00a0$`;
  if (Math.abs(value) < 1000) return `${usdAxis.format(value)}\u00a0$`;
  return `${compact.format(value)}\u00a0$`;
}

/** Round axis: 0 to a clean top, step in 1 / 2 / 2.5 / 5 x 10^k. */
export function niceScale(max: number, count = 4): { domain: [number, number]; ticks: number[] } {
  if (!(max > 0)) return { domain: [0, 1], ticks: [0, 1] };
  const raw = max / count;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= raw - 1e-12) ?? 10 * p;
  const top = Math.ceil(max / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let i = 0; i * step <= top + step / 2; i += 1) ticks.push(Number((i * step).toPrecision(12)));
  return { domain: [0, ticks[ticks.length - 1]], ticks };
}

export function pct(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined) return '—';
  const p = ratio * 100;
  if (p > 0 && p < 1) return '<\u00a01\u00a0%';
  return `${int.format(Math.round(p))}\u00a0%`;
}

export function num(value: number): string {
  return int.format(value);
}

export function tokensCompact(value: number): string {
  return compact.format(value);
}

const dayShort = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const dayLong = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});
const monthShort = new Intl.DateTimeFormat('fr-FR', { month: 'short', year: '2-digit', timeZone: 'UTC' });
const monthLong = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const parisTime = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Paris',
});

function bucketDate(bucket: string): Date {
  const [y, m, d] = bucket.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d || 1));
}

/** Axis label of a bucket: `3 oct.` (day) or `oct. 26` (month). */
export function bucketShort(bucket: string): string {
  return bucket.length === 7 ? monthShort.format(bucketDate(bucket)) : dayShort.format(bucketDate(bucket));
}

/** Tooltip / table label of a bucket. */
export function bucketLong(bucket: string): string {
  return bucket.length === 7 ? monthLong.format(bucketDate(bucket)) : dayLong.format(bucketDate(bucket));
}

/** Call timestamp in Paris time: `10/10 14:32`. */
export function parisDateTime(epochMs: number): string {
  return parisTime.format(new Date(epochMs));
}
