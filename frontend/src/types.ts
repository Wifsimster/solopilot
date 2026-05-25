export interface RunRecord {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'success' | 'no_news' | 'no_tweets' | 'error' | 'deleted';
  trigger_type: 'cron' | 'manual' | 'collect';
  tweets_fetched: number;
  tweets_posted: number;
  thread_ids: string | null;
  summary: string | null;
  error_message: string | null;
  notification_status: 'pending' | 'sent' | 'failed' | 'skipped' | null;
}

export interface SettingRecord {
  key: string;
  value: string;
  updated_at: string;
}

export interface StatusResponse {
  running: boolean;
  collecting: boolean;
  configured: boolean;
  lastRun?: RunRecord;
  cronSchedule: string;
  totalRuns: number;
}

export interface ConfigResponse {
  envDefaults: Record<string, string>;
  credentialInfo: {
    authTokenMasked: string;
    csrfTokenMasked: string;
    discordWebhookMasked: string;
    hasAuth: boolean;
  };
}

export interface SetupResponse {
  configured: boolean;
  credentials: CredentialStatus[];
}

export interface CredentialStatus {
  key: string;
  label: string;
  docUrl: string;
  howToFind: string;
  configured: boolean;
}

export interface MonthlySummaryRecord {
  id: number;
  year: number;
  month: number;
  summary: string;
  source_run_ids: string;
  generated_at: string;
}

export interface AvailableMonth {
  year: number;
  month: number;
  run_count: number;
}

export interface ApiMessage {
  success: boolean;
  message: string;
}

export type FeedItemSource = 'x' | 'reddit';

export interface TweetRecord {
  id: string;
  text: string;
  createdAt: string;
  urls: string[];
  /** Source of the item — defaults to 'x' for legacy rows that omit the field. */
  source?: FeedItemSource;
}

export interface ProductRecord {
  id: string;
  name: string;
  x_query: string | null;
  discord_webhook: string | null;
  ai_prompt_override: string | null;
  collect_cron: string | null;
  publish_cron: string | null;
  x_enabled: boolean;
  reddit_enabled: boolean;
  reddit_subreddits: string[] | null;
  created_at: number;
  archived_at: number | null;
}
