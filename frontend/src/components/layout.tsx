import { useState, useCallback } from 'react';
import { NavLink, Link, Outlet } from 'react-router-dom';
import { useTheme } from '@/components/theme-provider';
import { useApi } from '@/hooks/use-api';
import { ProductTour, startProductTour } from '@/components/product-tour';
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
  Calculator,
  Users,
  CalendarDays,
  Monitor,
  Sun,
  Moon,
  Compass,
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
  /** `data-tour` anchor used by the guided product tour. */
  tourId?: string;
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
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true, tourId: 'nav-dashboard' },
      { to: '/cockpit', label: 'Cockpit', icon: Gauge, tourId: 'nav-cockpit' },
      { to: '/summaries', label: 'Synthèses', icon: FileText, tourId: 'nav-summaries' },
      { to: '/runs', label: 'Historique', icon: History },
      { to: '/workflows', label: 'Workflows', icon: Workflow, tourId: 'nav-workflows' },
    ],
  },
  {
    id: 'engage',
    label: 'Engager',
    items: [
      { to: '/leads', label: 'Opportunités', icon: Target, tourId: 'nav-leads' },
      { to: '/crm', label: 'CRM', icon: Users, tourId: 'nav-crm' },
      { to: '/studio', label: 'Studio', icon: Wand2, tourId: 'nav-studio' },
    ],
  },
  {
    id: 'manage',
    label: 'Gérer',
    items: [
      { to: '/facturation', label: 'Facturation', icon: Receipt, tourId: 'nav-facturation' },
      { to: '/comptabilite', label: 'Comptabilité', icon: Calculator, tourId: 'nav-comptabilite' },
      { to: '/agenda', label: 'Agenda', icon: CalendarDays, tourId: 'nav-agenda' },
    ],
  },
  {
    id: 'configure',
    label: 'Configurer',
    items: [
      { to: '/products', label: 'Produits', icon: Package, tourId: 'nav-products' },
      { to: '/settings', label: 'Paramètres', icon: SettingsIcon, tourId: 'nav-settings' },
    ],
  },
];

function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-chart-2 text-primary-foreground shadow-xs',
        className,
      )}
      aria-hidden="true"
    >
      <Workflow className="size-[18px]" strokeWidth={2.25} />
    </span>
  );
}

function sidebarNavLinkClass({ isActive }: { isActive: boolean }) {
  return cn(
    'group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
    isActive
      ? 'bg-accent text-accent-foreground'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
  );
}

function drawerNavLinkClass({ isActive }: { isActive: boolean }) {
  return cn(
    'flex min-h-[48px] items-center gap-3 rounded-lg px-3 py-3 text-base transition-colors',
    isActive
      ? 'bg-accent font-medium text-accent-foreground'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
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

const THEME_OPTIONS = [
  { value: 'system', label: 'Système', icon: Monitor },
  { value: 'light', label: 'Clair', icon: Sun },
  { value: 'dark', label: 'Sombre', icon: Moon },
] as const;

function ThemeSegmented() {
  const { theme, setTheme } = useTheme();
  return (
    <div
      className="flex items-center gap-1 rounded-lg border border-border bg-muted/50 p-1"
      role="group"
      aria-label="Thème de l'interface"
    >
      {THEME_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => setTheme(opt.value)}
          aria-pressed={theme === opt.value}
          aria-label={opt.label}
          className={cn(
            'flex flex-1 items-center justify-center rounded-md py-1.5 transition-colors',
            theme === opt.value
              ? 'bg-card text-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <opt.icon className="size-4" />
        </button>
      ))}
    </div>
  );
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-5" aria-label="Navigation principale" data-tour="sidebar-nav">
      {NAV_SECTIONS.map((section) => (
        <div key={section.id} className="space-y-1">
          <p className="px-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            {section.label}
          </p>
          <div className="space-y-0.5">
            {section.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={sidebarNavLinkClass}
                onClick={onNavigate}
                data-tour={item.tourId}
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={cn(
                        'absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-primary transition-opacity',
                        isActive ? 'opacity-100' : 'opacity-0',
                      )}
                      aria-hidden="true"
                    />
                    <item.icon className="size-[18px] shrink-0" aria-hidden="true" />
                    {item.label}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function Layout() {
  const { data: versionInfo } = useApi<{ version: string; buildDate: string | null }>(
    '/api/version',
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  return (
    <div className="min-h-screen bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:shadow-lg"
      >
        Aller au contenu principal
      </a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-border bg-sidebar md:flex">
        <div className="flex h-16 items-center gap-2.5 border-b border-border px-5">
          <BrandMark />
          <div className="leading-tight">
            <span className="block text-sm font-semibold tracking-tight">Solopilot</span>
            <span className="block text-[11px] text-muted-foreground">Back-office autonome</span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-5">
          <SidebarNav />
        </div>
        <div className="space-y-3 border-t border-border p-3">
          <div data-tour="product-switcher">
            <ProductSwitcher className="w-full" triggerClassName="h-9 w-full" />
          </div>
          <div data-tour="theme-switcher">
            <ThemeSegmented />
          </div>
          <button
            type="button"
            onClick={startProductTour}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Compass className="size-[18px] shrink-0" aria-hidden="true" />
            Visite guidée
          </button>
          <p className="px-1 text-[11px] text-muted-foreground">
            v{versionInfo?.version || 'dev'}
          </p>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header
        className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-md md:hidden"
        aria-label="En-tête"
      >
        <div className="flex h-14 items-center justify-between gap-3 px-4">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <BrandMark className="size-7" />
            <span className="text-base tracking-tight">Solopilot</span>
          </Link>
          <ProductSwitcher triggerClassName="h-9 w-[140px] text-xs" />
        </div>
      </header>

      {/* Content column (offset by sidebar on desktop) */}
      <div className="flex min-h-screen flex-col md:pl-60">
        <main
          id="main-content"
          className="mx-auto w-full max-w-screen-2xl flex-1 px-4 py-5 pb-24 sm:px-6 sm:py-8 md:pb-8"
        >
          <Outlet />
        </main>

        <footer className="hidden border-t border-border py-4 md:block">
          <div className="mx-auto max-w-screen-2xl px-6">
            <p className="text-xs text-muted-foreground">
              Solopilot v{versionInfo?.version || 'dev'}
              {versionInfo?.buildDate && (
                <>
                  {' '}
                  (Build{' '}
                  {new Date(versionInfo.buildDate).toLocaleString('fr-FR', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  )
                </>
              )}
            </p>
          </div>
        </footer>
      </div>

      {/* Mobile bottom nav + "more" drawer */}
      <MobileBottomNav onMore={() => setDrawerOpen(true)} />

      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DrawerContent className="max-h-[85dvh]">
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2">
              <BrandMark className="size-7" />
              Navigation
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <div className="space-y-5">
              {NAV_SECTIONS.map((section) => (
                <div key={section.id} className="space-y-1">
                  <p className="px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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
                      <item.icon className="size-5 shrink-0" aria-hidden="true" />
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              ))}
              <div className="space-y-2 border-t border-border pt-4">
                <p className="px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Apparence
                </p>
                <ThemeSegmented />
              </div>
              <button
                type="button"
                onClick={() => {
                  closeDrawer();
                  startProductTour();
                }}
                className="flex min-h-[48px] w-full items-center gap-3 rounded-lg px-3 py-3 text-base text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Compass className="size-5 shrink-0" aria-hidden="true" />
                Visite guidée
              </button>
              <p className="px-3 pt-2 text-xs text-muted-foreground">
                v{versionInfo?.version || 'dev'}
              </p>
            </div>
          </DrawerBody>
        </DrawerContent>
      </Drawer>

      <ProductTour />
    </div>
  );
}
