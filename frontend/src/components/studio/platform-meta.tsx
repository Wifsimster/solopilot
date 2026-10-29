import { Hash, MessageCircle, Globe, Camera } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TargetSource } from '@/types';

export const PLATFORM_LIMITS: Record<TargetSource, number> = {
  x: 280,
  reddit: 500,
  generic: 500,
  instagram: 2200,
};

export interface SourceMeta {
  label: string;
  Icon: LucideIcon;
  dotClass: string;
  textClass: string;
  borderClass: string;
}

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
    dotClass: 'bg-platform-reddit',
    textClass: 'text-platform-reddit-icon',
    borderClass: 'border-l-platform-reddit',
  },
  generic: {
    label: 'Générique',
    Icon: Globe,
    dotClass: 'bg-platform-generic',
    textClass: 'text-platform-generic-icon',
    borderClass: 'border-l-platform-generic',
  },
  instagram: {
    label: 'Instagram',
    Icon: Camera,
    dotClass: 'bg-platform-instagram',
    textClass: 'text-platform-instagram-icon',
    borderClass: 'border-l-platform-instagram',
  },
};

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
