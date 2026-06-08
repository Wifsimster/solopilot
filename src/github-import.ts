import { z } from 'zod';
import { getDb } from './db.js';
import {
  createProduct,
  listProducts,
  productExists,
  type ProductCreateInput,
} from './product-service.js';
import { logger } from './logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GithubRepoCandidate = {
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
};

export type GithubFetchOpts = {
  username: string;
  includeForks?: boolean;
  includeArchived?: boolean;
  githubToken?: string;
};

export type SkippedRepo = { id: string; reason: string };

export type BulkImportRequest = {
  repos: {
    id: string;
    name: string;
    product_url: string;
    product_description?: string | null;
  }[];
};

export type BulkImportResult = {
  success: true;
  created: number;
  skipped: SkippedRepo[];
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class GithubImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GithubImportError';
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const GITHUB_USERNAME_REGEX = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const GITHUB_SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,62})$/;

export const bulkImportRequestSchema = z.object({
  repos: z
    .array(
      z.object({
        id: z.string().regex(GITHUB_SLUG_REGEX, {
          message: 'Identifiant de depot invalide.',
        }),
        name: z.string().min(1).max(120),
        product_url: z
          .string()
          .url({ message: 'URL invalide.' })
          .refine((u) => u.startsWith('https://github.com/'), {
            message: "L'URL doit commencer par https://github.com/.",
          }),
        product_description: z
          .string()
          .max(2000, { message: 'Description trop longue (max 2000 caracteres).' })
          .nullable(),
      }),
    )
    .min(1, { message: 'Selectionne au moins un depot.' })
    .max(100, { message: 'Trop de depots (max 100).' }),
});

// ---------------------------------------------------------------------------
// Slug helper
// ---------------------------------------------------------------------------

function slugifyRepoName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// GitHub API response shape (only fields we use)
// ---------------------------------------------------------------------------

interface GithubApiRepo {
  name: string;
  description: string | null;
  html_url: string;
  language: string | null;
  stargazers_count: number;
  updated_at: string;
  fork: boolean;
  archived: boolean;
}

// ---------------------------------------------------------------------------
// fetchGithubRepos
// ---------------------------------------------------------------------------

export async function fetchGithubRepos(opts: GithubFetchOpts): Promise<GithubRepoCandidate[]> {
  const { username, includeForks = false, includeArchived = false, githubToken } = opts;

  if (!username || !GITHUB_USERNAME_REGEX.test(username)) {
    throw new GithubImportError(
      "Nom d'utilisateur GitHub invalide (lettres, chiffres et tirets uniquement, 1-39 caracteres, sans tiret initial).",
    );
  }

  const url = `https://api.github.com/users/${encodeURIComponent(
    username,
  )}/repos?type=owner&sort=updated&per_page=100`;

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'solopilot/1.x',
  };
  if (githubToken) {
    headers.Authorization = `Bearer ${githubToken}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  let response: Response;
  try {
    response = await fetch(url, { headers, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new GithubImportError(
        "Delai d'attente depasse en contactant GitHub. Reessaie plus tard.",
      );
    }
    throw new GithubImportError(
      `Erreur reseau en contactant GitHub : ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 404) {
    throw new GithubImportError('Utilisateur GitHub introuvable.');
  }

  if (response.status === 401) {
    throw new GithubImportError('Token GitHub invalide ou expire. Verifie la valeur configuree.');
  }

  if (response.status === 403) {
    const remaining = response.headers.get('x-ratelimit-remaining');
    if (remaining === '0') {
      const resetHeader = response.headers.get('x-ratelimit-reset');
      const resetEpoch = resetHeader ? Number(resetHeader) : NaN;
      if (Number.isFinite(resetEpoch)) {
        const nowSec = Math.floor(Date.now() / 1000);
        const minutes = Math.max(1, Math.ceil((resetEpoch - nowSec) / 60));
        throw new GithubImportError(`Limite GitHub atteinte, reessaie dans ${minutes} minutes.`);
      }
      throw new GithubImportError('Limite GitHub atteinte, reessaie plus tard.');
    }
    if (githubToken) {
      throw new GithubImportError('Token GitHub invalide ou sans les droits suffisants.');
    }
    throw new GithubImportError(
      'Acces GitHub refuse (403). Reessaie plus tard ou configure un token.',
    );
  }

  if (response.status >= 500 && response.status < 600) {
    throw new GithubImportError('GitHub indisponible. Reessaie plus tard.');
  }

  if (!response.ok) {
    throw new GithubImportError(`Erreur GitHub (${response.status}). Reessaie plus tard.`);
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new GithubImportError('Reponse GitHub invalide.');
  }
  if (!Array.isArray(parsed)) {
    throw new GithubImportError('Reponse GitHub invalide.');
  }

  const repos = parsed as GithubApiRepo[];

  const importedIds = new Set(listProducts(true).map((p) => p.id));

  const mapped: GithubRepoCandidate[] = repos.flatMap((r) => {
    if (!includeForks && r.fork) return [];
    if (!includeArchived && r.archived) return [];
    const id = slugifyRepoName(r.name);
    return [
      {
        id,
        name: r.name,
        description: r.description ?? null,
        url: r.html_url,
        language: r.language ?? null,
        stars: typeof r.stargazers_count === 'number' ? r.stargazers_count : 0,
        updated_at: r.updated_at,
        fork: !!r.fork,
        archived: !!r.archived,
        alreadyImported: importedIds.has(id),
      },
    ];
  });

  logger.info('GitHub repos fetched', {
    username,
    count: mapped.length,
    includeForks,
    includeArchived,
  });

  return mapped;
}

// ---------------------------------------------------------------------------
// Repo context (for AI grounding)
// ---------------------------------------------------------------------------

export type GithubRepoContext = {
  description: string | null;
  language: string | null;
  topics: string[];
  readmeExcerpt: string | null;
};

const README_EXCERPT_MAX_CHARS = 4000;

/**
 * Parse a GitHub repository URL into its owner/repo pair. Accepts the canonical
 * `https://github.com/owner/repo` form (with optional `.git`, trailing slash or
 * deeper paths like `/tree/main`), returning `null` for anything that is not a
 * github.com repository URL.
 */
export function parseGithubRepoUrl(url: string): { owner: string; repo: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.hostname !== 'github.com' && parsed.hostname !== 'www.github.com') {
    return null;
  }
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length < 2) return null;
  const owner = segments[0];
  let repo = segments[1];
  if (repo.toLowerCase().endsWith('.git')) repo = repo.slice(0, -4);
  if (!/^[A-Za-z0-9-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repo)) {
    return null;
  }
  return { owner, repo };
}

/**
 * Best-effort fetch of a repository's description, primary language, topics and
 * a README excerpt, used to ground AI suggestions on the product's repo. Returns
 * `null` when the URL is not a GitHub repo or the metadata request fails; README
 * failures are tolerated (the rest of the context is still returned).
 */
export async function fetchGithubRepoContext(
  productUrl: string,
  githubToken?: string,
): Promise<GithubRepoContext | null> {
  const target = parseGithubRepoUrl(productUrl);
  if (!target) return null;
  const { owner, repo } = target;

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'solopilot/1.x',
  };
  if (githubToken) {
    headers.Authorization = `Bearer ${githubToken}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const metaRes = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      { headers, signal: controller.signal },
    );
    if (!metaRes.ok) {
      logger.warn('GitHub repo context metadata fetch failed', {
        owner,
        repo,
        status: metaRes.status,
      });
      return null;
    }
    const meta = (await metaRes.json()) as {
      description?: string | null;
      language?: string | null;
      topics?: string[];
    };

    let readmeExcerpt: string | null = null;
    try {
      const readmeRes = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`,
        {
          headers: { ...headers, Accept: 'application/vnd.github.raw' },
          signal: controller.signal,
        },
      );
      if (readmeRes.ok) {
        const text = await readmeRes.text();
        const trimmed = text.trim();
        if (trimmed) {
          readmeExcerpt =
            trimmed.length > README_EXCERPT_MAX_CHARS
              ? `${trimmed.slice(0, README_EXCERPT_MAX_CHARS)}…`
              : trimmed;
        }
      }
    } catch {
      // README is optional context — ignore failures.
    }

    return {
      description: meta.description ?? null,
      language: meta.language ?? null,
      topics: Array.isArray(meta.topics) ? meta.topics.filter((t) => typeof t === 'string') : [],
      readmeExcerpt,
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      logger.warn('GitHub repo context fetch timed out', { owner, repo });
    } else {
      logger.warn('GitHub repo context fetch failed', {
        owner,
        repo,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// bulkImportProducts
// ---------------------------------------------------------------------------

export function bulkImportProducts(req: BulkImportRequest): BulkImportResult {
  const db = getDb();
  const skipped: SkippedRepo[] = [];
  let created = 0;

  const doImport = db.transaction(() => {
    for (const repo of req.repos) {
      if (productExists(repo.id)) {
        skipped.push({ id: repo.id, reason: 'Produit deja existant' });
        logger.warn('GitHub import skipped', {
          id: repo.id,
          reason: 'Produit deja existant',
        });
        continue;
      }

      // Note: we bypass productCreateSchema here because we deliberately
      // create products with all sources off (the user enables them later).
      // The request shape is already validated upstream via bulkImportRequestSchema.
      const input: ProductCreateInput = {
        id: repo.id,
        name: repo.name,
        product_url: repo.product_url,
        product_description: repo.product_description ?? null,
        x_enabled: false,
        reddit_enabled: false,
        hn_enabled: false,
        intent_enabled: false,
      };

      try {
        createProduct(input);
        created++;
      } catch (err) {
        const reason = (err instanceof Error ? err.message : String(err)).trim();
        skipped.push({ id: repo.id, reason });
        logger.warn('GitHub import skipped', { id: repo.id, reason });
      }
    }
  });

  doImport();

  logger.info('GitHub bulk import complete', {
    candidatesIn: req.repos.length,
    created,
    skipped: skipped.length,
  });

  return { success: true, created, skipped };
}
