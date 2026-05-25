import { useEffect, useState, useCallback } from 'react';
import { NavLink, Link, Outlet, useLocation } from 'react-router-dom';
import { useTheme } from '@/components/theme-provider';
import { useApi } from '@/hooks/use-api';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { BrainCircuit, Menu, Plus, Target, Wand2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSelectedProduct, DEFAULT_PRODUCT_ID } from '@/lib/product-context';
import { ProductCreateDialog } from '@/components/product-create-dialog';
import type { ProductRecord } from '@/types';

const NEW_PRODUCT_VALUE = '__new__';

function navLinkClass({ isActive }: { isActive: boolean }) {
  return cn(
    'text-sm transition-colors hover:text-foreground py-1 border-b-2',
    isActive
      ? 'text-foreground font-medium border-primary'
      : 'text-muted-foreground border-transparent',
  );
}

function mobileNavLinkClass({ isActive }: { isActive: boolean }) {
  return cn(
    'block py-3 px-2 text-base transition-colors hover:text-foreground rounded-md',
    isActive
      ? 'text-foreground font-medium bg-primary/10'
      : 'text-muted-foreground',
  );
}

function ProductSwitcher({
  className,
  triggerClassName,
}: {
  className?: string;
  triggerClassName?: string;
}) {
  const { selectedProductId, setSelectedProductId } = useSelectedProduct();
  const { data: products, refetch } = useApi<ProductRecord[]>('/api/products');
  const [createOpen, setCreateOpen] = useState(false);

  // Filter out archived products from the switcher
  const active = (products ?? []).filter((p) => !p.archived_at);

  // If selected product is missing from the list (e.g. archived or first load
  // before backend exists), still show the id so the value is controllable.
  const hasSelected = active.some((p) => p.id === selectedProductId);

  const handleChange = useCallback(
    (value: string) => {
      if (value === NEW_PRODUCT_VALUE) {
        setCreateOpen(true);
        return;
      }
      setSelectedProductId(value);
    },
    [setSelectedProductId],
  );

  const handleCreated = useCallback(
    (product: ProductRecord) => {
      refetch();
      setSelectedProductId(product.id);
    },
    [refetch, setSelectedProductId],
  );

  return (
    <div className={className}>
      <Select value={selectedProductId} onValueChange={handleChange}>
        <SelectTrigger
          className={cn('h-8 w-[180px] text-xs', triggerClassName)}
          aria-label="Produit sélectionné"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {!hasSelected && (
            <SelectItem value={selectedProductId}>
              {selectedProductId === DEFAULT_PRODUCT_ID ? 'Produit par défaut' : selectedProductId}
            </SelectItem>
          )}
          {active.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
          <SelectItem value={NEW_PRODUCT_VALUE} className="text-primary">
            <span className="inline-flex items-center gap-1">
              <Plus className="h-3 w-3" />+ Nouveau produit
            </span>
          </SelectItem>
        </SelectContent>
      </Select>
      <ProductCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={handleCreated}
      />
    </div>
  );
}

export function Layout() {
  const { theme, setTheme } = useTheme();
  const { data: versionInfo } = useApi<{ version: string; buildDate: string | null }>(
    '/api/version',
  );
  const [sheetOpen, setSheetOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setSheetOpen(false);
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md"
      >
        Aller au contenu principal
      </a>
      <nav className="border-b border-primary/15 bg-card/80 backdrop-blur-md sticky top-0 z-50">
        <div className="container mx-auto flex items-center justify-between px-4 h-14">
          <Link
            to="/"
            className="font-bold text-lg flex items-center gap-2 hover:text-primary transition-colors"
          >
            <BrainCircuit className="h-5 w-5 text-primary" />X AI Weekly Bot
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-4">
            <NavLink to="/" end className={navLinkClass}>
              Dashboard
            </NavLink>
            <NavLink to="/summaries" className={navLinkClass}>
              Synthèses
            </NavLink>
            <NavLink to="/runs" className={navLinkClass}>
              Historique
            </NavLink>
            <NavLink to="/products" className={navLinkClass}>
              Produits
            </NavLink>
            <NavLink to="/leads" className={navLinkClass}>
              <span className="inline-flex items-center gap-1">
                <Target className="h-3.5 w-3.5" />
                Opportunités
              </span>
            </NavLink>
            <NavLink to="/studio" className={navLinkClass}>
              <span className="inline-flex items-center gap-1">
                <Wand2 className="h-3.5 w-3.5" />
                Studio
              </span>
            </NavLink>
            <NavLink to="/settings" className={navLinkClass}>
              Paramètres
            </NavLink>
            <ProductSwitcher />
            <Select value={theme} onValueChange={(v) => setTheme(v as 'light' | 'dark' | 'system')}>
              <SelectTrigger className="h-8 w-[110px] text-xs" aria-label="Theme">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">Système</SelectItem>
                <SelectItem value="light">Clair</SelectItem>
                <SelectItem value="dark">Sombre</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Mobile sheet nav */}
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <button
                className="md:hidden p-2 -mr-2 hover:bg-muted rounded-md transition-colors"
                aria-label="Ouvrir le menu"
              >
                <Menu className="h-5 w-5" />
              </button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <BrainCircuit className="h-5 w-5 text-primary" />
                  Navigation
                </SheetTitle>
              </SheetHeader>
              <div className="mt-6 space-y-1">
                <NavLink to="/" end className={mobileNavLinkClass}>
                  Dashboard
                </NavLink>
                <NavLink to="/summaries" className={mobileNavLinkClass}>
                  Synthèses
                </NavLink>
                <NavLink to="/runs" className={mobileNavLinkClass}>
                  Historique
                </NavLink>
                <NavLink to="/products" className={mobileNavLinkClass}>
                  Produits
                </NavLink>
                <NavLink to="/leads" className={mobileNavLinkClass}>
                  <span className="inline-flex items-center gap-2">
                    <Target className="h-4 w-4" />
                    Opportunités
                  </span>
                </NavLink>
                <NavLink to="/studio" className={mobileNavLinkClass}>
                  <span className="inline-flex items-center gap-2">
                    <Wand2 className="h-4 w-4" />
                    Studio
                  </span>
                </NavLink>
                <NavLink to="/settings" className={mobileNavLinkClass}>
                  Paramètres
                </NavLink>
                <div className="pt-4 border-t border-primary/10 space-y-3">
                  <ProductSwitcher triggerClassName="h-10 w-full text-sm" />
                  <Select value={theme} onValueChange={(v) => setTheme(v as 'light' | 'dark' | 'system')}>
                    <SelectTrigger className="h-10 w-full text-sm" aria-label="Theme">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="system">Système</SelectItem>
                      <SelectItem value="light">Clair</SelectItem>
                      <SelectItem value="dark">Sombre</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
      <main id="main-content" className="container mx-auto flex-1 px-3 py-4 sm:px-4 sm:py-6">
        <Outlet />
      </main>
      <footer className="border-t py-4">
        <div className="container mx-auto px-4">
          <p className="text-xs text-muted-foreground">
            X AI Weekly Bot v{versionInfo?.version || 'dev'}
            {versionInfo?.buildDate && <> — Build {new Date(versionInfo.buildDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</>}
          </p>
        </div>
      </footer>
    </div>
  );
}
