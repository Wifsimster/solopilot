import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";
import { Layout } from "@/components/layout";
import { ProductProvider } from "@/lib/product-context";
import { DashboardPage } from "@/pages/dashboard";
import { CockpitPage } from "@/pages/cockpit";
import { RunsPage } from "@/pages/runs";
import { WorkflowsPage } from "@/pages/workflows";
import { SummariesPage } from "@/pages/summaries";
import { SettingsPage } from "@/pages/settings";
import { SetupPage } from "@/pages/setup";
import { ProductsPage } from "@/pages/products";
import { FacturationPage } from "@/pages/facturation";
import { ComptabilitePage } from "@/pages/comptabilite";
import { LeadsPage } from "@/pages/leads";
import { StudioPage } from "@/pages/studio";

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
                <Route path="/facturation" element={<FacturationPage />} />
                <Route path="/comptabilite" element={<ComptabilitePage />} />
                <Route path="/leads" element={<LeadsPage />} />
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
