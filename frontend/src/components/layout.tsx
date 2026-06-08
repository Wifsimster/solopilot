import { useState, useCallback } from 'react';
import { NavLink, Link, Outlet } from 'react-router-dom';
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
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerBody,
} from '@/components/ui/drawer';
import { MobileBottomNav } from '@/components/mobile-bottom-nav';
import {
  BrainCircuit,
  History,
  Package,
  Settings as SettingsIcon,
  Target,
  Wand2,
  LayoutDashboard,
  FileText,
  Workflow,
  Gauge,
  Receipt,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSelectedProduct, DEFAULT_PRODUCT_ID } from '@/lib/product-context-hooks';
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
      { to: '/cockpit', label: 'Cockpit', icon: Gauge },
      { to: '/summaries', label: 'Synthèses', icon: FileText },
      { to: '/runs', label: 'Historique', icon: History },
      { to: '/workflows', label: 'Workflows', icon: Workflow },
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
    id: 'manage',
    label: 'Gérer',
    items: [{ to: '/facturation', label: 'Facturation', icon: Receipt }],
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

function drawerNavLinkClass({ isActive }: { isActive: boolean }) {
  return cn(
    'flex items-center gap-3 py-3 px-3 text-base rounded-md transition-colors min-h-[48px]',
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  return (
    <div className="min-h-screen flex flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md focus:shadow-lg"
      >
        Aller au contenu principal
      </a>

      {/* Header — compact on mobile, full nav on desktop */}
      <header
        className="border-b bg-card/80 backdrop-blur-md sticky top-0 z-40"
        aria-label="En-tête"
      >
        <div className="container mx-auto flex items-center justify-between gap-3 px-4 h-14">
          <Link
            to="/"
            className="font-bold text-base sm:text-lg flex items-center gap-2 hover:text-primary transition-colors shrink-0"
          >
            <BrainCircuit className="size-5 text-primary" />
            <span className="hidden sm:inline">X AI Weekly Bot</span>
            <span className="sm:hidden">XAI Bot</span>
          </Link>

          {/* Desktop nav */}
          <nav
            className="hidden md:flex items-center gap-1 flex-1 ml-4"
            aria-label="Navigation principale"
          >
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
                    <item.icon className="size-3.5" aria-hidden="true" />
                    {item.label}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>

          {/* Desktop right cluster */}
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

          {/* Mobile — compact product switcher only */}
          <div className="md:hidden shrink-0">
            <ProductSwitcher triggerClassName="h-9 w-[140px] text-xs" />
          </div>
        </div>
      </header>

      <main
        id="main-content"
        className="container mx-auto flex-1 px-3 py-4 sm:px-4 sm:py-6 pb-24 md:pb-6"
      >
        <Outlet />
      </main>

      <footer className="hidden md:block border-t py-4">
        <div className="container mx-auto px-4">
          <p className="text-xs text-muted-foreground">
            X AI Weekly Bot v{versionInfo?.version || 'dev'}
            {versionInfo?.buildDate && (
              <>
                {' '}
                (Build{' '}
                {new Date(versionInfo.buildDate).toLocaleDateString('fr-FR', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
                )
              </>
            )}
          </p>
        </div>
      </footer>

      {/* Mobile bottom nav + "more" drawer */}
      <MobileBottomNav onMore={() => setDrawerOpen(true)} />

      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DrawerContent className="max-h-[85dvh]">
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2">
              <BrainCircuit className="size-5 text-primary" />
              Navigation
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <div className="space-y-5">
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
                      className={drawerNavLinkClass}
                      onClick={closeDrawer}
                    >
                      <item.icon className="size-4 shrink-0" aria-hidden="true" />
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              ))}
              <div className="pt-4 border-t space-y-2">
                <p className="px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Apparence
                </p>
                <Select
                  value={theme}
                  onValueChange={(v) => setTheme(v as 'light' | 'dark' | 'system')}
                >
                  <SelectTrigger className="h-11 w-full text-sm" aria-label="Thème de l'interface">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="system">Système</SelectItem>
                    <SelectItem value="light">Clair</SelectItem>
                    <SelectItem value="dark">Sombre</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="px-3 pt-2 text-xs text-muted-foreground">
                v{versionInfo?.version || 'dev'}
              </p>
            </div>
          </DrawerBody>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
