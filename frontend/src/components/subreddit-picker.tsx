import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { Badge } from '@/components/ui/badge';
import { Loader2, Search, X as XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SubredditSearchResult } from '@/types';

const SUBREDDIT_REGEX = /^[A-Za-z0-9_]{2,21}$/;

function formatSubscribers(count: number): string {
  if (!count || count < 0) return '0 membre';
  if (count >= 1_000_000) {
    const m = count / 1_000_000;
    return `${m >= 10 ? m.toFixed(0) : m.toFixed(1)}M membres`;
  }
  if (count >= 1_000) {
    const k = count / 1_000;
    return `${k >= 10 ? k.toFixed(0) : k.toFixed(1)}k membres`;
  }
  return `${count} membre${count > 1 ? 's' : ''}`;
}

export interface SubredditPickerHandle {
  /**
   * Flush any pending text into the committed list (mirrors blur behavior).
   * Returns the resulting array on success, or `null` when the pending text
   * holds invalid subreddit names (an inline error is shown).
   */
  flush: () => string[] | null;
}

interface SubredditPickerProps {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

/**
 * Subreddit chip picker with debounced async search (Reddit autocomplete) and
 * full ARIA combobox keyboard navigation. Owns all of its transient state
 * (input text, validation error, search results/loading/open/active index) so
 * the parent only deals with the committed `value: string[]`.
 */
export const SubredditPicker = forwardRef<SubredditPickerHandle, SubredditPickerProps>(
  function SubredditPicker({ value: subreddits, onChange, disabled }, ref) {
    const [input, setInput] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [results, setResults] = useState<SubredditSearchResult[]>([]);
    const [searchLoading, setSearchLoading] = useState(false);
    const [searchOpen, setSearchOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const searchAbortRef = useRef<AbortController | null>(null);
    const searchTimeoutRef = useRef<number | null>(null);
    const subredditsRef = useRef(subreddits);
    subredditsRef.current = subreddits;

    const tryAddSubreddits = (raw: string): boolean => {
      const tokens = raw
        .split(/[\s,]+/)
        .flatMap((t) => {
          const trimmed = t.trim().replace(/^\/?r\//i, '');
          return trimmed ? [trimmed] : [];
        });
      if (tokens.length === 0) return false;

      const invalid = tokens.filter((t) => !SUBREDDIT_REGEX.test(t));
      if (invalid.length > 0) {
        setError(
          `Subreddit invalide : ${invalid.join(', ')} (2-21 caractères, lettres, chiffres ou _).`,
        );
        return false;
      }

      const next = [...subredditsRef.current];
      for (const t of tokens) {
        if (!next.some((s) => s.toLowerCase() === t.toLowerCase())) {
          next.push(t);
        }
      }
      onChange(next);
      setError(null);
      return true;
    };

    // Debounced subreddit search, driven from the input's onChange handler so the
    // network request is an explicit consequence of typing rather than a reaction
    // to a state change in an effect.
    const runSubredditSearch = (rawValue: string) => {
      if (searchTimeoutRef.current !== null) {
        window.clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = null;
      }
      const query = rawValue.trim().replace(/^\/?r\//i, '');
      if (query.length < 2) {
        searchAbortRef.current?.abort();
        searchAbortRef.current = null;
        setResults([]);
        setSearchLoading(false);
        setActiveIndex(-1);
        return;
      }

      searchTimeoutRef.current = window.setTimeout(() => {
        searchAbortRef.current?.abort();
        const controller = new AbortController();
        searchAbortRef.current = controller;
        setSearchLoading(true);
        fetch(`/api/reddit/search-subreddits?q=${encodeURIComponent(query)}&limit=8`, {
          signal: controller.signal,
        })
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json() as Promise<{ results?: SubredditSearchResult[] }>;
          })
          .then((data) => {
            if (controller.signal.aborted) return;
            setResults(data.results ?? []);
            setActiveIndex(-1);
          })
          .catch((err: unknown) => {
            if (err instanceof DOMException && err.name === 'AbortError') return;
            setResults([]);
          })
          .finally(() => {
            if (!controller.signal.aborted) setSearchLoading(false);
          });
      }, 250);
    };

    const handleInputChange = (val: string) => {
      setInput(val);
      if (error) setError(null);
      setSearchOpen(val.trim().length >= 2);
      if (!disabled) {
        runSubredditSearch(val);
      }
    };

    const addSubredditFromResult = (result: SubredditSearchResult) => {
      const prev = subredditsRef.current;
      if (!prev.some((s) => s.toLowerCase() === result.name.toLowerCase())) {
        onChange([...prev, result.name]);
      }
      setInput('');
      setError(null);
      setResults([]);
      setSearchOpen(false);
      setActiveIndex(-1);
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
      const visibleResults = results.filter(
        (r) => !subreddits.some((s) => s.toLowerCase() === r.name.toLowerCase()),
      );
      const dropdownOpen = searchOpen && visibleResults.length > 0;

      if (e.key === 'ArrowDown' && dropdownOpen) {
        e.preventDefault();
        setActiveIndex((prev) => (prev < visibleResults.length - 1 ? prev + 1 : 0));
        return;
      }
      if (e.key === 'ArrowUp' && dropdownOpen) {
        e.preventDefault();
        setActiveIndex((prev) => (prev > 0 ? prev - 1 : visibleResults.length - 1));
        return;
      }
      if (e.key === 'Escape' && searchOpen) {
        e.preventDefault();
        setSearchOpen(false);
        setActiveIndex(-1);
        return;
      }

      if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
        if (
          e.key === 'Enter' &&
          dropdownOpen &&
          activeIndex >= 0 &&
          activeIndex < visibleResults.length
        ) {
          e.preventDefault();
          addSubredditFromResult(visibleResults[activeIndex]);
          return;
        }
        if (input.trim()) {
          e.preventDefault();
          if (tryAddSubreddits(input)) {
            setInput('');
            setResults([]);
            setSearchOpen(false);
            setActiveIndex(-1);
          }
        }
      } else if (e.key === 'Backspace' && !input && subreddits.length > 0) {
        onChange(subreddits.slice(0, -1));
      }
    };

    const handleBlur = () => {
      setSearchOpen(false);
      if (input.trim()) {
        if (tryAddSubreddits(input)) {
          setInput('');
        }
      }
    };

    const handleFocus = () => {
      if (input.trim().length >= 2) {
        setSearchOpen(true);
      }
    };

    const removeSubreddit = (sub: string) => {
      onChange(subreddits.filter((s) => s !== sub));
      setError(null);
    };

    useImperativeHandle(ref, () => ({
      flush: () => {
        if (input.trim()) {
          if (!tryAddSubreddits(input)) return null;
          const tokens = input
            .split(/[\s,]+/)
            .flatMap((t) => {
              const trimmed = t.trim().replace(/^\/?r\//i, '');
              return trimmed ? [trimmed] : [];
            });
          const merged = [...subredditsRef.current];
          for (const t of tokens) {
            if (!merged.some((s) => s.toLowerCase() === t.toLowerCase())) {
              merged.push(t);
            }
          }
          setInput('');
          return merged;
        }
        return subredditsRef.current;
      },
    }));

    return (
      <>
        <div className="relative">
          <div className="mt-1 flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 min-h-9 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background">
            {subreddits.map((sub) => (
              <Badge
                key={sub}
                variant="secondary"
                className="gap-1 pl-2 pr-1 font-mono"
              >
                r/{sub}
                <button
                  type="button"
                  onClick={() => removeSubreddit(sub)}
                  disabled={disabled}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20"
                  aria-label={`Retirer r/${sub}`}
                >
                  <XIcon className="size-3" />
                </button>
              </Badge>
            ))}
            <div className="relative flex flex-1 items-center min-w-[160px]">
              <Search className="pointer-events-none absolute left-0 size-3.5 text-muted-foreground" />
              <input
                id="product-subreddits"
                type="text"
                // react-doctor-disable-next-line react-doctor/no-redundant-roles -- ARIA combobox pattern requires explicit role; text input's implicit role is textbox, not combobox
                role="combobox"
                aria-label="Rechercher un subreddit"
                aria-autocomplete="list"
                aria-expanded={searchOpen}
                aria-controls="subreddit-search-listbox"
                aria-activedescendant={
                  activeIndex >= 0 ? `subreddit-result-${activeIndex}` : undefined
                }
                value={input}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={handleBlur}
                onFocus={handleFocus}
                placeholder={subreddits.length === 0 ? 'Recherche un subreddit…' : ''}
                disabled={disabled}
                className="flex-1 bg-transparent pl-5 pr-5 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
              />
              {searchLoading && (
                <Loader2 className="pointer-events-none absolute right-0 size-3.5 animate-spin text-muted-foreground" />
              )}
            </div>
          </div>
          {searchOpen && !disabled && (() => {
            const visibleResults = results.filter(
              (r) => !subreddits.some((s) => s.toLowerCase() === r.name.toLowerCase()),
            );
            const showEmpty =
              !searchLoading &&
              input.trim().length >= 2 &&
              visibleResults.length === 0;
            if (visibleResults.length === 0 && !showEmpty) return null;
            return (
              <div
                id="subreddit-search-listbox"
                // react-doctor-disable-next-line react-doctor/prefer-tag-over-role -- custom ARIA combobox listbox needs rich option markup; <datalist> cannot hold interactive children
                role="listbox"
                aria-label="Résultats de recherche de subreddits"
                className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-auto rounded-md border border-input bg-popover text-popover-foreground shadow-md"
              >
                {visibleResults.map((result, idx) => (
                  <div key={result.name}>
                    <button
                      type="button"
                      id={`subreddit-result-${idx}`}
                      role="option"
                      aria-selected={idx === activeIndex}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        addSubredditFromResult(result);
                      }}
                      onMouseEnter={() => setActiveIndex(idx)}
                      className={cn(
                        'flex w-full cursor-pointer items-start gap-2 px-3 py-2 text-left text-sm',
                        idx === activeIndex
                          ? 'bg-accent text-accent-foreground'
                          : 'hover:bg-accent hover:text-accent-foreground',
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-medium">
                            r/{result.name}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatSubscribers(result.subscribers)}
                          </span>
                          {result.over18 && (
                            <span className="rounded bg-destructive/15 px-1 text-[10px] font-semibold uppercase text-destructive">
                              NSFW
                            </span>
                          )}
                        </div>
                        {(result.title || result.description) && (
                          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                            {result.description || result.title}
                          </p>
                        )}
                      </div>
                    </button>
                  </div>
                ))}
                {showEmpty && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">
                    Aucun subreddit trouvé pour «&nbsp;{input.trim()}&nbsp;».
                  </div>
                )}
              </div>
            );
          })()}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Tape pour rechercher un subreddit, ou colle plusieurs noms séparés par une virgule.
        </p>
        {error && (
          <p className="mt-1 text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
      </>
    );
  },
);
