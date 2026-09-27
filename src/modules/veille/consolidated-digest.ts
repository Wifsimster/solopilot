/**
 * Consolidated veille digest — pure builder.
 *
 * Turns one section per product (name + top items) into the FEWEST Discord
 * webhook messages that respect Discord's limits:
 *   - max 10 embeds per message
 *   - max 6,000 chars across all embeds of a message (title + description here)
 *   - max 256 chars per embed title, 4,096 per embed description
 *
 * One product = one embed, in input order. Messages are packed greedily
 * (next-fit): an embed goes into the current message unless it would break the
 * embed-count or total-chars limit, in which case a new message starts. For an
 * order-preserving split with additive limits, next-fit yields the minimum
 * number of messages. A section is never split across messages. One that alone
 * exceeds the description limit drops its lowest-ranked items (the tail — items
 * are in rank order) and ends with `+{n} autres` (ADR-0025 §4); text is
 * hard-truncated only as a last resort, when the top item alone is oversized.
 *
 * No I/O: safe to unit-test (see test/consolidated-digest.test.mjs).
 */
import { DISCORD_LIMITS, sanitize, type DiscordEmbed, type DiscordMessage } from '../../adapters/discord-notifier.js';

export interface DigestItem {
  /** Item text (Discord markdown allowed, e.g. `[titre](https://…)`). */
  text: string;
  /** Primary link; appended when not already present in `text`. */
  url?: string;
}

export interface DigestSection {
  productId: string;
  productName: string;
  /** Top items for the day; empty = "Rien de notable". */
  items: DigestItem[];
}

export interface BuildConsolidatedDigestOptions {
  /** Paris date of the digest, YYYY-MM-DD (shown in the header). */
  date: string;
}

export const NOTHING_NOTABLE = 'Rien de notable';
export const MAX_ITEMS_PER_SECTION = 3;
/** Per-item cap so one verbose bullet can't crowd out the others. */
export const MAX_ITEM_CHARS = 400;

const COLOR_ITEMS = 0x1d9bf0;
const COLOR_EMPTY = 0x99aab5;
const ELLIPSIS = '…';

// Bullet: "- x", "* x", "• x", "1. x", "1) x".
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+(.+?)\s*$/;
const MD_LINK = /\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/;
const BARE_URL = /https?:\/\/[^\s)>\]]+/;

/** Hard-truncate on a code-point boundary (never splits a surrogate pair). */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const chars = Array.from(text);
  let out = '';
  for (const ch of chars) {
    if (out.length + ch.length > max - ELLIPSIS.length) break;
    out += ch;
  }
  return out + ELLIPSIS;
}

/**
 * Extract the top items from a product's AI digest summary: bullet lines,
 * preferring those carrying a link (the AI is told to link every source), in
 * the order the digest lists them. Falls back to unlinked bullets, then to
 * nothing (the caller renders "Rien de notable").
 */
export function extractTopItems(
  summary: string | null | undefined,
  max: number = MAX_ITEMS_PER_SECTION,
): DigestItem[] {
  if (!summary) return [];
  const bullets: DigestItem[] = [];
  for (const line of summary.split(/\r?\n/)) {
    const m = BULLET.exec(line);
    if (!m) continue;
    const text = m[1].trim();
    // Skip bold-only pseudo bullets such as "- **REDDIT**".
    if (!text || /^\*\*[^*]+\*\*:?$/.test(text)) continue;
    const url = MD_LINK.exec(text)?.[1] ?? BARE_URL.exec(text)?.[0];
    bullets.push(url ? { text, url } : { text });
  }
  const linked = bullets.filter((b) => b.url);
  return (linked.length > 0 ? linked : bullets).slice(0, max);
}

function renderItem(item: DigestItem): string {
  const text = cut(sanitize(item.text.trim()), MAX_ITEM_CHARS);
  const url = item.url && !text.includes(item.url) ? ` — ${item.url}` : '';
  return `• ${text}${url}`;
}

/** Marker line ending a section whose lowest-ranked items were dropped. */
export function moreItemsMarker(dropped: number): string {
  return `+${dropped} autres`;
}

/**
 * Fit rank-ordered rendered lines into `max` chars: drop the lowest-ranked
 * lines first and end with `+{n} autres` (n = dropped lines). Only when the
 * top line alone cannot fit is its text hard-truncated (last resort).
 */
export function fitSectionLines(lines: string[], max: number): string {
  const full = lines.join('\n');
  if (full.length <= max) return full;
  for (let keep = lines.length - 1; keep >= 1; keep -= 1) {
    const candidate = [...lines.slice(0, keep), moreItemsMarker(lines.length - keep)].join('\n');
    if (candidate.length <= max) return candidate;
  }
  const marker = lines.length > 1 ? `\n${moreItemsMarker(lines.length - 1)}` : '';
  return cut(lines[0], max - marker.length) + marker;
}

function sectionEmbed(section: DigestSection): DiscordEmbed {
  const name = section.productName.trim() || section.productId;
  const items = section.items.slice(0, MAX_ITEMS_PER_SECTION);
  const description =
    items.length === 0
      ? NOTHING_NOTABLE
      : fitSectionLines(items.map(renderItem), DISCORD_LIMITS.embedDescription);
  return {
    title: cut(sanitize(name), DISCORD_LIMITS.embedTitle),
    description,
    color: items.length === 0 ? COLOR_EMPTY : COLOR_ITEMS,
  };
}

/** Chars counted by Discord towards the 6,000 per-message embed budget. */
export function embedLength(embed: DiscordEmbed): number {
  return (embed.title?.length ?? 0) + (embed.description?.length ?? 0) + (embed.footer?.text.length ?? 0);
}

function formatDateFr(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : date;
}

export function buildConsolidatedDigest(
  sections: DigestSection[],
  options: BuildConsolidatedDigestOptions,
): DiscordMessage[] {
  if (sections.length === 0) return [];

  const embeds = sections.map(sectionEmbed);
  const pages: DiscordEmbed[][] = [];
  let current: DiscordEmbed[] = [];
  let currentChars = 0;
  for (const embed of embeds) {
    const len = embedLength(embed);
    const full =
      current.length >= DISCORD_LIMITS.embedsPerMessage ||
      currentChars + len > DISCORD_LIMITS.totalEmbedChars;
    if (current.length > 0 && full) {
      pages.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(embed);
    currentChars += len;
  }
  pages.push(current);

  const header = `**📰 Veille quotidienne — ${formatDateFr(options.date)}**`;
  const noun = sections.length > 1 ? 'produits' : 'produit';
  return pages.map((page, i) => ({
    content:
      pages.length === 1
        ? `${header} · ${sections.length} ${noun}`
        : `${header} · ${sections.length} ${noun} (${i + 1}/${pages.length})`,
    embeds: page,
  }));
}
