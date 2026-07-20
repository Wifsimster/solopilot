import { useState, useEffect, useReducer } from "react";
import { useApi } from "@/hooks/use-api";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
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
import { Calendar, TrendingUp, Loader2, Send, Check, X, Search, RotateCcw, Trash2, RefreshCw, MessageSquare, MoreVertical, FileText } from "lucide-react";
import { toast } from "sonner";
import { useSelectedProduct, withProductId } from "@/lib/product-context-hooks";
import type { RunRecord, MonthlySummaryRecord, AvailableMonth, ConfigResponse } from "@/types";

const MONTH_NAMES = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "long", year: "numeric" });
}

// Daily AI summaries always open with a boilerplate title line
// ("📅 VEILLE IA & TECH — <date>"). The date already lives in the card header,
// so we drop that line to give the preview meaningful content instead.
function stripLeadingTitle(md: string): string {
  const lines = md.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  const first = lines[i]?.trim() ?? "";
  if (/📅/.test(first) || /veille\s+ia/i.test(first) || /^#{1,3}\s/.test(first)) {
    i++;
  }
  return lines.slice(i).join("\n").trim();
}

// The digest groups items under bold uppercase section headers, one per source.
// Detecting them lets us show at-a-glance source chips on each card.
const SOURCE_PATTERNS: { key: string; label: string; re: RegExp }[] = [
  { key: "x", label: "X", re: /X\s*\(TWITTER\)/i },
  { key: "reddit", label: "Reddit", re: /\bREDDIT\b/i },
  { key: "hn", label: "Hacker News", re: /HACKER\s+NEWS/i },
  { key: "youtube", label: "YouTube", re: /\bYOUTUBE\b/i },
];

function detectSources(md: string | null | undefined): { key: string; label: string }[] {
  if (!md) return [];
  return SOURCE_PATTERNS.filter((s) => s.re.test(md)).map(({ key, label }) => ({ key, label }));
}

export function SummariesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Veille"
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
          <Skeleton key={i} className="h-44 w-full rounded-xl" />
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
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" aria-hidden="true" />
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
              <Button variant="ghost" size="icon" onClick={handleResetFilters} aria-label="Réinitialiser les filtres" className="size-10 shrink-0">
                <RotateCcw className="size-4" aria-hidden="true" />
              </Button>
            )}
          </div>
        </div>
        {data && data.total > 0 && (
          <p className="mt-2 text-xs text-muted-foreground tabular-nums">
            {data.total} synthèse{data.total !== 1 ? "s" : ""}
            {hasFilters ? " trouvée" + (data.total !== 1 ? "s" : "") : ""}
          </p>
        )}
      </div>

      {!data || data.summaries.length === 0 ? (
        <Card>
          <CardContent className="py-16 flex flex-col items-center gap-4 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted" aria-hidden="true">
              <FileText className="size-5 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="font-medium">
                {hasFilters ? "Aucun résumé ne correspond aux filtres" : "Aucun résumé disponible"}
              </p>
              <p className="text-sm text-muted-foreground">
                {hasFilters
                  ? "Essayez d'élargir votre recherche."
                  : "Les résumés quotidiens apparaîtront ici après chaque run."}
              </p>
            </div>
            {hasFilters && (
              <Button variant="outline" size="sm" onClick={handleResetFilters}>
                <RotateCcw className="size-3.5" aria-hidden="true" />
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
          className="size-9"
          aria-label="Actions sur le résumé"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <MoreVertical className="size-4" />}
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

interface SummaryActionState {
  sending: boolean;
  deleting: boolean;
  rerunning: boolean;
  rerunResult: "success" | "error" | null;
  sentOverride: boolean;
}

type SummaryAction =
  | { type: "send/start" }
  | { type: "send/success" }
  | { type: "send/done" }
  | { type: "delete/start" }
  | { type: "delete/done" }
  | { type: "rerun/start" }
  | { type: "rerun/result"; result: "success" | "error" }
  | { type: "rerun/done" }
  | { type: "rerun/clearResult" };

const initialSummaryActionState: SummaryActionState = {
  sending: false,
  deleting: false,
  rerunning: false,
  rerunResult: null,
  sentOverride: false,
};

function summaryActionReducer(
  state: SummaryActionState,
  action: SummaryAction,
): SummaryActionState {
  switch (action.type) {
    case "send/start":
      return { ...state, sending: true };
    case "send/success":
      return { ...state, sentOverride: true };
    case "send/done":
      return { ...state, sending: false };
    case "delete/start":
      return { ...state, deleting: true };
    case "delete/done":
      return { ...state, deleting: false };
    case "rerun/start":
      return { ...state, rerunning: true, rerunResult: null };
    case "rerun/result":
      return { ...state, rerunResult: action.result };
    case "rerun/done":
      return { ...state, rerunning: false };
    case "rerun/clearResult":
      return { ...state, rerunResult: null };
    default:
      return state;
  }
}

function SummaryCard({ run, discordConfigured, onMutate }: { run: RunRecord; discordConfigured: boolean; onMutate: () => void }) {
  const { selectedProductId } = useSelectedProduct();
  const [expanded, setExpanded] = useState(false);
  const [action, dispatch] = useReducer(summaryActionReducer, initialSummaryActionState);
  const { sending, deleting, rerunning, rerunResult, sentOverride } = action;

  const notifStatus = sentOverride ? "sent" : run.notification_status;
  const busy = sending || deleting || rerunning;
  const sources = detectSources(run.summary);
  const body = stripLeadingTitle(run.summary ?? "");

  const handleSendDiscord = async () => {
    dispatch({ type: "send/start" });
    try {
      const res = await fetch(withProductId(`/api/runs/${run.id}/send-discord`, selectedProductId), {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Résumé envoyé sur Discord");
        dispatch({ type: "send/success" });
      } else {
        toast.error("Échec de l'envoi sur Discord");
      }
    } catch {
      toast.error("Erreur réseau lors de l'envoi");
    } finally {
      dispatch({ type: "send/done" });
    }
  };

  const handleDelete = async () => {
    dispatch({ type: "delete/start" });
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
      dispatch({ type: "delete/done" });
    }
  };

  const handleRerun = async () => {
    dispatch({ type: "rerun/start" });
    try {
      const res = await fetch(withProductId(`/api/summaries/${run.id}/rerun`, selectedProductId), {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) {
        dispatch({ type: "rerun/result", result: "success" });
        toast.success("Résumé régénéré avec succès");
        onMutate();
      } else {
        dispatch({ type: "rerun/result", result: "error" });
        toast.error(data.message || "Échec de la régénération");
      }
    } catch {
      dispatch({ type: "rerun/result", result: "error" });
      toast.error("Erreur réseau lors de la régénération");
    } finally {
      dispatch({ type: "rerun/done" });
      setTimeout(() => dispatch({ type: "rerun/clearResult" }), 3000);
    }
  };

  return (
    <Card className="hover:border-muted-foreground/20 transition-colors">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Calendar className="size-4 text-primary shrink-0" aria-hidden="true" />
              <span className="font-semibold text-sm sm:text-base truncate">
                {formatDate(run.started_at)}
              </span>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge variant="outline" className="text-xs tabular-nums">#{run.id}</Badge>
              {sources.map((s) => (
                <Badge key={s.key} variant="secondary" className="text-xs">{s.label}</Badge>
              ))}
              {notifStatus === "sent" && (
                <Badge variant="success" className="gap-1">
                  <Check className="size-3" aria-hidden="true" />
                  Discord
                </Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {run.tweets_fetched > 0 ? (
              <Sheet>
                <SheetTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2.5 text-xs gap-1.5"
                    aria-label={`Voir les ${run.tweets_fetched} tweets de ce run`}
                  >
                    <MessageSquare className="size-3.5" aria-hidden="true" />
                    <span className="tabular-nums">{run.tweets_fetched}</span>
                  </Button>
                </SheetTrigger>
                <SheetContent>
                  <SheetHeader>
                    <SheetTitle>{run.tweets_fetched} tweets (Run #{run.id})</SheetTitle>
                    <SheetDescription>{formatDate(run.started_at)}</SheetDescription>
                  </SheetHeader>
                  <TweetListPanel runId={run.id} tweetCount={run.tweets_fetched} />
                </SheetContent>
              </Sheet>
            ) : (
              <Badge variant="secondary" className="text-xs tabular-nums">
                {run.tweets_fetched} tweets
              </Badge>
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
        <div className={!expanded ? "max-h-[7rem] overflow-hidden relative" : ""}>
          <MarkdownContent content={expanded ? (run.summary ?? "") : body} className="text-sm" />
          {!expanded && (
            <div className="absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-card to-transparent pointer-events-none" />
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 h-auto py-1 text-primary hover:text-primary/80 text-xs font-medium"
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
          <div className="flex items-center gap-2">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground" aria-hidden="true">
              <TrendingUp className="size-4" />
            </div>
            <CardTitle>Générer un résumé mensuel</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <label htmlFor="monthly-year-select" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Année
              </label>
              <Select value={selectedYear} onValueChange={(v) => { setSelectedYear(v); setSelectedMonth(""); }}>
                <SelectTrigger id="monthly-year-select" className="w-[120px] h-9">
                  <SelectValue placeholder="Année" />
                </SelectTrigger>
                <SelectContent>
                  {years.map((y) => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="monthly-month-select" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Mois
              </label>
              <Select value={selectedMonth} onValueChange={setSelectedMonth} disabled={!selectedYear}>
                <SelectTrigger id="monthly-month-select" className="w-[180px] h-9">
                  <SelectValue placeholder="Sélectionner…" />
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
              className="h-9"
            >
              {generating && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {generating ? "Génération…" : "Générer"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {existingSummaries && existingSummaries.length > 0 ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Résumés mensuels générés
            </h2>
            <div className="flex-1 h-px bg-border" aria-hidden="true" />
            <span className="text-xs text-muted-foreground tabular-nums">
              {existingSummaries.length}
            </span>
          </div>
          {existingSummaries.map((ms) => (
            <MonthlySummaryCard key={ms.id} summary={ms} />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-16 flex flex-col items-center gap-4 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted" aria-hidden="true">
              <TrendingUp className="size-5 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="font-medium">Aucun résumé mensuel</p>
              <p className="text-sm text-muted-foreground">
                Sélectionnez un mois ci-dessus pour générer votre premier résumé mensuel.
              </p>
            </div>
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
    <Card className="hover:border-muted-foreground/20 transition-colors">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground" aria-hidden="true">
              <TrendingUp className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-base sm:text-lg leading-none">
                {MONTH_NAMES[summary.month - 1]} {summary.year}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Généré le {formatDate(summary.generated_at)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant="secondary" className="tabular-nums">
              {runIds.length} jour{runIds.length !== 1 ? "s" : ""}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className={!expanded ? "max-h-[6rem] overflow-hidden relative" : ""}>
          <MarkdownContent content={summary.summary ?? ""} className="text-sm" />
          {!expanded && (
            <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-card to-transparent pointer-events-none" />
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 h-auto py-1 text-primary hover:text-primary/80 text-xs font-medium"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Réduire" : "Lire la suite"}
        </Button>
      </CardContent>
    </Card>
  );
}
