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

export type FeedItemSource = 'x' | 'reddit' | 'hn';

export interface TweetRecord {
  id: string;
  text: string;
  createdAt: string;
  urls: string[];
  /** Source of the item — defaults to 'x' for legacy rows that omit the field. */
  source?: FeedItemSource;
}

export type ReplyVoice = 'decontractee' | 'professionnelle' | 'directe' | 'aidante';

export type ContentVoice = 'decontractee' | 'professionnelle' | 'directe' | 'aidante';

export type ContentLanguage = 'fr' | 'en';

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
  hn_enabled: boolean;
  hn_keywords: string[] | null;
  intent_enabled: boolean;
  intent_keywords: string[];
  product_description: string | null;
  reply_voice: ReplyVoice | null;
  product_url: string | null;
  target_audience: string | null;
  value_props: string[];
  call_to_actions: string[];
  content_voice: ContentVoice | null;
  content_language: ContentLanguage | null;
  created_at: number;
  archived_at: number | null;
}

export type ContentDraftStatus = 'pending' | 'edited' | 'used' | 'discarded';

export type TargetSource = 'x' | 'reddit' | 'generic';

export interface ContentDraft {
  id: number;
  product_id: string;
  kind: 'post';
  target_source: TargetSource | null;
  angle: string | null;
  text: string;
  edited_text: string | null;
  status: ContentDraftStatus;
  used_on: string | null;
  generated_at: number;
  used_at: number | null;
}

export type IntentSignalStatus = 'new' | 'snoozed' | 'dismissed' | 'replied';

export interface IntentSignal {
  id: number;
  item_id: string;
  product_id: string;
  source: FeedItemSource;
  matched_pattern: string;
  status: IntentSignalStatus;
  notes: string | null;
  created_at: number;
  text: string;
  author: string;
  url: string;
  ai_score: number | null;
  ai_explanation: string | null;
  ai_drafted_reply: string | null;
  ai_processed_at: number | null;
  ai_error: string | null;
}
