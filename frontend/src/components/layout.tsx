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
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  BrainCircuit,
  Menu,
  Target,
  Wand2,
  LayoutDashboard,
  FileText,
  History,
  Package,
  Settings as SettingsIcon,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSelectedProduct, DEFAULT_PRODUCT_ID } from '@/lib/product-context';
import type { ProductRecord } from '@/types';

type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
};

type NavSection = {
  id: string;
  label: string;
  items: NavItem[];
};

const NAV_SECTIONS: NavSection[] = [
  {
    id: 'monitor',
    label: 'Monitorer',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/summaries', label: 'Synthèses', icon: FileText },
      { to: '/runs', label: 'Historique', icon: History },
    ],
  },
  {
    id: 'engage',
    label: 'Engager',
    items: [
      { to: '/leads', label: 'Opportunités', icon: Target },
      { to: '/studio', label: 'Studio', icon: Wand2 },
    ],
  },
  {
    id: 'configure',
    label: 'Configurer',
    items: [
      { to: '/products', label: 'Produits', icon: Package },
      { to: '/settings', label: 'Paramètres', icon: SettingsIcon },
    ],
  },
];

function navLinkClass({ isActive }: { isActive: boolean }) {
  return cn(
    'inline-flex items-center gap-1.5 text-sm transition-colors py-1 border-b-2',
    isActive
      ? 'text-foreground font-medium border-primary'
      : 'text-muted-foreground border-transparent hover:text-foreground',
  );
}

function mobileNavLinkClass({ isActive }: { isActive: boolean }) {
  return cn(
    'flex items-center gap-3 py-3 px-3 text-base transition-colors rounded-md',
    isActive
      ? 'text-foreground font-medium bg-primary/10'
      : 'text-muted-foreground hover:text-foreground hover:bg-muted',
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
  const { data: products } = useApi<ProductRecord[]>('/api/products');

  const active = (products ?? []).filter((p) => !p.archived_at);
  const hasSelected = active.some((p) => p.id === selectedProductId);

  const handleChange = useCallback(
    (value: string) => setSelectedProductId(value),
    [setSelectedProductId],
  );

  const selectedName =
    active.find((p) => p.id === selectedProductId)?.name ??
    (selectedProductId === DEFAULT_PRODUCT_ID ? 'Produit par défaut' : selectedProductId);

  return (
    <div className={className}>
      <Select value={selectedProductId} onValueChange={handleChange}>
        <SelectTrigger
          className={cn('h-9 w-[180px] text-xs', triggerClassName)}
          aria-label={`Produit sélectionné : ${selectedName}`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {!hasSelected && (
            <SelectItem value={selectedProductId}>
              {selectedProductId === DEFAULT_PRODUCT_ID
                ? 'Produit par défaut'
                : selectedProductId}
            </SelectItem>
          )}
          {active.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md focus:shadow-lg"
      >
        Aller au contenu principal
      </a>
      <nav
        className="border-b bg-card/80 backdrop-blur-md sticky top-0 z-50"
        aria-label="Navigation principale"
      >
        <div className="container mx-auto flex items-center justify-between gap-3 px-4 h-14">
          <Link
            to="/"
            className="font-bold text-lg flex items-center gap-2 hover:text-primary transition-colors shrink-0"
          >
            <BrainCircuit className="h-5 w-5 text-primary" />
            <span className="hidden sm:inline">X AI Weekly Bot</span>
            <span className="sm:hidden">XAI</span>
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-1 flex-1 ml-4">
            {NAV_SECTIONS.map((section, sectionIdx) => (
              <div key={section.id} className="flex items-center gap-3">
                {sectionIdx > 0 && (
                  <span className="h-4 w-px bg-border" aria-hidden="true" />
                )}
                {section.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={navLinkClass}
                  >
                    <item.icon className="h-3.5 w-3.5" aria-hidden="true" />
                    {item.label}
                  </NavLink>
                ))}
              </div>
            ))}
          </div>

          <div className="hidden md:flex items-center gap-2 shrink-0">
            <ProductSwitcher />
            <Select
              value={theme}
              onValueChange={(v) => setTheme(v as 'light' | 'dark' | 'system')}
            >
              <SelectTrigger className="h-9 w-[100px] text-xs" aria-label="Thème de l'interface">
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
                className="md:hidden inline-flex items-center justify-center h-10 w-10 -mr-2 hover:bg-muted rounded-md transition-colors"
                aria-label="Ouvrir le menu de navigation"
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
              <div className="mt-6 space-y-6">
                {NAV_SECTIONS.map((section) => (
                  <div key={section.id} className="space-y-1">
                    <p className="px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {section.label}
                    </p>
                    {section.items.map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.end}
                        className={mobileNavLinkClass}
                      >
                        <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                        {item.label}
                      </NavLink>
                    ))}
                  </div>
                ))}
                <div className="pt-4 border-t space-y-3">
                  <ProductSwitcher triggerClassName="h-10 w-full text-sm" />
                  <Select
                    value={theme}
                    onValueChange={(v) => setTheme(v as 'light' | 'dark' | 'system')}
                  >
                    <SelectTrigger
                      className="h-10 w-full text-sm"
                      aria-label="Thème de l'interface"
                    >
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
            {versionInfo?.buildDate && (
              <>
                {' '}
                — Build{' '}
                {new Date(versionInfo.buildDate).toLocaleDateString('fr-FR', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </>
            )}
          </p>
        </div>
      </footer>
    </div>
  );
}
