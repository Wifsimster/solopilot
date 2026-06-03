import type { Config } from './config.js';

export function buildMergedConfig(baseConfig: Config, overrides: Record<string, string>): Config {
  return {
    ...baseConfig,
    ...(overrides.AI_MODEL && { AI_MODEL: overrides.AI_MODEL }),
    ...(overrides.TWEETS_LOOKBACK_DAYS && {
      TWEETS_LOOKBACK_DAYS: Number(overrides.TWEETS_LOOKBACK_DAYS),
    }),
    ...(overrides.DRY_RUN !== undefined && {
      DRY_RUN: overrides.DRY_RUN === 'true' || overrides.DRY_RUN === '1',
    }),
    ...(overrides.X_SESSION_AUTH_TOKEN && { X_SESSION_AUTH_TOKEN: overrides.X_SESSION_AUTH_TOKEN }),
    ...(overrides.X_SESSION_CSRF_TOKEN && { X_SESSION_CSRF_TOKEN: overrides.X_SESSION_CSRF_TOKEN }),
    ...(overrides.X_GQL_USER_BY_SCREEN_NAME_ID && {
      X_GQL_USER_BY_SCREEN_NAME_ID: overrides.X_GQL_USER_BY_SCREEN_NAME_ID,
    }),
    ...(overrides.X_GQL_HOME_TIMELINE_ID && {
      X_GQL_HOME_TIMELINE_ID: overrides.X_GQL_HOME_TIMELINE_ID,
    }),
    ...(overrides.DISCORD_WEBHOOK_URL && {
      DISCORD_WEBHOOK_URL: overrides.DISCORD_WEBHOOK_URL,
    }),
    ...(overrides.COLLECT_CRON_SCHEDULE && {
      COLLECT_CRON_SCHEDULE: overrides.COLLECT_CRON_SCHEDULE,
    }),
    ...(overrides.CRON_SCHEDULE && {
      CRON_SCHEDULE: overrides.CRON_SCHEDULE,
    }),
  };
}
