import OpenAI from 'openai';
import type { Config } from './config.js';
import type { Item } from './ports.js';
import { logger } from './logger.js';

const SYSTEM_PROMPT = `You are a tech news curator. You receive a list of items aggregated from multiple sources (X / Twitter and Reddit).

Your task:
1. Identify items related to AI and tech in general (AI, ML, LLMs, generative AI, computer vision, robotics, AI policy, software engineering, programming, open source, cloud, cybersecurity, hardware, startups, developer tools, web, mobile, data, etc.)
2. Write a concise summary (under 2000 characters) in French
3. Structure the digest into two top-level sections in this exact order:
   - "X (Twitter)" — bullets covering items from X
   - "Reddit" — bullets covering items from Reddit
4. Omit a section entirely if it has zero relevant items.
5. Inside each section, use short bullets. Include clickable source links where available.
6. Use a professional but engaging tone.
7. Start with a title line that includes the date provided by the user (e.g. "📅 VEILLE IA & TECH — 16 mars 2025").

Each top-level section header should be on its own line, in bold uppercase (e.g. **X (TWITTER)**, **REDDIT**), separated by blank lines.

If no item across all sources is related to AI or tech, respond with exactly: NO_TECH_NEWS_FOUND`;

const MONTHLY_SYSTEM_PROMPT = `You are a tech news analyst. You receive several daily AI & tech news summaries.

Your task:
1. Synthesize these daily summaries into a coherent monthly overview in French
2. Identify the major trends and recurring themes across weeks
3. Highlight the most significant developments of the month
4. Note any emerging patterns or shifts in the AI and tech landscape
5. Keep the summary under 3000 characters

Format your response with clear sections using bold uppercase theme headers.
Start with a brief introduction summarizing the month's highlights.
End with a "TENDANCES DU MOIS" section highlighting key trends.
Use a professional but engaging tone.`;

const AI_TIMEOUT_MS = 60_000;

export function createAIFilter(config: Config) {
  const client = new OpenAI({
    baseURL: 'https://models.github.ai/inference',
    apiKey: config.GITHUB_TOKEN,
    timeout: AI_TIMEOUT_MS,
  });

  return { filterAndSummarize, synthesizeMonthlySummary };

  async function filterAndSummarize(items: Item[], dateOverride?: Date): Promise<string | null> {
    const groups: Record<'x' | 'reddit', Item[]> = { x: [], reddit: [] };
    for (const item of items) {
      groups[item.source].push(item);
    }

    const renderGroup = (label: string, group: Item[]) => {
      if (group.length === 0) return '';
      const lines = group
        .map((it, i) => {
          const sourceUrl = it.url ? `\nLien: ${it.url}` : '';
          const extraUrls = it.urls.length > 0 ? `\nURLs: ${it.urls.join(', ')}` : '';
          const author = it.author ? ` (${it.author})` : '';
          return `[${i + 1}]${author} ${it.text}${sourceUrl}${extraUrls}`;
        })
        .join('\n\n');
      return `=== ${label} (${group.length}) ===\n${lines}`;
    };

    const sections = [
      renderGroup('X (Twitter)', groups.x),
      renderGroup('Reddit', groups.reddit),
    ]
      .filter((s) => s.length > 0)
      .join('\n\n');

    const response = await client.chat.completions.create({
      model: config.AI_MODEL,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Date: ${(dateOverride ?? new Date()).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}\n\nVoici les éléments collectés sur les ${config.TWEETS_LOOKBACK_DAYS} derniers jours, groupés par source :\n\n${sections}`,
        },
      ],
    });

    const text = response.choices[0]?.message?.content ?? '';

    logger.info('GitHub Models API usage', {
      inputTokens: response.usage?.prompt_tokens,
      outputTokens: response.usage?.completion_tokens,
      model: response.model,
    });

    if (text.trim() === 'NO_TECH_NEWS_FOUND') {
      logger.info('No AI/tech-related news found in tweets');
      return null;
    }

    return text.trim();
  }

  async function synthesizeMonthlySummary(
    weeklySummaries: string[],
    year: number,
    month: number,
  ): Promise<string | null> {
    const monthNames = [
      'janvier',
      'février',
      'mars',
      'avril',
      'mai',
      'juin',
      'juillet',
      'août',
      'septembre',
      'octobre',
      'novembre',
      'décembre',
    ];

    const summaryTexts = weeklySummaries
      .map((s, i) => `[Jour ${i + 1}]\n${s}`)
      .join('\n\n---\n\n');

    const response = await client.chat.completions.create({
      model: config.AI_MODEL,
      max_tokens: 2048,
      messages: [
        { role: 'system', content: MONTHLY_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Voici les résumés quotidiens IA & tech du mois de ${monthNames[month - 1]} ${year} (${weeklySummaries.length} jours) :\n\n${summaryTexts}`,
        },
      ],
    });

    const text = response.choices[0]?.message?.content ?? '';

    logger.info('Monthly summary API usage', {
      inputTokens: response.usage?.prompt_tokens,
      outputTokens: response.usage?.completion_tokens,
      model: response.model,
    });

    return text.trim() || null;
  }
}
