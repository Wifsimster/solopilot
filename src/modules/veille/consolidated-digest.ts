import { DISCORD_LIMITS, sanitize, type DiscordEmbed, type DiscordMessage } from '../../adapters/discord-notifier.js';

export interface DigestItem {
  text: string;
  url?: string;
}

export interface DigestSection {
  productId: string;
  productName: string;
  items: DigestItem[];
}

export interface BuildConsolidatedDigestOptions {
  date: string;
}

export const NOTHING_NOTABLE = 'Rien de notable';
export const MAX_ITEMS_PER_SECTION = 3;
export const MAX_ITEM_CHARS = 400;

const COLOR_ITEMS = 0x1d9bf0;
const COLOR_EMPTY = 0x99aab5;
const ELLIPSIS = '…';

const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+(.+?)\s*$/;
const MD_LINK = /\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/;
const BARE_URL = /https?:\/\/[^\s)>\]]+/;

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

export function moreItemsMarker(dropped: number): string {
  return `+${dropped} autres`;
}

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
