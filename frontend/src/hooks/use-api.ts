import { useReducer, useEffect, useCallback } from "react";
import { withProductId } from "@/lib/product-context-hooks";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1500;

interface UseApiOptions {
  /**
   * When provided, the productId is appended as a query parameter to the URL.
   * Existing productId params (if any) are preserved.
   */
  productId?: string;
}

interface FetchState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

type FetchAction<T> =
  | { type: "start" }
  | { type: "success"; data: T }
  | { type: "error"; error: string };

function fetchReducer<T>(state: FetchState<T>, action: FetchAction<T>): FetchState<T> {
  switch (action.type) {
    case "start":
      return { ...state, loading: true, error: null };
    case "success":
      return { data: action.data, error: null, loading: false };
    case "error":
      return { ...state, error: action.error, loading: false };
  }
}

export function useApi<T>(url: string, options?: UseApiOptions) {
  const [state, dispatch] = useReducer(fetchReducer<T>, {
    data: null,
    error: null,
    loading: true,
  });

  const productId = options?.productId;
  const finalUrl = productId ? withProductId(url, productId) : url;

  const refetch = useCallback(() => {
    dispatch({ type: "start" });

    let attempt = 0;
    const doFetch = (): Promise<void> =>
      fetch(finalUrl)
        .then((res) => {
          if (!res.ok) throw new Error(`Erreur HTTP ${res.status}`);
          return res.json();
        })
        .then((data: T) => dispatch({ type: "success", data }))
        .catch((err) => {
          attempt++;
          if (attempt <= MAX_RETRIES) {
            return new Promise<void>((resolve) =>
              setTimeout(() => resolve(doFetch()), RETRY_DELAY_MS * attempt)
            );
          }
          dispatch({ type: "error", error: err.message });
        });

    doFetch();
  }, [finalUrl]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data: state.data, loading: state.loading, error: state.error, refetch };
}
