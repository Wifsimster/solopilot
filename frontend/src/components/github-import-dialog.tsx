import { useReducer } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { ExternalLink, Loader2, Star } from 'lucide-react';
import { cn } from '@/lib/utils';

const USERNAME_STORAGE_KEY = 'githubImportUsername';
const DESCRIPTION_TRUNCATE = 120;

export interface GithubRepoCandidate {
  id: string;
  name: string;
  description: string | null;
  url: string;
  language: string | null;
  stars: number;
  updated_at: string;
  fork: boolean;
  archived: boolean;
  alreadyImported: boolean;
}

interface SkippedRepo {
  id: string;
  reason: string;
}

interface GithubImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: () => void;
}

type Step = 'username' | 'repos';

interface ImportState {
  step: Step;
  username: string;
  includeForks: boolean;
  includeArchived: boolean;
  repos: GithubRepoCandidate[];
  selected: Set<string>;
  loading: boolean;
  importing: boolean;
  error: string | null;
}

type ImportAction =
  | { type: 'setUsername'; value: string }
  | { type: 'setIncludeForks'; value: boolean }
  | { type: 'setIncludeArchived'; value: boolean }
  | { type: 'fetchStart' }
  | { type: 'fetchError'; message: string }
  | { type: 'fetchSuccess'; repos: GithubRepoCandidate[] }
  | { type: 'importStart' }
  | { type: 'importError'; message: string }
  | { type: 'importDone' }
  | { type: 'toggleRepo'; id: string }
  | { type: 'toggleAll'; ids: string[]; allSelected: boolean };

function readStoredUsername(): string {
  try {
    return window.localStorage.getItem(USERNAME_STORAGE_KEY) ?? '';
  } catch {
    // Ignore — localStorage may be unavailable.
    return '';
  }
}

function createInitialState(): ImportState {
  return {
    step: 'username',
    username: readStoredUsername(),
    includeForks: false,
    includeArchived: false,
    repos: [],
    selected: new Set<string>(),
    loading: false,
    importing: false,
    error: null,
  };
}

function importReducer(state: ImportState, action: ImportAction): ImportState {
  switch (action.type) {
    case 'setUsername':
      return { ...state, username: action.value };
    case 'setIncludeForks':
      return { ...state, includeForks: action.value };
    case 'setIncludeArchived':
      return { ...state, includeArchived: action.value };
    case 'fetchStart':
      return { ...state, loading: true, error: null };
    case 'fetchError':
      return { ...state, loading: false, error: action.message };
    case 'fetchSuccess': {
      // Preserve current selection but drop ids that are no longer present
      // or that are already imported (cannot be selected).
      const next = new Set<string>();
      for (const r of action.repos) {
        if (state.selected.has(r.id) && !r.alreadyImported) next.add(r.id);
      }
      return {
        ...state,
        loading: false,
        repos: action.repos,
        selected: next,
        step: 'repos',
      };
    }
    case 'importStart':
      return { ...state, importing: true, error: null };
    case 'importError':
      return { ...state, importing: false, error: action.message };
    case 'importDone':
      return { ...state, importing: false };
    case 'toggleRepo': {
      const next = new Set(state.selected);
      if (next.has(action.id)) next.delete(action.id);
      else next.add(action.id);
      return { ...state, selected: next };
    }
    case 'toggleAll':
      return {
        ...state,
        selected: action.allSelected ? new Set<string>() : new Set(action.ids),
      };
    default:
      return state;
  }
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max).trimEnd()}…`;
}

function formatRelativeFr(iso: string): string {
  const ts = Date.parse(iso);
  if (isNaN(ts)) return '—';
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 60) return 'à l’instant';
  const minutes = Math.floor(diffSec / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `il y a ${days} j`;
  const months = Math.floor(days / 30);
  if (months < 12) return `il y a ${months} mois`;
  const years = Math.floor(days / 365);
  return `il y a ${years} an${years > 1 ? 's' : ''}`;
}

export function GithubImportDialog({
  open,
  onOpenChange,
  onImported,
}: GithubImportDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        {/* Remount the body each time the dialog opens so its state is
            initialized fresh from props/localStorage — no prop-sync effect. */}
        {open && (
          <GithubImportDialogBody
            key={open ? 'open' : 'closed'}
            onOpenChange={onOpenChange}
            onImported={onImported}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function GithubImportDialogBody({
  onOpenChange,
  onImported,
}: Omit<GithubImportDialogProps, 'open'>) {
  const [state, dispatch] = useReducer(importReducer, undefined, createInitialState);
  const {
    step,
    username,
    includeForks,
    includeArchived,
    repos,
    selected,
    loading,
    importing,
    error,
  } = state;

  const fetchRepos = async (
    user: string,
    forks: boolean,
    archived: boolean,
  ): Promise<void> => {
    dispatch({ type: 'fetchStart' });
    try {
      const params = new URLSearchParams({
        username: user,
        includeForks: String(forks),
        includeArchived: String(archived),
      });
      const res = await fetch(`/api/github-import/repos?${params.toString()}`);
      const data = await res.json();
      if (!res.ok || data.success === false) {
        const message = data?.message || `Erreur HTTP ${res.status}`;
        toast.error(message);
        dispatch({ type: 'fetchError', message });
        return;
      }
      const fetched: GithubRepoCandidate[] = data.repos ?? [];
      dispatch({ type: 'fetchSuccess', repos: fetched });
      try {
        window.localStorage.setItem(USERNAME_STORAGE_KEY, user);
      } catch {
        // Ignore.
      }
    } catch {
      const message = 'Erreur réseau lors du chargement des repos.';
      toast.error(message);
      dispatch({ type: 'fetchError', message });
    }
  };

  const handleUsernameSubmit = async (
    e: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    e.preventDefault();
    const trimmed = username.trim();
    if (!trimmed) return;
    await fetchRepos(trimmed, includeForks, includeArchived);
  };

  const handleToggleForks = async (next: boolean): Promise<void> => {
    dispatch({ type: 'setIncludeForks', value: next });
    if (step === 'repos') {
      await fetchRepos(username.trim(), next, includeArchived);
    }
  };

  const handleToggleArchived = async (next: boolean): Promise<void> => {
    dispatch({ type: 'setIncludeArchived', value: next });
    if (step === 'repos') {
      await fetchRepos(username.trim(), includeForks, next);
    }
  };

  const selectableRepos = repos.filter((r) => !r.alreadyImported);
  const allSelected =
    selectableRepos.length > 0 &&
    selectableRepos.every((r) => selected.has(r.id));

  const toggleRepo = (id: string): void => {
    dispatch({ type: 'toggleRepo', id });
  };

  const toggleAll = (): void => {
    dispatch({
      type: 'toggleAll',
      ids: selectableRepos.map((r) => r.id),
      allSelected,
    });
  };

  const handleImport = async (): Promise<void> => {
    if (selected.size === 0) return;
    dispatch({ type: 'importStart' });
    try {
      const payload = {
        repos: repos.reduce<
          {
            id: string;
            name: string;
            product_url: string;
            product_description: string | null;
          }[]
        >((acc, r) => {
          if (selected.has(r.id)) {
            acc.push({
              id: r.id,
              name: r.name,
              product_url: r.url,
              product_description: r.description,
            });
          }
          return acc;
        }, []),
      };
      const res = await fetch('/api/github-import/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) {
        const message = data?.message || `Erreur HTTP ${res.status}`;
        toast.error(message);
        dispatch({ type: 'importError', message });
        return;
      }
      const created: number = data.created ?? 0;
      const skipped: SkippedRepo[] = data.skipped ?? [];
      const skippedCount = skipped.length;
      toast.success(
        `${created} produit${created !== 1 ? 's' : ''} importé${created !== 1 ? 's' : ''}. ${skippedCount} ignoré${skippedCount !== 1 ? 's' : ''}.`,
      );
      onImported?.();
      onOpenChange(false);
    } catch {
      const message = "Erreur réseau lors de l'import.";
      toast.error(message);
      dispatch({ type: 'importError', message });
    } finally {
      dispatch({ type: 'importDone' });
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Importer depuis GitHub</DialogTitle>
        <DialogDescription>
          {step === 'username'
            ? 'Entre un nom d’utilisateur GitHub pour lister ses repos publics.'
            : `Sélectionne les repos à importer comme produits${username ? ` pour @${username.trim()}` : ''}.`}
        </DialogDescription>
      </DialogHeader>

      {step === 'username' ? (
        <UsernameStep
          username={username}
          loading={loading}
          error={error}
          onUsernameChange={(value) => dispatch({ type: 'setUsername', value })}
          onSubmit={handleUsernameSubmit}
          onCancel={() => onOpenChange(false)}
        />
      ) : (
        <ReposStep
          repos={repos}
          selected={selected}
          selectableRepos={selectableRepos}
          allSelected={allSelected}
          includeForks={includeForks}
          includeArchived={includeArchived}
          loading={loading}
          importing={importing}
          error={error}
          onToggleForks={handleToggleForks}
          onToggleArchived={handleToggleArchived}
          onToggleAll={toggleAll}
          onToggleRepo={toggleRepo}
          onImport={handleImport}
          onCancel={() => onOpenChange(false)}
        />
      )}
    </>
  );
}

interface UsernameStepProps {
  username: string;
  loading: boolean;
  error: string | null;
  onUsernameChange: (value: string) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}

function UsernameStep({
  username,
  loading,
  error,
  onUsernameChange,
  onSubmit,
  onCancel,
}: UsernameStepProps) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="github-username">Nom d’utilisateur GitHub</Label>
        <Input
          id="github-username"
          value={username}
          onChange={(e) => onUsernameChange(e.target.value)}
          placeholder="wifsimster"
          autoFocus
          autoComplete="off"
        />
      </div>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={loading}
        >
          Annuler
        </Button>
        <Button type="submit" disabled={!username.trim() || loading}>
          {loading ? (
            <>
              <Loader2 className="size-4 mr-1 animate-spin" />
              Chargement…
            </>
          ) : (
            'Charger mes repos'
          )}
        </Button>
      </DialogFooter>
    </form>
  );
}

interface ReposStepProps {
  repos: GithubRepoCandidate[];
  selected: Set<string>;
  selectableRepos: GithubRepoCandidate[];
  allSelected: boolean;
  includeForks: boolean;
  includeArchived: boolean;
  loading: boolean;
  importing: boolean;
  error: string | null;
  onToggleForks: (next: boolean) => void;
  onToggleArchived: (next: boolean) => void;
  onToggleAll: () => void;
  onToggleRepo: (id: string) => void;
  onImport: () => void;
  onCancel: () => void;
}

function ReposStep({
  repos,
  selected,
  selectableRepos,
  allSelected,
  includeForks,
  includeArchived,
  loading,
  importing,
  error,
  onToggleForks,
  onToggleArchived,
  onToggleAll,
  onToggleRepo,
  onImport,
  onCancel,
}: ReposStepProps) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
        <div className="flex flex-wrap items-center gap-4">
          <label
            htmlFor="gh-include-forks"
            className="flex items-center gap-2 text-sm cursor-pointer"
          >
            <Switch
              id="gh-include-forks"
              checked={includeForks}
              onCheckedChange={onToggleForks}
              disabled={loading || importing}
              aria-label="Inclure les forks"
            />
            <span>Inclure les forks</span>
          </label>
          <label
            htmlFor="gh-include-archived"
            className="flex items-center gap-2 text-sm cursor-pointer"
          >
            <Switch
              id="gh-include-archived"
              checked={includeArchived}
              onCheckedChange={onToggleArchived}
              disabled={loading || importing}
              aria-label="Inclure les archivés"
            />
            <span>Inclure les archivés</span>
          </label>
        </div>
        <button
          type="button"
          onClick={onToggleAll}
          disabled={loading || importing || selectableRepos.length === 0}
          className="text-sm text-primary hover:underline disabled:opacity-50 disabled:no-underline disabled:cursor-not-allowed"
        >
          {allSelected ? 'Désélectionner tout' : 'Sélectionner tout'}
        </button>
      </div>

      <div className="max-h-[50vh] overflow-y-auto rounded-lg border">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Chargement…
          </div>
        ) : repos.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Aucun repo trouvé pour ce username.
          </div>
        ) : (
          <ul className="divide-y">
            {repos.map((repo) => (
              <RepoRow
                key={repo.id}
                repo={repo}
                checked={selected.has(repo.id)}
                importing={importing}
                onToggle={onToggleRepo}
              />
            ))}
          </ul>
        )}
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <DialogFooter className="items-center sm:justify-between sm:space-x-0 gap-2">
        <span className="text-sm text-muted-foreground">
          {selected.size} produit{selected.size !== 1 ? 's' : ''} sélectionné
          {selected.size !== 1 ? 's' : ''}
        </span>
        <div className="flex flex-col-reverse sm:flex-row gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={importing}
          >
            Annuler
          </Button>
          <Button
            type="button"
            onClick={onImport}
            disabled={selected.size === 0 || importing || loading}
          >
            {importing ? (
              <>
                <Loader2 className="size-4 mr-1 animate-spin" />
                Import…
              </>
            ) : (
              `Importer ${selected.size} produit${selected.size !== 1 ? 's' : ''}`
            )}
          </Button>
        </div>
      </DialogFooter>
    </div>
  );
}

interface RepoRowProps {
  repo: GithubRepoCandidate;
  checked: boolean;
  importing: boolean;
  onToggle: (id: string) => void;
}

function RepoRow({ repo, checked, importing, onToggle }: RepoRowProps) {
  const disabled = repo.alreadyImported;
  const checkboxId = `gh-repo-${repo.id}`;
  return (
    <li
      className={cn(
        'flex items-start gap-3 p-3 transition-colors',
        disabled ? 'opacity-60 bg-muted/30' : 'hover:bg-muted/30',
      )}
    >
      <input
        id={checkboxId}
        type="checkbox"
        checked={checked}
        disabled={disabled || importing}
        onChange={() => onToggle(repo.id)}
        className="mt-1 size-4 rounded border-input accent-primary disabled:cursor-not-allowed"
        aria-label={`Sélectionner ${repo.name}`}
      />
      <label
        htmlFor={checkboxId}
        className={cn('flex-1 min-w-0 space-y-1', !disabled && 'cursor-pointer')}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{repo.name}</span>
          <a
            href={repo.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground transition-colors"
            title={repo.url}
            aria-label={`Ouvrir ${repo.name} sur GitHub`}
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="size-3.5" />
          </a>
          {repo.alreadyImported && (
            <Badge variant="outline" className="text-xs">
              Déjà importé
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {repo.description
            ? truncate(repo.description, DESCRIPTION_TRUNCATE)
            : '(pas de description)'}
        </p>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {repo.language && (
            <Badge variant="secondary" className="text-xs">
              {repo.language}
            </Badge>
          )}
          {repo.stars > 0 && (
            <Badge
              variant="secondary"
              className="text-xs gap-1"
              title={`${repo.stars} étoile${repo.stars > 1 ? 's' : ''}`}
            >
              <Star className="size-3" />
              {repo.stars}
            </Badge>
          )}
          {repo.fork && (
            <Badge variant="outline" className="text-xs">
              Fork
            </Badge>
          )}
          {repo.archived && (
            <Badge variant="outline" className="text-xs">
              Archivé
            </Badge>
          )}
          <span className="text-muted-foreground">
            Mis à jour {formatRelativeFr(repo.updated_at)}
          </span>
        </div>
      </label>
    </li>
  );
}
