import { useState, useEffect } from "react";
import { useApi } from "@/hooks/use-api";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { TweetListPanel } from "@/components/tweet-list-panel";
import { MarkdownContent } from "@/components/markdown-content";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { usePagination } from "@/hooks/use-pagination";
import { ConfirmDialog } from "@/components/responsive-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Calendar, TrendingUp, Loader2, Send, Check, X, Search, RotateCcw, Trash2, RefreshCw, MessageSquare, MoreVertical } from "lucide-react";
import { toast } from "sonner";
import { useSelectedProduct, withProductId } from "@/lib/product-context";
import type { RunRecord, MonthlySummaryRecord, AvailableMonth, ConfigResponse } from "@/types";

const MONTH_NAMES = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "long", year: "numeric" });
}

export function SummariesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Synthèses"
        description="Historique des résumés IA quotidiens et mensuels"
      />

      <Tabs defaultValue="daily">
        <TabsList>
          <TabsTrigger value="daily">Quotidien</TabsTrigger>
          <TabsTrigger value="monthly">Mensuel</TabsTrigger>
        </TabsList>
        <TabsContent value="daily">
          <DailyView />
        </TabsContent>
        <TabsContent value="monthly">
          <MonthlyView />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DailyView() {
  const { selectedProductId } = useSelectedProduct();
  const pagination = usePagination({ limit: 10 });
  const [filterMonth, setFilterMonth] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debounce search input (300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput);
      pagination.reset();
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput, pagination]);

  // Build API URL with filters
  const params = new URLSearchParams({
    limit: String(pagination.limit),
    offset: String(pagination.offset),
  });
  if (filterMonth) params.set("month", filterMonth);
  if (debouncedSearch) params.set("search", debouncedSearch);

  const { data, loading, refetch } = useApi<{ summaries: RunRecord[]; total: number }>(
    `/api/summaries?${params.toString()}`,
    { productId: selectedProductId }
  );
  const { data: available } = useApi<AvailableMonth[]>("/api/monthly-summaries/available", {
    productId: selectedProductId,
  });
  const { data: configData } = useApi<ConfigResponse>("/api/config");
  const discordConfigured = !!configData?.credentialInfo.discordWebhookMasked;

  const hasFilters = !!filterMonth || !!debouncedSearch;

  const handleResetFilters = () => {
    setFilterMonth("");
    setSearchInput("");
    setDebouncedSearch("");
    pagination.reset();
  };

  // Build month options from available data
  const monthOptions = (available || []).map((m) => ({
    value: `${m.year}-${String(m.month).padStart(2, "0")}`,
    label: `${MONTH_NAMES[m.month - 1]} ${m.year} (${m.run_count})`,
  }));

  if (loading && !data) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-40 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  const totalPages = data ? pagination.totalPages(data.total) : 0;

  return (
    <div className="space-y-4">
      {/* Filter bar — sticky on mobile under the header */}
      <div className="sticky top-14 z-20 -mx-3 sm:mx-0 px-3 sm:px-0 py-2 sm:py-0 bg-background/95 backdrop-blur sm:bg-transparent sm:backdrop-blur-none border-b sm:border-0">
        <div className="flex flex-col gap-2 sm:flex-row sm:gap-3 sm:items-center">
          <div className="relative flex-1 sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input
              placeholder="Rechercher…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-9 h-10"
              aria-label="Rechercher dans le contenu des résumés"
            />
          </div>
          <div className="flex items-center gap-2">
            <Select value={filterMonth} onValueChange={(v) => { setFilterMonth(v); pagination.reset(); }}>
              <SelectTrigger className="flex-1 sm:w-[200px] h-10" aria-label="Filtrer par mois">
                <SelectValue placeholder="Tous les mois" />
              </SelectTrigger>
              <SelectContent>
                {monthOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hasFilters && (
              <Button variant="ghost" size="icon" onClick={handleResetFilters} aria-label="Réinitialiser les filtres" className="h-10 w-10 shrink-0">
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {!data || data.summaries.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            {hasFilters
              ? "Aucun résumé ne correspond aux filtres."
              : "Aucun résumé quotidien disponible."}
            {hasFilters && (
              <Button variant="ghost" size="sm" className="ml-2" onClick={handleResetFilters}>
                Réinitialiser les filtres
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-4">
            {data.summaries.map((run) => (
              <SummaryCard key={run.id} run={run} discordConfigured={discordConfigured} onMutate={refetch} />
            ))}
          </div>

          <Pagination
            page={pagination.page}
            totalPages={totalPages}
            onPrev={pagination.prev}
            onNext={pagination.next}
          />
        </>
      )}
    </div>
  );
}

interface SummaryActionsMenuProps {
  busy: boolean;
  rerunning: boolean;
  rerunResult: "success" | "error" | null;
  sending: boolean;
  deleting: boolean;
  discordConfigured: boolean;
  onRerun: () => void;
  onSendDiscord: () => void;
  onDelete: () => void;
}

function SummaryActionsMenu({
  busy,
  rerunning,
  rerunResult,
  sending,
  deleting,
  discordConfigured,
  onRerun,
  onSendDiscord,
  onDelete,
}: SummaryActionsMenuProps) {
  const rerunIcon = rerunning ? (
    <Loader2 className="animate-spin" />
  ) : rerunResult === "success" ? (
    <Check className="text-success" />
  ) : rerunResult === "error" ? (
    <X className="text-destructive" />
  ) : (
    <RefreshCw />
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          disabled={busy}
          className="h-9 w-9"
          aria-label="Actions sur le résumé"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreVertical className="h-4 w-4" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Actions</DropdownMenuLabel>
        <DropdownMenuItem onSelect={onRerun} disabled={busy}>
          {rerunIcon}
          <span>Régénérer le résumé</span>
        </DropdownMenuItem>
        {discordConfigured && (
          <DropdownMenuItem onSelect={onSendDiscord} disabled={busy}>
            {sending ? <Loader2 className="animate-spin" /> : <Send />}
            <span>Envoyer sur Discord</span>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <ConfirmDialog
          trigger={
            <DropdownMenuItem
              variant="destructive"
              disabled={busy}
              onSelect={(e) => e.preventDefault()}
            >
              {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
              <span>Supprimer</span>
            </DropdownMenuItem>
          }
          title="Supprimer ce résumé ?"
          description="Cette action est irréversible. Le résumé sera définitivement supprimé et les tweets associés seront libérés pour une éventuelle régénération."
          confirmLabel="Supprimer"
          confirmVariant="destructive"
          onConfirm={onDelete}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SummaryCard({ run, discordConfigured, onMutate }: { run: RunRecord; discordConfigured: boolean; onMutate: () => void }) {
  const { selectedProductId } = useSelectedProduct();
  const [expanded, setExpanded] = useState(false);
  const [sending, setSending] = useState(false);
  const [notifStatus, setNotifStatus] = useState(run.notification_status);
  const [deleting, setDeleting] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [rerunResult, setRerunResult] = useState<"success" | "error" | null>(null);

  const busy = sending || deleting || rerunning;

  const handleSendDiscord = async () => {
    setSending(true);
    try {
      const res = await fetch(withProductId(`/api/runs/${run.id}/send-discord`, selectedProductId), {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Résumé envoyé sur Discord");
        setNotifStatus("sent");
      } else {
        toast.error("Échec de l'envoi sur Discord");
      }
    } catch {
      toast.error("Erreur réseau lors de l'envoi");
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(withProductId(`/api/summaries/${run.id}`, selectedProductId), {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Résumé supprimé");
        onMutate();
      } else {
        toast.error(data.message || "Échec de la suppression");
      }
    } catch {
      toast.error("Erreur réseau lors de la suppression");
    } finally {
      setDeleting(false);
    }
  };

  const handleRerun = async () => {
    setRerunning(true);
    setRerunResult(null);
    try {
      const res = await fetch(withProductId(`/api/summaries/${run.id}/rerun`, selectedProductId), {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) {
        setRerunResult("success");
        toast.success("Résumé régénéré avec succès");
        onMutate();
      } else {
        setRerunResult("error");
        toast.error(data.message || "Échec de la régénération");
      }
    } catch {
      setRerunResult("error");
      toast.error("Erreur réseau lors de la régénération");
    } finally {
      setRerunning(false);
      setTimeout(() => setRerunResult(null), 3000);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Calendar className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
            <span className="font-medium text-sm sm:text-base truncate">{formatDate(run.started_at)}</span>
            <Badge variant="outline" className="ml-1 shrink-0">#{run.id}</Badge>
            {notifStatus === "sent" && <Badge variant="success">Discord</Badge>}
          </div>
          <div className="flex items-center gap-1.5">
            {run.tweets_fetched > 0 ? (
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-9 px-2 text-xs" aria-label={`Voir les ${run.tweets_fetched} tweets de ce run`}>
                    <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                    {run.tweets_fetched}
                  </Button>
                </SheetTrigger>
                <SheetContent>
                  <SheetHeader>
                    <SheetTitle>{run.tweets_fetched} tweets — Run #{run.id}</SheetTitle>
                    <SheetDescription>{formatDate(run.started_at)}</SheetDescription>
                  </SheetHeader>
                  <TweetListPanel runId={run.id} tweetCount={run.tweets_fetched} />
                </SheetContent>
              </Sheet>
            ) : (
              <Badge variant="secondary" className="text-xs">{run.tweets_fetched} tweets</Badge>
            )}
            <SummaryActionsMenu
              busy={busy}
              rerunning={rerunning}
              rerunResult={rerunResult}
              sending={sending}
              deleting={deleting}
              discordConfigured={discordConfigured}
              onRerun={handleRerun}
              onSendDiscord={handleSendDiscord}
              onDelete={handleDelete}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className={!expanded ? "max-h-[4.5rem] overflow-hidden relative" : ""}>
          <MarkdownContent content={run.summary ?? ""} className="text-sm" />
          {!expanded && (
            <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-card to-transparent" />
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 text-primary"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Réduire" : "Lire la suite"}
        </Button>
      </CardContent>
    </Card>
  );
}

function MonthlyView() {
  const { selectedProductId } = useSelectedProduct();
  const { data: available, loading: loadingAvailable } = useApi<AvailableMonth[]>(
    "/api/monthly-summaries/available",
    { productId: selectedProductId }
  );
  const { data: existingSummaries, loading: loadingSummaries, refetch } = useApi<MonthlySummaryRecord[]>(
    "/api/monthly-summaries",
    { productId: selectedProductId }
  );
  const [selectedYear, setSelectedYear] = useState<string>("");
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [generating, setGenerating] = useState(false);

  if (loadingAvailable || loadingSummaries) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    );
  }

  const years = [...new Set((available || []).map((m) => m.year))];
  const monthsForYear = (available || []).filter((m) => String(m.year) === selectedYear);

  const handleGenerate = async () => {
    if (!selectedYear || !selectedMonth) return;
    setGenerating(true);
    try {
      const res = await fetch(withProductId("/api/monthly-summaries/generate", selectedProductId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: Number(selectedYear), month: Number(selectedMonth) }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Résumé mensuel généré avec succès");
        refetch();
      } else {
        toast.error(data.message || "Erreur lors de la génération");
      }
    } catch {
      toast.error("Erreur réseau");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="font-semibold flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            Générer un résumé mensuel
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-sm text-muted-foreground">Année</label>
              <Select value={selectedYear} onValueChange={(v) => { setSelectedYear(v); setSelectedMonth(""); }}>
                <SelectTrigger className="w-[120px]">
                  <SelectValue placeholder="Année" />
                </SelectTrigger>
                <SelectContent>
                  {years.map((y) => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm text-muted-foreground">Mois</label>
              <Select value={selectedMonth} onValueChange={setSelectedMonth} disabled={!selectedYear}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Mois" />
                </SelectTrigger>
                <SelectContent>
                  {monthsForYear.map((m) => (
                    <SelectItem key={m.month} value={String(m.month)}>
                      {MONTH_NAMES[m.month - 1]} ({m.run_count} runs)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={handleGenerate}
              disabled={!selectedYear || !selectedMonth || generating}
            >
              {generating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {generating ? "Génération..." : "Générer"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {existingSummaries && existingSummaries.length > 0 ? (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Résumés mensuels générés</h2>
          {existingSummaries.map((ms) => (
            <MonthlySummaryCard key={ms.id} summary={ms} />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Aucun résumé mensuel généré. Sélectionnez un mois ci-dessus pour en créer un.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function parseRunIds(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((n) => typeof n === "number") : [];
  } catch {
    return [];
  }
}

function MonthlySummaryCard({ summary }: { summary: MonthlySummaryRecord }) {
  const [expanded, setExpanded] = useState(false);
  const runIds = parseRunIds(summary.source_run_ids);

  return (
    <Card className="border-l-4 border-l-primary/30">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <TrendingUp className="h-4 w-4 text-primary" />
            <span className="font-semibold text-base sm:text-lg">
              {MONTH_NAMES[summary.month - 1]} {summary.year}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{runIds.length} jours</Badge>
            <Badge variant="outline">{formatDate(summary.generated_at)}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className={!expanded ? "max-h-[6rem] overflow-hidden relative" : ""}>
          <MarkdownContent content={summary.summary ?? ""} className="text-sm" />
          {!expanded && (
            <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-card to-transparent" />
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 text-primary"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Réduire" : "Lire la suite"}
        </Button>
      </CardContent>
    </Card>
  );
}
