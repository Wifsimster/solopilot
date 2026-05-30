import { useImperativeHandle, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import { Badge } from '@/components/ui/badge';
import { X as XIcon } from 'lucide-react';

/**
 * Result of parsing/validating a raw input string for a chip field. When valid,
 * `tokens` holds the normalized values to merge into the committed list; when
 * invalid, `error` holds the user-facing (French) message.
 */
export type ChipParseResult = { ok: true; tokens: string[] } | { ok: false; error: string };

export interface ChipInputHandle {
  /**
   * Flush any pending text in the input into the committed list. Mirrors the
   * blur behavior so a parent can force-commit before submitting a form.
   * Returns the resulting array on success (after dedup + cap), or `null` when
   * the pending text is invalid (an error message is shown inline).
   */
  flush: () => string[] | null;
}

interface ChipInputProps {
  /** Committed chip values owned by the parent. */
  value: string[];
  /** Called with the next committed array whenever it changes. */
  onChange: (next: string[]) => void;
  /**
   * Parse + validate a raw input string into normalized tokens. Pure: it must
   * not depend on the current committed list (capping/dedup happen here).
   */
  parse: (raw: string) => ChipParseResult;
  /** Maximum number of committed values (used for dedup-aware capping). */
  max: number;
  /** Message shown when the cap is exceeded while committing. */
  maxError: string;
  id: string;
  ariaLabel: string;
  removeLabel: (chip: string) => string;
  placeholder: string;
  disabled?: boolean;
  /** React 19 ref-as-prop exposing the imperative flush handle. */
  ref?: Ref<ChipInputHandle>;
}

/**
 * A reusable chip/tag input. Owns its transient `input` + `error` state so the
 * parent only deals with the committed `value: string[]`. Adding chips merges
 * deduped tokens (case-insensitive) into `value`, capping at `max`; Backspace
 * on an empty input removes the last chip.
 */
export function ChipInput({
  value,
  onChange,
  parse,
  max,
  maxError,
  id,
  ariaLabel,
  removeLabel,
  placeholder,
  disabled,
  ref,
}: ChipInputProps) {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Keep the latest committed value reachable from the imperative flush
  // without stale closures.
  const valueRef = useRef(value);
  valueRef.current = value;

  const commit = (raw: string): string[] | null => {
    const result = parse(raw);
    if (!result.ok) {
      setError(result.error);
      return null;
    }
    const next = [...valueRef.current];
    let capped = false;
    for (const t of result.tokens) {
      if (next.length >= max) {
        capped = true;
        break;
      }
      if (!next.some((k) => k.toLowerCase() === t.toLowerCase())) {
        next.push(t);
      }
    }
    setError(capped ? maxError : null);
    onChange(next);
    return next;
  };

  useImperativeHandle(ref, () => ({
    flush: () => {
      if (input.trim()) {
        const next = commit(input);
        if (next === null) return null;
        setInput('');
        return next;
      }
      return valueRef.current;
    },
  }));

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      if (input.trim()) {
        e.preventDefault();
        if (commit(input) !== null) {
          setInput('');
        }
      }
    } else if (e.key === 'Backspace' && !input && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  const commitPendingOnBlur = () => {
    if (input.trim()) {
      if (commit(input) !== null) {
        setInput('');
      }
    }
  };

  const remove = (chip: string) => {
    onChange(value.filter((c) => c !== chip));
    setError(null);
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 min-h-9 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background">
        {value.map((chip) => (
          <Badge key={chip} variant="secondary" className="gap-1 pl-2 pr-1">
            {chip}
            <button
              type="button"
              onClick={() => remove(chip)}
              disabled={disabled}
              className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20"
              aria-label={removeLabel(chip)}
            >
              <XIcon className="size-3" />
            </button>
          </Badge>
        ))}
        <input
          id={id}
          type="text"
          aria-label={ariaLabel}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={handleKeyDown}
          onBlur={commitPendingOnBlur}
          placeholder={value.length === 0 ? placeholder : ''}
          disabled={disabled}
          className="flex-1 min-w-[120px] bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        />
      </div>
      {error && (
        <p className="mt-1 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
