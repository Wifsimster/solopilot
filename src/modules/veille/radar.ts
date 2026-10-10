/**
 * Radar produit — pure helpers (ADR-0026).
 *
 * Settings resolution, untrusted-text sanitising and issue-body rendering. No
 * DB, no network: everything here is deterministic and unit-tested directly.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const RADAR_SETTING_KEYS = [
  'RADAR_ENABLED',
  'RADAR_DRY_RUN',
  'RADAR_SCORE_THRESHOLD',
  'RADAR_MAX_PER_PRODUCT_PER_DAY',
  'RADAR_MAX_PER_DAY',
] as const;
export type RadarSettingKey = (typeof RADAR_SETTING_KEYS)[number];
export type RadarSettingsLayer = Partial<Record<RadarSettingKey, string | undefined>>;

export interface RadarSettings {
  enabled: boolean;
  dryRun: boolean;
  scoreThreshold: number;
  maxPerProductPerDay: number;
  maxPerDay: number;
  /** Reasons for ignored values (never contain secrets). */
  warnings: string[];
}

export const RADAR_DEFAULTS = {
  enabled: false,
  dryRun: true,
  scoreThreshold: 0.8,
  maxPerProductPerDay: 1,
  maxPerDay: 3,
} as const;

// String-in schemas (settings are stored as strings). Explicit regexes instead
// of z.coerce so an empty string can never silently become 0.
const boolSchema = z
  .string()
  .trim()
  .pipe(z.enum(['true', 'false', '1', '0']))
  .transform((v) => v === 'true' || v === '1');
const thresholdSchema = z
  .string()
  .trim()
  .regex(/^(0(\.\d+)?|1(\.0+)?|\.\d+)$/)
  .transform(Number);
const capSchema = z
  .string()
  .trim()
  .regex(/^\d{1,2}$/)
  .transform(Number)
  .refine((n) => n <= 50);

/** Validators shared with the settings API so the UI gets the same rules. */
export const RADAR_SETTING_VALIDATORS: Record<RadarSettingKey, z.ZodType<unknown, z.ZodTypeDef, string>> = {
  RADAR_ENABLED: boolSchema,
  RADAR_DRY_RUN: boolSchema,
  RADAR_SCORE_THRESHOLD: thresholdSchema,
  RADAR_MAX_PER_PRODUCT_PER_DAY: capSchema,
  RADAR_MAX_PER_DAY: capSchema,
};

export function isRadarSettingKey(key: string): key is RadarSettingKey {
  return (RADAR_SETTING_KEYS as readonly string[]).includes(key);
}

function pick<T>(
  key: RadarSettingKey,
  env: RadarSettingsLayer,
  settings: RadarSettingsLayer,
  fallback: T,
  warnings: string[],
): T {
  // DB setting first (overrides env), then env; invalid values fall through.
  for (const [layer, source] of [
    [settings, 'settings'],
    [env, 'env'],
  ] as const) {
    const raw = layer[key]?.trim();
    if (!raw) continue;
    const parsed = RADAR_SETTING_VALIDATORS[key].safeParse(raw);
    if (parsed.success) return parsed.data as T;
    warnings.push(`${key} invalide (${source}) — valeur ignoree`);
  }
  return fallback;
}

/** Effective radar settings. Never throws: a typo degrades to the safe default. */
export function resolveRadarSettings(
  env: RadarSettingsLayer,
  settings: RadarSettingsLayer,
): RadarSettings {
  const warnings: string[] = [];
  return {
    enabled: pick('RADAR_ENABLED', env, settings, RADAR_DEFAULTS.enabled, warnings),
    dryRun: pick('RADAR_DRY_RUN', env, settings, RADAR_DEFAULTS.dryRun, warnings),
    scoreThreshold: pick(
      'RADAR_SCORE_THRESHOLD',
      env,
      settings,
      RADAR_DEFAULTS.scoreThreshold,
      warnings,
    ),
    maxPerProductPerDay: pick(
      'RADAR_MAX_PER_PRODUCT_PER_DAY',
      env,
      settings,
      RADAR_DEFAULTS.maxPerProductPerDay,
      warnings,
    ),
    maxPerDay: pick('RADAR_MAX_PER_DAY', env, settings, RADAR_DEFAULTS.maxPerDay, warnings),
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Selection: threshold + caps (pure)
// ---------------------------------------------------------------------------

export interface RadarMatch {
  itemId: string;
  productId: string;
  score: number;
  reason: string;
}

/** Pairs at or above the threshold, best first. */
export function selectMatches(matches: RadarMatch[], threshold: number): RadarMatch[] {
  return matches.filter((m) => m.score >= threshold).toSorted((a, b) => b.score - a.score);
}

export interface CapState {
  perProduct: Map<string, number>;
  total: number;
}

/** Whether one more proposal for `productId` fits today's caps. */
export function withinCaps(
  state: CapState,
  productId: string,
  caps: { maxPerProductPerDay: number; maxPerDay: number },
): boolean {
  if (state.total >= caps.maxPerDay) return false;
  return (state.perProduct.get(productId) ?? 0) < caps.maxPerProductPerDay;
}

export function consumeCap(state: CapState, productId: string): void {
  state.total += 1;
  state.perProduct.set(productId, (state.perProduct.get(productId) ?? 0) + 1);
}

// ---------------------------------------------------------------------------
// Sanitising untrusted text (model output derived from public news)
// ---------------------------------------------------------------------------

const ZWSP = '​';

/**
 * Makes a model/news string safe to embed in a GitHub issue body:
 * - no @mentions (user or team): `@` + zero-width space;
 * - no cross-references (`#12`, `owner/repo#12`, `GH-12`): zero-width space;
 * - no closing keywords bound to a reference or issue URL (`fixes #12`);
 * - no images, raw HTML or Markdown links (link text kept);
 * Idempotent.
 */
export function sanitizeUntrusted(text: string): string {
  return (
    text
      // Drop HTML comments and tags (tracking pixels, <details> injection...).
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<\/?[A-Za-z][^>]*>/g, '')
      // Images go entirely; links keep their text only.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      // Break closing keywords followed by a reference or an issue/PR URL.
      .replace(
        /\b(clos)(e[sd]?)\b(?=\s*:?\s+(?:[\w.-]+\/[\w.-]+)?#\d|\s*:?\s+https?:\/\/\S+\/(?:issues|pull)\/\d)/gi,
        `$1${ZWSP}$2`,
      )
      .replace(
        /\b(fi)(x(?:e[sd])?)\b(?=\s*:?\s+(?:[\w.-]+\/[\w.-]+)?#\d|\s*:?\s+https?:\/\/\S+\/(?:issues|pull)\/\d)/gi,
        `$1${ZWSP}$2`,
      )
      .replace(
        /\b(resol)(ve[sd]?)\b(?=\s*:?\s+(?:[\w.-]+\/[\w.-]+)?#\d|\s*:?\s+https?:\/\/\S+\/(?:issues|pull)\/\d)/gi,
        `$1${ZWSP}$2`,
      )
      // References: #12, owner/repo#12, GH-12.
      .replace(/#(?=\d)/g, `#${ZWSP}`)
      .replace(/\bGH-(?=\d)/gi, (m) => `${m}${ZWSP}`)
      // Mentions: @user, @org/team.
      .replace(/@(?=[A-Za-z0-9])/g, `@${ZWSP}`)
  );
}

/** Single-line variant: sanitised, whitespace collapsed, bounded. */
export function sanitizeInline(text: string, max = 300): string {
  const flat = sanitizeUntrusted(text).replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Only http(s) URLs survive; anything else (javascript:, data:...) is dropped. */
export function safeSourceUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Report (model output contract) + rendering
// ---------------------------------------------------------------------------

export const radarIdeaSchema = z.object({
  titre: z.string().min(1).max(200),
  description: z.string().min(1).max(1500),
  pour: z.array(z.string().min(1).max(400)).min(1).max(5),
  contre: z.array(z.string().min(1).max(400)).min(1).max(5),
  effort: z.enum(['S', 'M', 'L']),
  impact: z.string().min(1).max(400),
});

export const radarReportSchema = z.object({
  titre: z.string().min(1).max(200),
  resume: z.string().min(1).max(2000),
  pertinence: z.string().min(1).max(2000),
  idees: z.array(radarIdeaSchema).min(1).max(4),
  recommandation: z.string().min(1).max(1500),
});

export type RadarReport = z.infer<typeof radarReportSchema>;

export const SOURCE_LABELS: Record<string, string> = {
  x: 'X (Twitter)',
  reddit: 'Reddit',
  hn: 'Hacker News',
  youtube: 'YouTube',
};

export interface RadarSourceItem {
  source: string;
  author: string;
  url: string;
  created_at: string;
}

const TITLE_MAX = 120;
const BODY_MAX = 20_000;

export function renderIssueTitle(report: RadarReport): string {
  const short = sanitizeInline(report.titre, TITLE_MAX - 'Veille : '.length);
  return `Veille : ${short}`;
}

function bullets(lines: string[]): string {
  return lines.map((l) => `  - ${sanitizeInline(l, 400)}`).join('\n');
}

/**
 * Renders the French marketing report. The source block comes from the DB
 * (trusted shape), every model string goes through sanitizeUntrusted.
 */
export function renderIssueBody(input: {
  report: RadarReport;
  item: RadarSourceItem;
  productName: string;
  score: number;
}): string {
  const { report, item, productName, score } = input;
  const platform = SOURCE_LABELS[item.source] ?? sanitizeInline(item.source, 40);
  const author = item.author ? sanitizeInline(item.author, 80) : 'inconnu';
  const url = safeSourceUrl(item.url);
  const product = sanitizeInline(productName, 120);

  const ideas = report.idees
    .map((idea, i) =>
      [
        `### ${i + 1}. ${sanitizeInline(idea.titre, 200)}`,
        '',
        sanitizeUntrusted(idea.description).trim(),
        '',
        `- **Pour :**\n${bullets(idea.pour)}`,
        `- **Contre :**\n${bullets(idea.contre)}`,
        `- **Effort estimé :** ${idea.effort}`,
        `- **Impact attendu :** ${sanitizeInline(idea.impact, 400)}`,
      ].join('\n'),
    )
    .join('\n\n');

  const body = [
    '## Source',
    '',
    `- **Plateforme :** ${platform}`,
    `- **Auteur :** ${author}`,
    `- **Date :** ${sanitizeInline(item.created_at, 40)}`,
    ...(url ? [`- **Lien :** ${url}`] : []),
    '',
    "## Résumé de l'actualité",
    '',
    sanitizeUntrusted(report.resume).trim(),
    '',
    `## Pourquoi c'est pertinent pour ${product}`,
    '',
    sanitizeUntrusted(report.pertinence).trim(),
    '',
    '## Idées à reprendre / utiliser',
    '',
    ideas,
    '',
    '## Recommandation',
    '',
    sanitizeUntrusted(report.recommandation).trim(),
    '',
    '---',
    `_Proposition générée par Solopilot (Radar produit, pertinence ${score.toFixed(2)}). À valider : rien n'a été modifié dans le code._`,
  ].join('\n');

  return body.length > BODY_MAX ? `${body.slice(0, BODY_MAX - 1)}…` : body;
}
