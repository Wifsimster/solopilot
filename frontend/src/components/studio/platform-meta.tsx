import { Hash, MessageCircle, Globe } from 'lucide-react';
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
};

/** Small rounded badge showing the colored platform icon + label. */
export function SourceBadge({ source }: { source: TargetSource | null }) {
  if (source === null) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0 text-[10px] font-medium text-muted-foreground">
        Source ?
      </span>
    );
  }
  const meta = SOURCE_META[source];
  const { Icon } = meta;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0 text-[10px] font-medium text-foreground">
      <Icon className={cn('size-3', meta.textClass)} />
      {meta.label}
    </span>
  );
}
