import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  TOUR_STEPS,
  TOUR_STORAGE_KEY,
  TOUR_START_EVENT,
  type TourStep,
} from '@/lib/tour-steps';

type Rect = { top: number; left: number; width: number; height: number };

const SPOTLIGHT_PADDING = 6;
const CARD_WIDTH = 320;
const CARD_GAP = 16;

function hasCompletedTour(): boolean {
  try {
    return window.localStorage.getItem(TOUR_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function markTourCompleted(): void {
  try {
    window.localStorage.setItem(TOUR_STORAGE_KEY, 'true');
  } catch {
    /* ignore */
  }
}

/** Locate the target element, retrying across a few frames while the route renders. */
function useTargetRect(step: TourStep | undefined, active: boolean): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    if (!active || !step) {
      setRect(null);
      return;
    }
    if (!step.target) {
      setRect(null);
      return;
    }

    let frame = 0;
    let cancelled = false;
    let attempts = 0;

    const measure = () => {
      if (cancelled) return;
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
          return;
        }
      }
      // Element not ready (route still mounting, or hidden on this viewport).
      if (attempts < 30) {
        attempts += 1;
        frame = requestAnimationFrame(measure);
      } else {
        setRect(null); // give up → centered fallback
      }
    };

    frame = requestAnimationFrame(measure);

    const onReflow = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
      if (el) {
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      }
    };
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [step, active]);

  return rect;
}

function cardPosition(rect: Rect | null, placement: TourStep['placement']) {
  // Centered card when there is no target to anchor to.
  if (!rect) {
    return {
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
    } as const;
  }

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const estHeight = 200;
  const centerX = rect.left + rect.width / 2 - CARD_WIDTH / 2;

  const fitsRight = rect.left + rect.width + CARD_GAP + CARD_WIDTH <= vw;
  const fitsLeft = rect.left - CARD_GAP - CARD_WIDTH >= 0;
  const fitsTop = rect.top - CARD_GAP - estHeight >= 0;
  const preferred = placement ?? 'right';

  let left: number;
  let top: number;

  if (preferred === 'top' && fitsTop) {
    left = centerX;
    top = rect.top - CARD_GAP - estHeight;
  } else if (preferred !== 'left' && fitsRight) {
    left = rect.left + rect.width + CARD_GAP;
    top = rect.top;
  } else if (fitsLeft) {
    left = rect.left - CARD_GAP - CARD_WIDTH;
    top = rect.top;
  } else if (fitsTop) {
    left = centerX;
    top = rect.top - CARD_GAP - estHeight;
  } else {
    // Below the target as a last resort.
    left = centerX;
    top = rect.top + rect.height + CARD_GAP;
  }

  // Clamp inside the viewport.
  left = Math.max(8, Math.min(left, vw - CARD_WIDTH - 8));
  top = Math.max(8, Math.min(top, vh - estHeight - 8));

  return { top, left } as const;
}

export function ProductTour() {
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();
  const startedRef = useRef(false);

  const step = active ? TOUR_STEPS[index] : undefined;
  const rect = useTargetRect(step, active);

  const start = useCallback(() => {
    setIndex(0);
    setActive(true);
  }, []);

  const finish = useCallback(() => {
    setActive(false);
    markTourCompleted();
  }, []);

  // Auto-start on first visit, once, after the shell has rendered.
  useEffect(() => {
    if (startedRef.current) return;
    if (hasCompletedTour()) return;
    startedRef.current = true;
    const t = window.setTimeout(start, 700);
    return () => window.clearTimeout(t);
  }, [start]);

  // Allow manual (re)launch via a window event.
  useEffect(() => {
    const handler = () => {
      startedRef.current = true;
      start();
    };
    window.addEventListener(TOUR_START_EVENT, handler);
    return () => window.removeEventListener(TOUR_START_EVENT, handler);
  }, [start]);

  // Navigate to the step's route when needed.
  useEffect(() => {
    if (!active || !step?.route) return;
    if (location.pathname !== step.route) {
      navigate(step.route);
    }
  }, [active, step, location.pathname, navigate]);

  // Keyboard controls.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
      else if (e.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, TOUR_STEPS.length - 1));
      else if (e.key === 'ArrowLeft') setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, finish]);

  if (!active || !step) return null;

  const isFirst = index === 0;
  const isLast = index === TOUR_STEPS.length - 1;
  const next = () => (isLast ? finish() : setIndex((i) => i + 1));
  const prev = () => setIndex((i) => Math.max(i - 1, 0));

  const pos = cardPosition(rect, step.placement);

  return createPortal(
    <div className="fixed inset-0 z-[200]" role="dialog" aria-modal="true" aria-label="Visite guidée">
      {/* Backdrop — dark when no target, transparent click-catcher when spotlighting. */}
      <div
        className={cn('absolute inset-0', !rect && 'bg-foreground/50 backdrop-blur-[1px]')}
        onClick={finish}
      />

      {/* Spotlight cut-out via an oversized box-shadow ring. */}
      {rect && (
        <div
          className="pointer-events-none absolute rounded-lg ring-2 ring-primary transition-all duration-200"
          style={{
            top: rect.top - SPOTLIGHT_PADDING,
            left: rect.left - SPOTLIGHT_PADDING,
            width: rect.width + SPOTLIGHT_PADDING * 2,
            height: rect.height + SPOTLIGHT_PADDING * 2,
            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.55)',
          }}
        />
      )}

      {/* Explanation card. */}
      <div
        className="absolute w-[320px] max-w-[calc(100vw-16px)] rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-xl transition-all duration-200"
        style={pos}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={finish}
          className="absolute right-3 top-3 text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Fermer la visite"
        >
          <X className="size-4" />
        </button>

        <h3 className="pr-6 text-sm font-semibold tracking-tight">{step.title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{step.body}</p>

        <div className="mt-4 flex items-center justify-between gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">
            {index + 1} / {TOUR_STEPS.length}
          </span>
          <div className="flex items-center gap-2">
            {!isFirst && (
              <Button variant="ghost" size="sm" onClick={prev}>
                <ChevronLeft className="size-4" />
                Précédent
              </Button>
            )}
            {!isLast && (
              <Button variant="ghost" size="sm" onClick={finish}>
                Passer
              </Button>
            )}
            <Button size="sm" onClick={next}>
              {isLast ? 'Terminer' : 'Suivant'}
              {!isLast && <ChevronRight className="size-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Imperatively (re)launch the guided tour from anywhere in the app. */
export function startProductTour() {
  window.dispatchEvent(new Event(TOUR_START_EVENT));
}
