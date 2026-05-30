import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
}

export function Pagination({ page, totalPages, onPrev, onNext }: PaginationProps) {
  if (totalPages <= 1) return null;
  return (
    <nav
      className="flex items-center justify-center gap-2"
      aria-label="Pagination"
    >
      <Button
        variant="outline"
        size="sm"
        disabled={page === 0}
        onClick={onPrev}
        aria-label="Page précédente"
      >
        <ChevronLeft className="size-4" />
        <span className="hidden sm:inline">Précédent</span>
      </Button>
      <span className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
        Page {page + 1} / {totalPages}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={page >= totalPages - 1}
        onClick={onNext}
        aria-label="Page suivante"
      >
        <span className="hidden sm:inline">Suivant</span>
        <ChevronRight className="size-4" />
      </Button>
    </nav>
  );
}
