/**
 * GitHub Issues connector (write) — Radar produit, ADR-0026.
 *
 * Uses ONLY `GITHUB_ISSUES_TOKEN` (fine-grained, Issues: read & write on the
 * product repos). The GitHub Models inference token (`GITHUB_TOKEN`) is never
 * used here. When the token is absent, `isConfigured()` is false and callers
 * must stay in dry-run.
 */
import type { Config } from '../config.js';
import { logger } from '../logger.js';
import type { GithubIssuesConnector } from '../workflow/types.js';

const GITHUB_API = 'https://api.github.com';
const TIMEOUT_MS = 15_000;

export const RADAR_LABEL = {
  name: 'veille',
  color: '1d76db',
  description: 'Proposition issue de la veille Solopilot (Radar produit)',
} as const;

export class GithubIssuesError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'GithubIssuesError';
  }
}

/** Token resolution: env/config only — never the DB, never GITHUB_TOKEN. */
export function resolveIssuesToken(config: Pick<Config, 'GITHUB_ISSUES_TOKEN'>): string | undefined {
  const token = config.GITHUB_ISSUES_TOKEN?.trim();
  return token ? token : undefined;
}

async function call(
  token: string,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${GITHUB_API}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'solopilot/1.x',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new GithubIssuesError("Delai d'attente depasse en contactant GitHub.");
    }
    throw new GithubIssuesError(
      `Erreur reseau GitHub : ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function repoPath(owner: string, repo: string): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

function describeStatus(status: number): string {
  if (status === 401) return 'Token GitHub invalide ou expire (GITHUB_ISSUES_TOKEN).';
  if (status === 403) return 'Token GitHub sans droit Issues: write sur ce depot.';
  if (status === 404) return 'Depot introuvable ou inaccessible avec ce token.';
  if (status === 410) return 'Les issues sont desactivees sur ce depot.';
  if (status === 422) return 'GitHub a refuse le contenu de l issue (422).';
  return `Erreur GitHub (${status}).`;
}

export function createGithubIssuesConnector(
  config: Pick<Config, 'GITHUB_ISSUES_TOKEN'>,
): GithubIssuesConnector {
  const token = resolveIssuesToken(config);

  /** Ensures the `veille` label exists. Returns false when it can't (no permission...). */
  async function ensureLabel(owner: string, repo: string): Promise<boolean> {
    if (!token) return false;
    try {
      const existing = await call(
        token,
        'GET',
        `${repoPath(owner, repo)}/labels/${encodeURIComponent(RADAR_LABEL.name)}`,
      );
      if (existing.ok) return true;
      if (existing.status !== 404) return false;
      const created = await call(token, 'POST', `${repoPath(owner, repo)}/labels`, RADAR_LABEL);
      // 422 = created concurrently (already_exists) — usable either way.
      return created.ok || created.status === 422;
    } catch (err) {
      logger.warn('GitHub label check failed, issue will be created without label', {
        owner,
        repo,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  return {
    isConfigured: () => token !== undefined,
    async createIssue(owner, repo, issue) {
      if (!token) throw new GithubIssuesError('GITHUB_ISSUES_TOKEN non configure.');
      const labelOk = await ensureLabel(owner, repo);
      const res = await call(token, 'POST', `${repoPath(owner, repo)}/issues`, {
        title: issue.title,
        body: issue.body,
        ...(labelOk ? { labels: [RADAR_LABEL.name] } : {}),
      });
      if (!res.ok) throw new GithubIssuesError(describeStatus(res.status), res.status);
      const data = (await res.json().catch(() => null)) as {
        number?: unknown;
        html_url?: unknown;
      } | null;
      if (!data || typeof data.number !== 'number' || typeof data.html_url !== 'string') {
        throw new GithubIssuesError('Reponse GitHub invalide.');
      }
      return { number: data.number, url: data.html_url, labeled: labelOk };
    },
  };
}
