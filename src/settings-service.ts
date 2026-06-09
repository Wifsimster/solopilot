import { getDb, type SettingRecord, type ProductSettingRecord } from './db.js';

const EDITABLE_KEYS = [
  'AI_MODEL',
  'TWEETS_LOOKBACK_DAYS',
  'DRY_RUN',
  'CRON_SCHEDULE',
  'COLLECT_CRON_SCHEDULE',
  'X_GQL_USER_BY_SCREEN_NAME_ID',
  'X_GQL_HOME_TIMELINE_ID',
  // Auto-publish guardrails + canary schedule (see publish-service / cron-manager).
  'PUBLISH_DAILY_CAP',
  'PUBLISH_MIN_SPACING_MINUTES',
  'PUBLISH_CANARY_CRON',
  'PUBLISH_QUEUE_CRON',
  'PUBLISH_METRICS_CRON',
] as const;
const CREDENTIAL_KEYS = [
  'X_SESSION_AUTH_TOKEN',
  'X_SESSION_CSRF_TOKEN',
  'DISCORD_WEBHOOK_URL',
  // LinkedIn auto-publish session cookies (drive the web UI as the logged-in
  // user). li_at is the auth cookie; JSESSIONID is the CSRF cookie.
  'LINKEDIN_LI_AT',
  'LINKEDIN_JSESSIONID',
  // Reddit auto-publish session cookie (reddit_session), used against old.reddit.
  'REDDIT_SESSION',
] as const;

export type EditableKey = (typeof EDITABLE_KEYS)[number];
export type CredentialKey = (typeof CREDENTIAL_KEYS)[number];
type SettableKey = EditableKey | CredentialKey;

export function isEditableKey(key: string): key is EditableKey {
  return (EDITABLE_KEYS as readonly string[]).includes(key);
}

export function isCredentialKey(key: string): key is CredentialKey {
  return (CREDENTIAL_KEYS as readonly string[]).includes(key);
}

export function getSettings(): SettingRecord[] {
  const db = getDb();
  return db.prepare('SELECT * FROM settings ORDER BY key').all() as SettingRecord[];
}

export function getSetting(key: string): string | undefined {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function setSetting(key: SettableKey, value: string): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value);
}

export function deleteSetting(key: string): void {
  const db = getDb();
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}

export function getSettingsMap(): Record<string, string> {
  const settings = getSettings();
  const map: Record<string, string> = {};
  for (const s of settings) {
    map[s.key] = s.value;
  }
  return map;
}

export function getProductSetting(productId: string, key: string): string | undefined {
  const db = getDb();
  const row = db
    .prepare('SELECT value FROM product_settings WHERE product_id = ? AND key = ?')
    .get(productId, key) as { value: string | null } | undefined;
  return row?.value ?? undefined;
}

export function setProductSetting(productId: string, key: string, value: string | null): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO product_settings (product_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(product_id, key) DO UPDATE SET value = excluded.value`,
  ).run(productId, key, value);
}

export function getProductSettings(productId: string): ProductSettingRecord[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM product_settings WHERE product_id = ? ORDER BY key')
    .all(productId) as ProductSettingRecord[];
}

export function getProductSettingsMap(productId: string): Record<string, string> {
  const rows = getProductSettings(productId);
  const map: Record<string, string> = {};
  for (const r of rows) {
    if (r.value !== null) map[r.key] = r.value;
  }
  return map;
}

export function maskCredential(value: string): string {
  if (value.length <= 4) return '••••';
  return '••••' + value.slice(-4);
}
