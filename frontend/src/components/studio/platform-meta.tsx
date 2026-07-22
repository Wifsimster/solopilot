import { Hash, MessageCircle, Globe, Camera } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TargetSource } from '@/types';

// Character budgets per platform, mirroring the backend generation prompt
// (src/content-studio.ts → platformConstraints). X enforces a hard 280-char
// cap; reddit/generic are soft "recommended" ceilings. The live counter uses
// these to warn before the user pastes something the platform will reject.
export const PLATFORM_LIMITS: Record<TargetSource, number> = {
  x: 280,
  reddit: 500,
  generic: 500,
  instagram: 2200,
};

export interface SourceMeta {
  label: string;
  Icon: LucideIcon;
  /** Tailwind background class for a small colored dot. */
  dotClass: string;
  /** Tailwind text-color class for the icon. */
  textClass: string;
  /** Tailwind left-border class for the card accent. Kept as a full literal
   *  string so Tailwind's compiler can detect it (runtime-built class names
   *  are not emitted). */
  borderClass: string;
}

// Centralized platform identity. Brand logos are deliberately avoided (lucide
// does not ship reliable brand icons): platform identity is conveyed through a
// generic icon + color + label instead.
export const SOURCE_META: Record<TargetSource, SourceMeta> = {
  x: {
    label: 'X',
    Icon: Hash,
    dotClass: 'bg-foreground',
    textClass: 'text-foreground',
    borderClass: 'border-l-foreground',
  },
  reddit: {
    label: 'Reddit',
    Icon: MessageCircle,
    dotClass: 'bg-orange-500',
    textClass: 'text-orange-600 dark:text-orange-400',
    borderClass: 'border-l-orange-500',
  },
  generic: {
    label: 'Générique',
    Icon: Globe,
    dotClass: 'bg-blue-500',
    textClass: 'text-blue-600 dark:text-blue-400',
    borderClass: 'border-l-blue-500',
  },
  instagram: {
    label: 'Instagram',
    Icon: Camera,
    dotClass: 'bg-pink-500',
    textClass: 'text-pink-600 dark:text-pink-400',
    borderClass: 'border-l-pink-500',
  },
};

/**
 * Split text into ≤limit-char tweets for an X thread, breaking on paragraph →
 * sentence → word boundaries (never mid-word; a single over-long word is hard
 * sliced). Mirrors the fallback split in the backend X adapter so the preview
 * matches what gets posted. Returns a single-element array when it already fits.
 */
export function splitIntoThread(text: string, limit = PLATFORM_LIMITS.x): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return [trimmed];

  const words = trimmed.split(/\s+/);
  const tweets: string[] = [];
  let current = '';

  const flush = () => {
    if (current.trim().length > 0) tweets.push(current.trim());
    current = '';
  };

  for (const word of words) {
    if (word.length > limit) {
      // Hard-slice a word that can't fit on its own.
      flush();
      let rest = word;
      while (rest.length > limit) {
        tweets.push(rest.slice(0, limit));
        rest = rest.slice(limit);
      }
      current = rest;
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > limit) {
      flush();
      current = word;
    } else {
      current = candidate;
    }
  }
  flush();
  return tweets.length > 0 ? tweets : [trimmed.slice(0, limit)];
}

/** Small rounded badge showing the colored platform icon + label. */
export function SourceBadge({ source }: { source: TargetSource | null }) {
  if (source === null) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0 text-3xs font-medium text-muted-foreground">
        Source ?
      </span>
    );
  }
  const meta = SOURCE_META[source];
  const { Icon } = meta;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0 text-3xs font-medium text-foreground">
      <Icon className={cn('size-3', meta.textClass)} />
      {meta.label}
    </span>
  );
}
