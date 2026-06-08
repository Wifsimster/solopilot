import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";
import { Layout } from "@/components/layout";
import { Skeleton } from "@/components/ui/skeleton";
import { ProductProvider } from "@/lib/product-context";
import { DashboardPage } from "@/pages/dashboard";
import { CockpitPage } from "@/pages/cockpit";
import { RunsPage } from "@/pages/runs";
import { WorkflowsPage } from "@/pages/workflows";
import { SummariesPage } from "@/pages/summaries";
import { SettingsPage } from "@/pages/settings";
import { SetupPage } from "@/pages/setup";
import { ProductsPage } from "@/pages/products";
import { ComptabilitePage } from "@/pages/comptabilite";
import { LeadsPage } from "@/pages/leads";
import { StudioPage } from "@/pages/studio";

// Code-split the modules that pull heavy libs (recharts, dnd-kit, schedule-x) —
// keeps them out of the initial bundle. See ADR-0021.
const FacturationPage = lazy(() =>
  import("@/pages/facturation").then((m) => ({ default: m.FacturationPage })),
);
const AgendaPage = lazy(() =>
  import("@/pages/agenda").then((m) => ({ default: m.AgendaPage })),
);
const CrmPage = lazy(() => import("@/pages/crm").then((m) => ({ default: m.CrmPage })));

function LazyPage({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<Skeleton className="h-[32rem] w-full" />}>{children}</Suspense>;
}

export function App() {
  return (
    <ThemeProvider>
      <TooltipProvider>
        <ProductProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/setup" element={<SetupPage />} />
              <Route element={<Layout />}>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/cockpit" element={<CockpitPage />} />
                <Route path="/runs" element={<RunsPage />} />
                <Route path="/workflows" element={<WorkflowsPage />} />
                <Route path="/summaries" element={<SummariesPage />} />
                <Route path="/products" element={<ProductsPage />} />
                <Route path="/facturation" element={<LazyPage><FacturationPage /></LazyPage>} />
                <Route path="/comptabilite" element={<ComptabilitePage />} />
                <Route path="/agenda" element={<LazyPage><AgendaPage /></LazyPage>} />
                <Route path="/leads" element={<LeadsPage />} />
                <Route path="/crm" element={<LazyPage><CrmPage /></LazyPage>} />
                <Route path="/studio" element={<StudioPage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </ProductProvider>
        <Toaster richColors position="bottom-right" />
      </TooltipProvider>
    </ThemeProvider>
  );
}
