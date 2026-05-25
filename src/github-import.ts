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
        id: z
          .string()
          .regex(GITHUB_SLUG_REGEX, {
            message: 'Identifiant de depot invalide.',
          }),
        name: z.string().min(1).max(120),
        product_url: z
          .string()
          .url({ message: 'URL invalide.' })
          .refine((u) => u.startsWith('https://github.com/'), {
            message: 'L\'URL doit commencer par https://github.com/.',
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

export function slugifyRepoName(name: string): string {
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

export async function fetchGithubRepos(
  opts: GithubFetchOpts,
): Promise<GithubRepoCandidate[]> {
  const { username, includeForks = false, includeArchived = false, githubToken } = opts;

  if (!username || !GITHUB_USERNAME_REGEX.test(username)) {
    throw new GithubImportError(
      'Nom d\'utilisateur GitHub invalide (lettres, chiffres et tirets uniquement, 1-39 caracteres, sans tiret initial).',
    );
  }

  const url = `https://api.github.com/users/${encodeURIComponent(
    username,
  )}/repos?type=owner&sort=updated&per_page=100`;

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'x-ai-weekly-bot/1.x',
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
        'Delai d\'attente depasse en contactant GitHub. Reessaie plus tard.',
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
    throw new GithubImportError(
      'Token GitHub invalide ou expire. Verifie la valeur configuree.',
    );
  }

  if (response.status === 403) {
    const remaining = response.headers.get('x-ratelimit-remaining');
    if (remaining === '0') {
      const resetHeader = response.headers.get('x-ratelimit-reset');
      const resetEpoch = resetHeader ? Number(resetHeader) : NaN;
      if (Number.isFinite(resetEpoch)) {
        const nowSec = Math.floor(Date.now() / 1000);
        const minutes = Math.max(1, Math.ceil((resetEpoch - nowSec) / 60));
        throw new GithubImportError(
          `Limite GitHub atteinte, reessaie dans ${minutes} minutes.`,
        );
      }
      throw new GithubImportError('Limite GitHub atteinte, reessaie plus tard.');
    }
    if (githubToken) {
      throw new GithubImportError(
        'Token GitHub invalide ou sans les droits suffisants.',
      );
    }
    throw new GithubImportError(
      'Acces GitHub refuse (403). Reessaie plus tard ou configure un token.',
    );
  }

  if (response.status >= 500 && response.status < 600) {
    throw new GithubImportError('GitHub indisponible. Reessaie plus tard.');
  }

  if (!response.ok) {
    throw new GithubImportError(
      `Erreur GitHub (${response.status}). Reessaie plus tard.`,
    );
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

  const mapped: GithubRepoCandidate[] = repos
    .filter((r) => (includeForks ? true : !r.fork))
    .filter((r) => (includeArchived ? true : !r.archived))
    .map((r) => {
      const id = slugifyRepoName(r.name);
      return {
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
      };
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
