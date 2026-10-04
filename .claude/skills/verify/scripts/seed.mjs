// Verification scaffolding: fills the throwaway SQLite DB (DB_PATH) with fake
// veille items through the app's own store (dist/tweet-store.js), then sets
// their triage fields the way the AI triage step would. Run by
// `control-solopilot launch` after `npm run build`; never point DB_PATH at data/.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = process.argv[2];
if (!process.env.DB_PATH || !process.env.DB_PATH.includes('.verify-run')) {
  console.error('Refusing to seed: DB_PATH must point inside .verify-run/');
  process.exit(2);
}
const { getDb, closeDb, DEFAULT_PRODUCT_ID } = await import(pathToFileURL(path.join(repo, 'dist', 'db.js')).href);
const { storeItems } = await import(pathToFileURL(path.join(repo, 'dist', 'tweet-store.js')).href);

const today = new Date().toISOString().slice(0, 10);
const now = Date.now();
// [id, source, author, text, category, urgency, status]
const ITEMS = [
  ['verify-1', 'x', 'fake_user_a', 'Votre outil de facturation plante quand je change de mois, une idée ?', 'bug', 85, 'new'],
  ['verify-2', 'reddit', 'fake_user_b', 'Quelqu’un connaît un back-office pour auto-entrepreneur qui gère l’URSSAF ?', 'question', 72, 'new'],
  ['verify-3', 'hn', 'fake_user_c', 'Show HN: a solo founder dashboard built on workflows', 'actualite', 35, 'new'],
  ['verify-4', 'x', 'fake_user_d', 'J’adore le briefing du matin, il me fait gagner 20 minutes.', 'temoignage', 20, 'new'],
  ['verify-5', 'x', 'fake_user_e', 'Ce serait top d’exporter les factures en CSV.', 'demande_fonctionnalite', 55, 'handled'],
  ['verify-6', 'reddit', 'fake_user_f', 'Trop cher pour ce que c’est.', 'objection', 40, 'ignored'],
];

getDb();
const items = ITEMS.map(([id, source, author, text], i) => ({
  id,
  source,
  author,
  text,
  url: `https://example.invalid/verify/${id}`,
  createdAt: new Date(now - i * 3600_000).toISOString(),
  fetchedAt: new Date(now).toISOString(),
  productId: DEFAULT_PRODUCT_ID,
  urls: [],
}));
const { inserted } = storeItems(items, today, DEFAULT_PRODUCT_ID, 'mention');
const update = getDb().prepare(
  `UPDATE tweets SET triage_category = ?, triage_urgency = ?, triage_relevance = 80, triaged_at = ?, triage_status = ?, triage_status_at = ? WHERE id = ?`,
);
for (const [id, , , , category, urgency, status] of ITEMS) update.run(category, urgency, now, status, status === 'new' ? null : now, id);
closeDb();
console.log(JSON.stringify({ inserted, items: ITEMS.length }));
