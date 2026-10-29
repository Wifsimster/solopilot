import { useImperativeHandle, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import { Badge } from '@/components/ui/badge';
import { X as XIcon } from 'lucide-react';

export type ChipParseResult = { ok: true; tokens: string[] } | { ok: false; error: string };

export interface ChipInputHandle {
  flush: () => string[] | null;
}

interface ChipInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  parse: (raw: string) => ChipParseResult;
  max: number;
  maxError: string;
  id: string;
  ariaLabel: string;
  removeLabel: (chip: string) => string;
  placeholder: string;
  disabled?: boolean;
  ref?: Ref<ChipInputHandle>;
}

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
