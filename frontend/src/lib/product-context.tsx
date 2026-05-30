import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ProductContext,
  STORAGE_KEY,
  readStoredId,
  type ProductContextValue,
} from './product-context-hooks';

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
