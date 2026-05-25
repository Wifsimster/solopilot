import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'selectedProductId';
const DEFAULT_PRODUCT_ID = 'default';

export interface Product {
  id: string;
  name: string;
  x_query: string | null;
  discord_webhook: string | null;
  ai_prompt_override: string | null;
  collect_cron: string | null;
  publish_cron: string | null;
  created_at: number;
  archived_at: number | null;
}

interface ProductContextValue {
  selectedProductId: string;
  setSelectedProductId: (id: string) => void;
}

const ProductContext = createContext<ProductContextValue | undefined>(undefined);

function readStoredId(): string {
  if (typeof window === 'undefined') return DEFAULT_PRODUCT_ID;
  try {
    return window.localStorage.getItem(STORAGE_KEY) || DEFAULT_PRODUCT_ID;
  } catch {
    return DEFAULT_PRODUCT_ID;
  }
}

export function ProductProvider({ children }: { children: React.ReactNode }) {
  const [selectedProductId, setSelectedProductIdState] = useState<string>(() => readStoredId());

  // Sync across tabs
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        setSelectedProductIdState(e.newValue);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setSelectedProductId = useCallback((id: string) => {
    setSelectedProductIdState(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<ProductContextValue>(
    () => ({ selectedProductId, setSelectedProductId }),
    [selectedProductId, setSelectedProductId],
  );

  return <ProductContext.Provider value={value}>{children}</ProductContext.Provider>;
}

export function useSelectedProduct(): ProductContextValue {
  const ctx = useContext(ProductContext);
  if (!ctx) {
    throw new Error('useSelectedProduct must be used within a ProductProvider');
  }
  return ctx;
}

/**
 * Append productId query param to an API URL while preserving existing params.
 */
export function withProductId(url: string, productId: string): string {
  if (!productId) return url;
  const hasQuery = url.includes('?');
  const separator = hasQuery ? '&' : '?';
  // Avoid duplicating productId if already present
  if (/[?&]productId=/.test(url)) return url;
  return `${url}${separator}productId=${encodeURIComponent(productId)}`;
}

export { DEFAULT_PRODUCT_ID };
