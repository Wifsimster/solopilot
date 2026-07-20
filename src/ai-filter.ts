import type { Config } from './config.js';
import type { Item } from './ports.js';
import type { ProductView } from './product-service.js';
import { createAiClient } from './ai-client.js';
import { logger } from './logger.js';

const SYSTEM_PROMPT = `You are a tech news curator. You receive a list of items aggregated from multiple sources (X / Twitter, Reddit, Hacker News and YouTube).

Your task:
1. Identify items related to AI and tech in general (AI, ML, LLMs, generative AI, computer vision, robotics, AI policy, software engineering, programming, open source, cloud, cybersecurity, hardware, startups, developer tools, web, mobile, data, etc.)
2. Write a concise summary (under 2000 characters) in French
3. Structure the digest into top-level sections in this exact order:
   - "X (Twitter)" — bullets covering items from X
   - "Reddit" — bullets covering items from Reddit
   - "Hacker News" — bullets covering items from Hacker News
   - "YouTube" — bullets covering items from YouTube
4. Omit a section entirely if it has zero relevant items.
5. Inside each section, use short bullets. Include clickable source links where available.
6. Use a professional but engaging tone.
7. Start with a title line that includes the date provided by the user (e.g. "📅 VEILLE IA & TECH — 16 mars 2025").
8. If the input contains a "MENTIONS DIRECTES" group, ALWAYS add a final section "📣 MENTIONS" listing EVERY item from that group (short bullet + link). These are direct brand mentions — never drop one for lack of news value; summarize what is said about the brand/product.

Each top-level section header should be on its own line, in bold uppercase (e.g. **X (TWITTER)**, **REDDIT**, **HACKER NEWS**, **YOUTUBE**), separated by blank lines.

If no item across all sources is related to AI or tech AND there is no "MENTIONS DIRECTES" group, respond with exactly: NO_TECH_NEWS_FOUND. As soon as a "MENTIONS DIRECTES" group exists, produce a digest (even if it only contains the 📣 MENTIONS section).`;

/**
 * Builds the digest system prompt. When the product has a theme (description or
 * target audience), the digest is curated, filtered and titled for THAT product's
 * domain — so each product's Discord gets an on-theme digest instead of the same
 * generic AI/tech feed. Products without a theme (e.g. `default`) fall back to the
 * generic AI/tech curator prompt.
 */
function buildSystemPrompt(product?: ProductView): string {
  const hasTheme = product && (product.product_description || product.target_audience);
  if (!hasTheme) return SYSTEM_PROMPT;

  const language = product.content_language === 'en' ? 'English' : 'French';
  const valueProps =
    product.value_props && product.value_props.length > 0
      ? `\n- Value propositions: ${product.value_props.join('; ')}`
      : '';

  return `You are a news & tech curator working for ONE specific product. You receive a list of items aggregated from multiple sources (X / Twitter, Reddit, Hacker News and YouTube).

PRODUCT CONTEXT
- Name: ${product.name}
- Description: ${product.product_description ?? '(n/a)'}
- Target audience: ${product.target_audience ?? '(n/a)'}${valueProps}

Your task:
1. From the items, SELECT ONLY those genuinely relevant to THIS product's domain, its target audience's interests and pain points, its market and competitors, or adjacent themes this audience genuinely cares about. Be strict — drop every item unrelated to this product or its audience, even if it is popular AI/tech news.
2. Write a concise digest (under 2000 characters) in ${language}.
3. Structure the digest into the source sections that have relevant items, in this exact order:
   - "X (Twitter)" — bullets from X
   - "Reddit" — bullets from Reddit
   - "Hacker News" — bullets from Hacker News
   - "YouTube" — bullets from YouTube
   Omit a section entirely if it has zero relevant items. Each top-level header on its own line, in bold uppercase (e.g. **X (TWITTER)**, **REDDIT**, **HACKER NEWS**, **YOUTUBE**), separated by blank lines. Inside each section use short bullets with clickable source links where available.
4. Start with a title line themed to the PRODUCT's domain — NOT a generic "AI & Tech" title — including the date provided by the user. Derive a fitting emoji + theme from the product description (e.g. a gaming product → "🎮 VEILLE GAMING & CULTURE VIDÉOLUDIQUE — <date>", a parenting/health product → "🧩 VEILLE TDAH & PARENTALITÉ — <date>").
5. Use a professional but engaging tone.
6. If the input contains a "MENTIONS DIRECTES" group, ALWAYS add a final section "📣 MENTIONS" listing EVERY item from that group (short bullet + link). These are direct mentions of the product/brand — the relevance rule of step 1 does NOT apply to them; never drop one, summarize what is said about the product.

If NOTHING across all sources is genuinely relevant to this product or its audience AND there is no "MENTIONS DIRECTES" group, respond with exactly: NO_TECH_NEWS_FOUND. Do NOT pad the digest with generic or off-topic items — an empty digest is the expected, correct output when there is no on-theme news. As soon as a "MENTIONS DIRECTES" group exists, produce a digest (even if it only contains the 📣 MENTIONS section).`;
}

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
  const client = createAiClient(config, { timeout: AI_TIMEOUT_MS });

  return { filterAndSummarize, synthesizeMonthlySummary };

  async function filterAndSummarize(
    items: Item[],
    opts: { product?: ProductView; date?: Date } = {},
  ): Promise<string | null> {
    const { product, date } = opts;
    // Brand mentions get their own group, rendered last with an always-include
    // instruction — the news-relevance filter must never drop them.
    const groups: Record<'x' | 'reddit' | 'hn' | 'youtube', Item[]> = {
      x: [],
      reddit: [],
      hn: [],
      youtube: [],
    };
    const mentions: Item[] = [];
    for (const item of items) {
      if (item.origin === 'mention') {
        mentions.push(item);
      } else {
        groups[item.source].push(item);
      }
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
      renderGroup('Hacker News', groups.hn),
      renderGroup('YouTube', groups.youtube),
      renderGroup('MENTIONS DIRECTES', mentions),
    ]
      .filter((s) => s.length > 0)
      .join('\n\n');

    const response = await client.chat.completions.create({
      model: config.AI_MODEL,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: buildSystemPrompt(product) },
        {
          role: 'user',
          content: `Date: ${(date ?? new Date()).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}\n\nVoici les éléments collectés sur les ${config.TWEETS_LOOKBACK_DAYS} derniers jours, groupés par source :\n\n${sections}`,
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
