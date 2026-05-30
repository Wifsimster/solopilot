import { useState, useEffect, useCallback } from "react";
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

export function useApi<T>(url: string, options?: UseApiOptions) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const productId = options?.productId;
  const finalUrl = productId ? withProductId(url, productId) : url;

  const refetch = useCallback(() => {
    setLoading(true);
    setError(null);

    let attempt = 0;
    const doFetch = (): Promise<void> =>
      fetch(finalUrl)
        .then((res) => {
          if (!res.ok) throw new Error(`Erreur HTTP ${res.status}`);
          return res.json();
        })
        .then(setData)
        .catch((err) => {
          attempt++;
          if (attempt <= MAX_RETRIES) {
            return new Promise<void>((resolve) =>
              setTimeout(() => resolve(doFetch()), RETRY_DELAY_MS * attempt)
            );
          }
          setError(err.message);
        })
        .finally(() => {
          if (attempt === 0 || attempt > MAX_RETRIES) {
            setLoading(false);
          }
        });

    doFetch();
  }, [finalUrl]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}
