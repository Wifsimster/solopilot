import type { Config } from '../../config.js';
import { isAiConfigured, AiError } from '../../ai/index.js';
import { assertWithinBudget } from '../../ai/usage.js';
import { resolveAiProvider } from '../../ai/models.js';
import { getTodayDateParis } from '../../date-utils.js';
import { listProducts, toProductView } from '../../product-service.js';
import { parseGithubRepoUrl } from '../../github-import.js';
import { getSetting, getSettingsMap } from '../../settings-service.js';
import { getVeilleDelivery } from '../../run-service.js';
import { sendDiscordEmbeds, type DiscordEmbed } from '../../adapters/discord-notifier.js';
import { createGithubIssuesConnector } from '../../connectors/github-issues.js';
import type { GithubIssuesConnector } from '../../workflow/types.js';
import { logger } from '../../logger.js';
import {
  consumeCap,
  renderIssueBody,
  renderIssueTitle,
  resolveRadarSettings,
  selectMatches,
  withinCaps,
  sanitizeInline,
  type RadarSettings,
  type RadarSettingsLayer,
} from './radar.js';
import { createRadarAi, toRadarProduct, type RadarAi, type RadarProductInput } from './radar-ai.js';
import {
  claimForManualCreate,
  claimProposal,
  getProposal,
  listRadarCandidates,
  loadCapState,
  markRadarScanned,
  proposalExists,
  updateProposal,
  type RadarCandidateRow,
} from './radar-store.js';

export type RadarSkipReason =
  | 'disabled'
  | 'busy'
  | 'no_ai_key'
  | 'budget_exceeded'
  | 'no_repo_products'
  | 'no_candidates';

export interface RadarProposalSummary {
  id: number;
  productId: string;
  productName: string;
  repo: string;
  score: number;
  title: string | null;
  status: 'dry_run' | 'created' | 'failed' | 'capped';
  issueUrl: string | null;
  error: string | null;
}

export interface RadarResult {
  skipped?: RadarSkipReason;
  dryRun: boolean;
  dryRunReason?: 'setting' | 'no_token';
  scanned: number;
  matches: number;
  proposals: RadarProposalSummary[];
}

export interface RadarDeps {
  ai?: RadarAi;
  github?: GithubIssuesConnector;
  settings?: RadarSettings;
  now?: number;
}

let running = false;

export function isRadarRunning(): boolean {
  return running;
}

export function getRadarSettings(): RadarSettings {
  const settings = resolveRadarSettings(
    process.env as RadarSettingsLayer,
    getSettingsMap() as RadarSettingsLayer,
  );
  for (const warning of settings.warnings) {
    logger.warn('Radar produit setting ignored', { warning });
  }
  return settings;
}

interface RepoProduct extends RadarProductInput {
  owner: string;
  repo: string;
}

export function listRepoProducts(): RepoProduct[] {
  return listProducts(false).flatMap((record) => {
    const target = record.product_url ? parseGithubRepoUrl(record.product_url) : null;
    if (!target) return [];
    return [{ ...toRadarProduct(toProductView(record)), owner: target.owner, repo: target.repo }];
  });
}

function errorMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 500);
}

function toItemInput(row: RadarCandidateRow) {
  return {
    id: row.id,
    source: row.source,
    author: row.author,
    url: row.url,
    text: row.text,
    created_at: row.created_at,
  };
}

export async function runProductRadar(config: Config, deps: RadarDeps = {}): Promise<RadarResult> {
  const settings = deps.settings ?? getRadarSettings();
  const github = deps.github ?? createGithubIssuesConnector(config);
  const tokenMissing = !github.isConfigured();
  const dryRun = settings.dryRun || tokenMissing;
  const base: RadarResult = {
    dryRun,
    ...(dryRun ? { dryRunReason: settings.dryRun ? 'setting' : 'no_token' } : {}),
    scanned: 0,
    matches: 0,
    proposals: [],
  };

  if (!settings.enabled) return { ...base, skipped: 'disabled' };
  if (running) return { ...base, skipped: 'busy' };
  if (!deps.ai && !isAiConfigured(config)) {
    logger.info('Radar produit skipped: no AI key configured');
    return { ...base, skipped: 'no_ai_key' };
  }
  if (!deps.ai) {
    try {
      assertWithinBudget(config, resolveAiProvider(config), 'radar.score');
    } catch (err) {
      if (err instanceof AiError && err.code === 'budget_exceeded') {
        logger.warn('Radar produit skipped: monthly AI budget exhausted');
        return { ...base, skipped: 'budget_exceeded' };
      }
      throw err;
    }
  }

  running = true;
  try {
    if (!settings.dryRun && tokenMissing) {
      logger.warn('Radar produit: GITHUB_ISSUES_TOKEN missing — running in dry-run');
    }

    const products = listRepoProducts();
    if (products.length === 0) return { ...base, skipped: 'no_repo_products' };

    const candidates = listRadarCandidates(deps.now);
    if (candidates.length === 0) return { ...base, skipped: 'no_candidates' };

    const ai = deps.ai ?? createRadarAi(config);
    const matches = await ai.score(candidates.map(toItemInput), products);
    markRadarScanned(
      candidates.map((c) => c.id),
      deps.now,
    );

    const selected = selectMatches(matches, settings.scoreThreshold).filter(
      (m) => !proposalExists(m.itemId, m.productId),
    );
    const byItem = new Map(candidates.map((c) => [c.id, c]));
    const byProduct = new Map(products.map((p) => [p.id, p]));
    const day = getTodayDateParis();
    const caps = loadCapState(day);
    const proposals: RadarProposalSummary[] = [];

    for (const match of selected) {
      const item = byItem.get(match.itemId);
      const product = byProduct.get(match.productId);
      if (!item || !product) continue;
      const repo = `${product.owner}/${product.repo}`;
      const reason = sanitizeInline(match.reason, 500);

      if (!withinCaps(caps, product.id, settings)) {
        const id = claimProposal({
          itemId: item.id,
          productId: product.id,
          repo,
          score: match.score,
          reason,
          day,
          status: 'capped',
        });
        if (id !== null) {
          proposals.push({
            id,
            productId: product.id,
            productName: product.name,
            repo,
            score: match.score,
            title: null,
            status: 'capped',
            issueUrl: null,
            error: null,
          });
        }
        continue;
      }

      const id = claimProposal({
        itemId: item.id,
        productId: product.id,
        repo,
        score: match.score,
        reason,
        day,
        status: 'creating',
      });
      if (id === null) continue;
      consumeCap(caps, product.id);

      const summary: RadarProposalSummary = {
        id,
        productId: product.id,
        productName: product.name,
        repo,
        score: match.score,
        title: null,
        status: 'failed',
        issueUrl: null,
        error: null,
      };
      proposals.push(summary);

      let title: string;
      let body: string;
      try {
        const report = await ai.report(toItemInput(item), product, reason);
        title = renderIssueTitle(report);
        body = renderIssueBody({
          report,
          item,
          productName: product.name,
          score: match.score,
        });
      } catch (err) {
        summary.error = errorMessage(err);
        updateProposal(id, { status: 'failed', error: summary.error });
        logger.warn('Radar produit report generation failed', {
          productId: product.id,
          itemId: item.id,
          error: summary.error,
        });
        continue;
      }
      summary.title = title;

      if (dryRun) {
        updateProposal(id, { status: 'dry_run', title, body });
        summary.status = 'dry_run';
        logger.info('Radar produit proposal (dry-run, no issue created)', {
          productId: product.id,
          repo,
          itemId: item.id,
          score: match.score,
          title,
          reason: base.dryRunReason,
        });
        continue;
      }

      try {
        const issue = await github.createIssue(product.owner, product.repo, { title, body });
        updateProposal(id, {
          status: 'created',
          title,
          body,
          issue_url: issue.url,
          issue_number: issue.number,
        });
        summary.status = 'created';
        summary.issueUrl = issue.url;
        logger.info('Radar produit issue created', { productId: product.id, repo, url: issue.url });
      } catch (err) {
        summary.error = errorMessage(err);
        updateProposal(id, { status: 'failed', title, body, error: summary.error });
        logger.warn('Radar produit issue creation failed', {
          productId: product.id,
          repo,
          error: summary.error,
        });
      }
    }

    const result: RadarResult = {
      ...base,
      scanned: candidates.length,
      matches: selected.length,
      proposals,
    };
    await notifyRadar(config, result);
    logger.info('Radar produit sweep complete', {
      scanned: result.scanned,
      matches: result.matches,
      proposals: proposals.length,
      dryRun,
    });
    return result;
  } finally {
    running = false;
  }
}

export async function createIssueForProposal(
  config: Config,
  proposalId: number,
  deps: { github?: GithubIssuesConnector } = {},
): Promise<{ ok: true; url: string } | { ok: false; status: 400 | 404 | 409 | 502; message: string }> {
  const github = deps.github ?? createGithubIssuesConnector(config);
  const proposal = getProposal(proposalId);
  if (!proposal) return { ok: false, status: 404, message: 'Proposition introuvable.' };
  if (!github.isConfigured()) {
    return {
      ok: false,
      status: 400,
      message: "GITHUB_ISSUES_TOKEN n'est pas configure : impossible de creer l'issue.",
    };
  }
  const [owner, repo] = proposal.repo.split('/');
  if (!owner || !repo) return { ok: false, status: 400, message: 'Depot invalide.' };
  if (!claimForManualCreate(proposalId)) {
    return {
      ok: false,
      status: 409,
      message: "Cette proposition n'est pas (ou plus) en attente de creation.",
    };
  }
  try {
    const issue = await github.createIssue(owner, repo, {
      title: proposal.title ?? '',
      body: proposal.body ?? '',
    });
    updateProposal(proposalId, {
      status: 'created',
      issue_url: issue.url,
      issue_number: issue.number,
      error: null,
    });
    return { ok: true, url: issue.url };
  } catch (err) {
    const message = errorMessage(err);
    updateProposal(proposalId, { status: 'failed', error: message });
    return { ok: false, status: 502, message };
  }
}

const STATUS_LABELS: Record<RadarProposalSummary['status'], string> = {
  created: 'Issue créée',
  dry_run: 'Simulation (aucune issue créée)',
  failed: 'Échec',
  capped: 'Plafond journalier atteint (non générée)',
};

async function notifyRadar(config: Config, result: RadarResult): Promise<void> {
  const notable = result.proposals.filter((p) => p.status !== 'capped');
  if (notable.length === 0) return;
  const webhookUrl =
    getVeilleDelivery().webhookUrl ?? getSetting('DISCORD_WEBHOOK_URL') ?? config.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  const dryRunNote =
    result.dryRunReason === 'no_token'
      ? 'Mode simulation : GITHUB_ISSUES_TOKEN non configuré.'
      : result.dryRunReason === 'setting'
        ? 'Mode simulation activé (Paramètres → Radar produit).'
        : null;

  const embeds: DiscordEmbed[] = notable.slice(0, 10).map((p) => ({
    title: `🛰️ Radar produit — ${p.productName}`.slice(0, 256),
    ...(p.issueUrl ? { url: p.issueUrl } : {}),
    description: [
      `**${p.title ?? '(rapport non généré)'}**`,
      `**Dépôt :** ${p.repo}`,
      `**Pertinence :** ${p.score.toFixed(2)}`,
      `**Statut :** ${STATUS_LABELS[p.status]}`,
      ...(p.issueUrl ? [`[Voir l'issue](${p.issueUrl})`] : []),
      ...(p.error ? [`**Erreur :** ${p.error}`] : []),
      ...(dryRunNote && p.status === 'dry_run' ? ['', dryRunNote] : []),
    ].join('\n'),
    color: p.status === 'created' ? 0x57f287 : p.status === 'failed' ? 0xed4245 : 0x5865f2,
    timestamp: new Date().toISOString(),
  }));
  const sent = await sendDiscordEmbeds(webhookUrl, embeds);
  if (!sent.success) {
    logger.warn('Radar produit Discord notification failed', { error: sent.error });
  }
}
