import { useState, useCallback, useMemo } from 'react';

interface UsePaginationOptions {
  limit?: number;
}

export function usePagination({ limit = 20 }: UsePaginationOptions = {}) {
  const [page, setPage] = useState(0);

  const reset = useCallback(() => setPage(0), []);
  const prev = useCallback(() => setPage((p) => Math.max(0, p - 1)), []);
  const next = useCallback(() => setPage((p) => p + 1), []);

  return useMemo(
    () => ({
      page,
      offset: page * limit,
      limit,
      setPage,
      reset,
      prev,
      next,
      totalPages: (total: number) => Math.max(1, Math.ceil(total / limit)),
    }),
    [page, limit, reset, prev, next],
  );
}
