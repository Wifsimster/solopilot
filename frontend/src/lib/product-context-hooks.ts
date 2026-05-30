import { createContext, use } from 'react';

export const STORAGE_KEY = 'selectedProductId';
export const DEFAULT_PRODUCT_ID = 'default';

export interface Product {
  id: string;
  name: string;
  x_query: string | null;
  discord_webhook: string | null;
  ai_prompt_override: string | null;
  collect_cron: string | null;
  publish_cron: string | null;
  x_enabled: boolean;
  reddit_enabled: boolean;
  reddit_subreddits: string[] | null;
  created_at: number;
  archived_at: number | null;
}

export interface ProductContextValue {
  selectedProductId: string;
  setSelectedProductId: (id: string) => void;
}

export const ProductContext = createContext<ProductContextValue | undefined>(undefined);

export function readStoredId(): string {
  if (typeof window === 'undefined') return DEFAULT_PRODUCT_ID;
  try {
    return window.localStorage.getItem(STORAGE_KEY) || DEFAULT_PRODUCT_ID;
  } catch {
    return DEFAULT_PRODUCT_ID;
  }
}

export function useSelectedProduct(): ProductContextValue {
  const ctx = use(ProductContext);
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
