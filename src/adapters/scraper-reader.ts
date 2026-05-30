import { z } from 'zod';
import type { Config } from '../config.js';
import type { Item, TweetReader } from '../ports.js';
import { isXUrl } from '../ports.js';
import { logger } from '../logger.js';
import { DEFAULT_PRODUCT_ID } from '../db.js';

// Public bearer token embedded in X's web app JavaScript bundle
const BEARER_TOKEN =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

/** Default GraphQL query IDs — used as fallbacks when not overridden */
export const DEFAULT_GQL_IDS = {
  UserByScreenName: 'pLsOiyHJ1eFwPJlNmLp4Bg',
  HomeLatestTimeline: 'ulQKqowrFU94KfUAZqgGvg',
} as const;

// Feature flags for UserByScreenName — updated to match X's current API
const USER_FEATURES = {
  hidden_profile_subscriptions_enabled: true,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: false,
  rweb_tipjar_consumption_enabled: false,
  verified_phone_label_enabled: false,
  subscriptions_verification_info_is_identity_verified_enabled: true,
  subscriptions_verification_info_verified_since_enabled: true,
  highlights_tweets_tab_ui_enabled: true,
  responsive_web_twitter_article_notes_tab_enabled: true,
  subscriptions_feature_can_gift_premium: true,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
};

const USER_FEATURES_ENCODED = encodeURIComponent(JSON.stringify(USER_FEATURES));

const USER_FIELD_TOGGLES = {
  withPayments: false,
  withAuxiliaryUserLabels: true,
};

const USER_FIELD_TOGGLES_ENCODED = encodeURIComponent(JSON.stringify(USER_FIELD_TOGGLES));

/** Build browser-like headers required by X's API */
function browserHeaders(authToken: string, csrfToken: string): Record<string, string> {
  return {
    accept: '*/*',
    'accept-language': 'en-US,en;q=0.9',
    authorization: `Bearer ${BEARER_TOKEN}`,
    'content-type': 'application/json',
    cookie: `auth_token=${authToken}; ct0=${csrfToken}`,
    referer: 'https://x.com/',
    'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'x-csrf-token': csrfToken,
    'x-twitter-active-user': 'yes',
    'x-twitter-auth-type': 'OAuth2Session',
    'x-twitter-client-language': 'en',
  };
}

// Feature flags for timeline queries
const TIMELINE_FEATURES = {
  rweb_tipjar_consumption_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  rweb_video_timestamps_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_enhance_cards_enabled: false,
};

const TIMELINE_FEATURES_ENCODED = encodeURIComponent(JSON.stringify(TIMELINE_FEATURES));

// Zod schema for validating tweet data from the GraphQL response
const tweetLegacySchema = z.object({
  id_str: z.string(),
  full_text: z.string(),
  created_at: z.string(),
  entities: z.object({
    urls: z.array(z.object({ expanded_url: z.string().optional() })).default([]),
  }),
  retweeted_status_result: z.unknown().optional(),
});

function extractAuthorHandle(tweetResult: Record<string, unknown>): string | undefined {
  const handle = getNestedValue(tweetResult, [
    'core',
    'user_results',
    'result',
    'legacy',
    'screen_name',
  ]) as string | undefined;
  if (typeof handle === 'string' && handle.length > 0) return handle;
  const altHandle = getNestedValue(tweetResult, [
    'tweet',
    'core',
    'user_results',
    'result',
    'legacy',
    'screen_name',
  ]) as string | undefined;
  return typeof altHandle === 'string' && altHandle.length > 0 ? altHandle : undefined;
}

export async function validateXCookies(
  authToken: string,
  csrfToken: string,
  username: string,
  gqlId?: string,
): Promise<{ valid: boolean; error?: string }> {
  const headers: Record<string, string> = {
    ...browserHeaders(authToken, csrfToken),
  };

  const variables = JSON.stringify({
    screen_name: username,
    withGrokTranslatedBio: false,
  });

  const queryId = gqlId ?? DEFAULT_GQL_IDS.UserByScreenName;
  const url = `https://x.com/i/api/graphql/${queryId}/UserByScreenName?variables=${encodeURIComponent(variables)}&features=${USER_FEATURES_ENCODED}&fieldToggles=${USER_FIELD_TOGGLES_ENCODED}`;

  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return { valid: false, error: 'Cookies invalides ou expirés' };
      }
      return { valid: false, error: `HTTP ${response.status}: ${response.statusText}` };
    }
    const json = (await response.json()) as Record<string, unknown>;
    const userId = getNestedValue(json, ['data', 'user', 'result', 'rest_id']);
    if (typeof userId !== 'string') {
      return { valid: false, error: 'Utilisateur non trouvé ou structure de réponse modifiée' };
    }
    return { valid: true };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface GqlIdPersister {
  save(key: 'X_GQL_USER_BY_SCREEN_NAME_ID' | 'X_GQL_HOME_TIMELINE_ID', value: string): void;
}

export function createScraperReader(config: Config, persister?: GqlIdPersister): TweetReader {
  const authToken = config.X_SESSION_AUTH_TOKEN;
  const csrfToken = config.X_SESSION_CSRF_TOKEN;

  if (!authToken || !csrfToken) {
    throw new Error(
      'Session cookies X non configurés. Mettez-les à jour dans Paramètres > Session Cookies.',
    );
  }

  const headers: Record<string, string> = {
    ...browserHeaders(authToken, csrfToken),
  };

  // Mutable IDs — updated in-place when auto-detection kicks in
  let userByScreenNameId = config.X_GQL_USER_BY_SCREEN_NAME_ID ?? DEFAULT_GQL_IDS.UserByScreenName;
  let homeTimelineId = config.X_GQL_HOME_TIMELINE_ID ?? DEFAULT_GQL_IDS.HomeLatestTimeline;

  const MAX_PAGES = 10;
  const FETCH_TIMEOUT_MS = 30_000;

  return {
    source: 'x',
    fetchRecentTweets: () => fetchRecentItems(DEFAULT_PRODUCT_ID, 0),
    fetchSince: (productId, sinceTs) => fetchRecentItems(productId, sinceTs),
  };

  async function fetchRecentItems(productId: string, sinceTs: number): Promise<Item[]> {
    const lookbackStart = new Date();
    lookbackStart.setDate(lookbackStart.getDate() - config.TWEETS_LOOKBACK_DAYS);
    const sinceDate = sinceTs > 0 ? new Date(sinceTs * 1000) : lookbackStart;
    const startTime = sinceDate > lookbackStart ? sinceDate : lookbackStart;

    const items: Item[] = [];
    let cursor: string | undefined;
    let page = 0;
    const stats = {
      raw: 0,
      parsed: 0,
      droppedNoResult: 0,
      droppedNoLegacy: 0,
      droppedSchemaFail: 0,
      droppedRtUnparseable: 0,
      droppedTombstone: 0,
      droppedException: 0,
    };

    while (page < MAX_PAGES) {
      page++;
      const { entries, nextCursor } = await fetchHomeTimelinePage(cursor);

      if (entries.length === 0) break;

      stats.raw += entries.length;
      let reachedLookbackLimit = false;
      for (const entry of entries) {
        const item = parseTweetEntry(entry, stats, productId);
        if (!item) continue;

        if (new Date(item.createdAt) < startTime) {
          reachedLookbackLimit = true;
          break;
        }

        items.push(item);
        stats.parsed++;
      }

      if (reachedLookbackLimit) break;

      if (!nextCursor || nextCursor === cursor) break;
      cursor = nextCursor;
    }

    const totalDropped = stats.raw - stats.parsed;
    const dropRate = stats.raw > 0 ? Math.round((totalDropped / stats.raw) * 100) : 0;

    if (dropRate > 80 && stats.raw > 5) {
      logger.warn('High drop rate in message parsing — possible API structure change', {
        count: items.length,
        stats,
        dropRate: `${dropRate}%`,
      });
    } else {
      logger.info('Fetched messages from home timeline', {
        count: items.length,
        stats,
      });
    }

    return items;
  }

  async function refreshGqlIds(): Promise<boolean> {
    logger.info('Auto-detecting GraphQL IDs from x.com…');
    try {
      const ids = await detectGqlIds();
      let updated = false;
      if (ids.UserByScreenName && ids.UserByScreenName !== userByScreenNameId) {
        userByScreenNameId = ids.UserByScreenName;
        persister?.save('X_GQL_USER_BY_SCREEN_NAME_ID', ids.UserByScreenName);
        updated = true;
      }
      if (ids.HomeLatestTimeline && ids.HomeLatestTimeline !== homeTimelineId) {
        homeTimelineId = ids.HomeLatestTimeline;
        persister?.save('X_GQL_HOME_TIMELINE_ID', ids.HomeLatestTimeline);
        updated = true;
      }
      if (updated) {
        logger.info('GraphQL IDs updated', {
          UserByScreenName: userByScreenNameId,
          HomeLatestTimeline: homeTimelineId,
        });
      } else {
        logger.info('GraphQL IDs are already up to date');
      }
      return updated;
    } catch (err) {
      logger.warn('Failed to auto-detect GraphQL IDs', {
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  async function fetchHomeTimelinePage(
    cursor?: string,
  ): Promise<{ entries: unknown[]; nextCursor: string | undefined }> {
    const variables: Record<string, unknown> = {
      count: 40,
      includePromotedContent: false,
      latestControlAvailable: true,
      requestContext: cursor ? 'scroll' : 'launch',
    };

    if (cursor) {
      variables.cursor = cursor;
    }

    const url = `https://x.com/i/api/graphql/${homeTimelineId}/HomeLatestTimeline?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${TIMELINE_FEATURES_ENCODED}`;

    const response = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) {
      // On 404, try auto-detecting new GQL IDs and retry once
      if (response.status === 404) {
        const updated = await refreshGqlIds();
        if (updated) {
          const retryUrl = `https://x.com/i/api/graphql/${homeTimelineId}/HomeLatestTimeline?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${TIMELINE_FEATURES_ENCODED}`;
          const retryResponse = await fetch(retryUrl, {
            headers,
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          });
          if (retryResponse.ok) {
            const retryJson = (await retryResponse.json()) as Record<string, unknown>;
            return parseHomeTimelineResponse(retryJson);
          }
        }
      }
      const body = await response.text().catch(() => '');
      throw new Error(
        `Scraper: failed to fetch home timeline: ${response.status} ${response.statusText}${body ? ` — ${body.slice(0, 200)}` : ''}`,
      );
    }

    const json = (await response.json()) as Record<string, unknown>;
    return parseHomeTimelineResponse(json);
  }

  function parseHomeTimelineResponse(json: Record<string, unknown>): {
    entries: unknown[];
    nextCursor: string | undefined;
  } {
    const instructions = (getNestedValue(json, [
      'data',
      'home',
      'home_timeline_urt',
      'instructions',
    ]) ?? []) as Array<Record<string, unknown>>;

    const entries: unknown[] = [];
    let nextCursor: string | undefined;

    for (const instruction of instructions) {
      if (instruction.type === 'TimelineAddEntries') {
        for (const entry of (instruction.entries ?? []) as Array<Record<string, unknown>>) {
          const content = entry.content as Record<string, unknown> | undefined;
          if (!content) continue;

          if (content.entryType === 'TimelineTimelineItem') {
            entries.push(entry);
          } else if (content.entryType === 'TimelineTimelineModule') {
            // Unwrap conversation threads / grouped tweets
            const items = content.items as Array<Record<string, unknown>> | undefined;
            if (items) {
              for (const item of items) {
                const itemContent = item.item as Record<string, unknown> | undefined;
                if (itemContent) {
                  entries.push({ content: itemContent });
                }
              }
            }
          } else if (
            content.entryType === 'TimelineTimelineCursor' &&
            content.cursorType === 'Bottom'
          ) {
            nextCursor = content.value as string;
          }
        }
      }
    }

    return { entries, nextCursor };
  }

  function parseTweetEntry(
    entry: unknown,
    stats: Record<string, number>,
    productId: string,
  ): Item | null {
    try {
      const tweetResult = getNestedValue(entry as Record<string, unknown>, [
        'content',
        'itemContent',
        'tweet_results',
        'result',
      ]) as Record<string, unknown> | undefined;

      if (!tweetResult) {
        stats.droppedNoResult++;
        return null;
      }

      // Skip tombstones and unavailable tweets intentionally
      const typename = tweetResult.__typename as string | undefined;
      if (typename === 'TweetTombstone' || typename === 'TweetUnavailable') {
        stats.droppedTombstone++;
        return null;
      }

      // Handle tweet types: regular tweet or tweet-with-visibility-results
      const legacy = tweetResult.legacy ?? getNestedValue(tweetResult, ['tweet', 'legacy']);
      if (!legacy) {
        stats.droppedNoLegacy++;
        return null;
      }

      const parsed = tweetLegacySchema.safeParse(legacy);
      if (!parsed.success) {
        stats.droppedSchemaFail++;
        logger.debug('Scraper: failed to parse message', {
          errors: parsed.error.issues.map((i) => i.message),
          typename,
        });
        return null;
      }

      const authorHandle = extractAuthorHandle(tweetResult);
      const fetchedAt = new Date().toISOString();

      // For retweets, use the original tweet text
      if (parsed.data.retweeted_status_result) {
        const rtResult = parsed.data.retweeted_status_result as Record<string, unknown>;
        // Try both direct and visibility-wrapped paths
        const rtLegacy = (getNestedValue(rtResult, ['result', 'legacy']) ??
          getNestedValue(rtResult, ['result', 'tweet', 'legacy'])) as
          | Record<string, unknown>
          | undefined;
        if (rtLegacy) {
          const rtParsed = tweetLegacySchema.safeParse(rtLegacy);
          if (rtParsed.success) {
            const rtUrls = rtParsed.data.entities.urls
              .map((u) => u.expanded_url)
              .filter((url): url is string => !!url && !isXUrl(url));
            const rtAuthorHandle =
              extractAuthorHandle((rtResult.result ?? {}) as Record<string, unknown>) ??
              authorHandle;
            const rtAuthor = rtAuthorHandle ? `@${rtAuthorHandle}` : '@unknown';
            const rtUrl = rtAuthorHandle
              ? `https://x.com/${rtAuthorHandle}/status/${rtParsed.data.id_str}`
              : `https://x.com/i/status/${rtParsed.data.id_str}`;
            return {
              id: `x:${rtParsed.data.id_str}`,
              source: 'x',
              text: rtParsed.data.full_text,
              author: rtAuthor,
              url: rtUrl,
              createdAt: new Date(parsed.data.created_at).toISOString(),
              fetchedAt,
              productId,
              urls: rtUrls,
            };
          }
        }
        stats.droppedRtUnparseable++;
        return null;
      }

      const urls = parsed.data.entities.urls
        .map((u) => u.expanded_url)
        .filter((url): url is string => !!url && !isXUrl(url));

      const author = authorHandle ? `@${authorHandle}` : '@unknown';
      const tweetUrl = authorHandle
        ? `https://x.com/${authorHandle}/status/${parsed.data.id_str}`
        : `https://x.com/i/status/${parsed.data.id_str}`;

      return {
        id: `x:${parsed.data.id_str}`,
        source: 'x',
        text: parsed.data.full_text,
        author,
        url: tweetUrl,
        createdAt: new Date(parsed.data.created_at).toISOString(),
        fetchedAt,
        productId,
        urls,
      };
    } catch (err) {
      stats.droppedException++;
      logger.warn('Scraper: unexpected error parsing entry', {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
}

/**
 * Auto-detect current GraphQL query IDs from X's web app JS bundles.
 * Fetches x.com, finds script bundles, then searches for operationName patterns.
 */
export async function detectGqlIds(): Promise<{
  UserByScreenName?: string;
  HomeLatestTimeline?: string;
}> {
  const html = await fetch('https://x.com', {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    },
  }).then((r) => r.text());

  // Extract JS bundle URLs from script tags
  const scriptUrls: string[] = [];
  const scriptRegex = /src="(https:\/\/abs\.twimg\.com\/responsive-web\/client-web[^"]+\.js)"/g;
  let match: RegExpExecArray | null;
  while ((match = scriptRegex.exec(html)) !== null) {
    scriptUrls.push(match[1]);
  }

  if (scriptUrls.length === 0) {
    throw new Error(
      'Aucun bundle JS trouvé sur x.com — la structure de la page a peut-être changé',
    );
  }

  const result: { UserByScreenName?: string; HomeLatestTimeline?: string } = {};
  const operations = ['UserByScreenName', 'HomeLatestTimeline'] as const;
  const operationSet = new Set<string>(operations);
  const idPattern = /queryId:"([^"]+)",operationName:"([^"]+)",operationType:"query"/g;

  // Fetch bundles concurrently in batches, stop early once we found both
  for (
    let i = 0;
    i < scriptUrls.length && (!result.UserByScreenName || !result.HomeLatestTimeline);
    i += 5
  ) {
    const batch = scriptUrls.slice(i, i + 5);
    // react-doctor-disable-next-line react-doctor/async-await-in-loop -- batches are processed sequentially on purpose to stop early once both GraphQL op IDs are found
    const scripts = await Promise.all(
      batch.map((url) =>
        fetch(url)
          .then((r) => r.text())
          .catch(() => ''),
      ),
    );

    for (const js of scripts) {
      let m: RegExpExecArray | null;
      while ((m = idPattern.exec(js)) !== null) {
        const [, queryId, opName] = m;
        if (operationSet.has(opName)) {
          result[opName as keyof typeof result] = queryId;
        }
      }
      if (result.UserByScreenName && result.HomeLatestTimeline) break;
    }
  }

  return result;
}

function getNestedValue(obj: unknown, path: string[]): unknown {
  let current: unknown = obj;
  for (const key of path) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
