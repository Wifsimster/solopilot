# API & CLI pour agents

Cette page documente l'API HTTP de Solopilot telle qu'elle est pilotee par un
agent IA via le CLI `solopilot` (ou en `curl` brut). Elle couvre l'ensemble des
endpoints REST exposes par le serveur Hono, leur authentification, leur portee
par produit, et les schemas de corps de requete. Pour une vue cote
developpeur/integrateur classee par module, voir aussi
[`api-reference.md`](api-reference.md). Pour piloter l'app depuis un agent, voir
la skill [`.claude/skills/solopilot/`](../.claude/skills/solopilot/SKILL.md).

## Authentification

- **Basic Auth.** Quand le serveur a `ADMIN_PASSWORD` defini, toutes les routes
  sont protegees par HTTP Basic, utilisateur `admin`, mot de passe =
  `ADMIN_PASSWORD`. Si la variable n'est pas definie, l'auth n'est pas appliquee.
- **CSRF / Origin.** Les requetes mutantes (POST/PUT/PATCH/DELETE) sont rejetees
  si elles portent un en-tete `Origin`/`Referer` qui ne correspond pas a l'hote.
  Quand aucun de ces en-tetes n'est envoye, le controle passe — c'est le cas du
  CLI et de `curl`, qui fonctionnent donc avec la seule Basic Auth.
- **Portee produit (`productId`).** La plupart des lectures et ecritures de
  module acceptent un parametre de requete `productId` (alias `activity` sur le
  cockpit) pour cibler une activite. Le CLI l'ajoute automatiquement a chaque
  requete via `--product <id>` ou `SOLOPILOT_PRODUCT_ID`.

## Base URL et execution

- **Base URL par defaut :** `http://localhost:3000`. En production, le serveur
  tourne dans Docker (container `solopilot`, port 3000).
- **Via le CLI :**

  ```bash
  # Dans le container de prod (recommande)
  docker exec -e ADMIN_PASSWORD=*** solopilot node dist/cli.js cockpit

  # A distance, contre l'URL publique
  solopilot cockpit --url https://your-host --password ***
  ```

- **Via curl brut :**

  ```bash
  curl -u admin:PASSWORD http://localhost:3000/api/cockpit
  curl -u admin:PASSWORD -X POST http://localhost:3000/api/trigger
  ```

### Contrat du CLI

Commande : `solopilot` (egalement `npm run cli --` et `node dist/cli.js`).

Configuration (precedence haut → bas) :

| Reglage | Flag | Env | Defaut |
|---------|------|-----|--------|
| Base URL | `--url <u>` | `SOLOPILOT_API_URL` | `http://localhost:3000` |
| Mot de passe | `--password <p>` | `SOLOPILOT_ADMIN_PASSWORD` puis `ADMIN_PASSWORD` | — |
| Produit | `--product <id>` | `SOLOPILOT_PRODUCT_ID` | — |

Autres flags : `--query k=v` / `-q k=v` (repetable, params de requete
additionnels) ; `--raw` (affiche le corps sans formatage JSON).

**Verbes generiques (couverture complete de l'API) :**
`get <path> [flags]`, `post <path> [json]`, `put <path> [json]`,
`patch <path> [json]`, `delete <path>`. Le corps JSON est une chaine
positionnelle ; `-` lit le JSON depuis stdin.

**Normalisation du chemin :** un chemin commencant par `/` est utilise tel
quel ; commencant par `api/` il recoit un `/` initial ; sinon il est prefixe
par `/api/`. Ainsi `cockpit`, `/api/cockpit` et `/healthz` fonctionnent.

**Raccourcis (GET) :** `cockpit`, `status`, `health`, `version`, `setup`,
`products`, `runs`, `summaries`, `invoices`, `comptabilite`, `deals`,
`contacts`, `agenda`, `workflows`.
**Actions :** `trigger` (POST `/api/trigger`), `collect`
(POST `/api/trigger-collect`), `endpoints` (catalogue, sans HTTP), `help`.

**Codes de sortie :** `0` succes · `1` HTTP non-2xx (corps sur stderr) ·
`2` erreur reseau / mauvais usage.

## Reference des endpoints

Les routes marquees **[configuré uniquement]** ne sont pleinement actives
qu'une fois les identifiants veille configures ; en mode setup (sans
identifiants), elles renvoient une reponse vide ou minimale.

### Sante, version, setup

| Methode | Path | Query | Body | Description |
|---------|------|-------|------|-------------|
| GET | `/healthz` | — | — | Verification de sante (`ok`, ou `unconfigured` + liste manquante) |
| GET | `/api/version` | — | — | Version de l'app et date de build |
| GET | `/api/setup` | — | — | Identifiants requis et statut de configuration |
| GET | `/api/config` | — | — | Valeurs par defaut + infos identifiants masquees |

### Cockpit

| Methode | Path | Query | Body | Description |
|---------|------|-------|------|-------------|
| GET | `/api/cockpit` | `productId` (alias `activity`) | — | Brief quotidien unique de l'activite |

### Facturation

| Methode | Path | Query | Body | Description |
|---------|------|-------|------|-------------|
| GET | `/api/facturation/invoices` | `productId`, `status` (`draft`/`sent`/`paid`/`void`) | — | Liste les factures |
| POST | `/api/facturation/invoices` | `productId` | `invoiceCreateSchema` | Cree une facture manuelle |
| POST | `/api/facturation/invoices/:id/paid` | — | — | Marque une facture comme payee |
| GET | `/api/facturation/relances` | `productId` | — | Brouillons de relance (apercu) |
| GET | `/api/facturation/stripe` | `productId` | — | Statut de connexion Stripe |
| POST | `/api/facturation/invoices/:id/checkout` | `productId` | — | Cree une session Stripe Checkout |
| POST | `/api/facturation/sync` | `productId` | — | Sync Stripe manuelle (no-op si non configure) |

### Comptabilité

| Methode | Path | Query | Body | Description |
|---------|------|-------|------|-------------|
| GET | `/api/comptabilite` | `productId` | — | Statut CA + estimation URSSAF + config |
| POST | `/api/comptabilite/config` | `productId` | `comptaConfigSchema` | Definit le type d'activite / la periode de declaration |
| GET | `/api/comptabilite/ledger` | `productId` | — | Liste les ecritures |
| POST | `/api/comptabilite/ledger` | `productId` | `ledgerCreateSchema` | Ajoute une ecriture |

### CRM

| Methode | Path | Query | Body | Description |
|---------|------|-------|------|-------------|
| GET | `/api/crm/contacts` | `productId` | — | Liste les contacts |
| POST | `/api/crm/contacts` | `productId` | `contactCreateSchema` | Cree un contact |
| GET | `/api/crm/contacts/:id/interactions` | — | — | Interactions d'un contact |
| POST | `/api/crm/interactions` | `productId` | `interactionCreateSchema` | Journalise une interaction |
| GET | `/api/crm/deals` | `productId` | — | Liste les opportunites (pipeline) |
| POST | `/api/crm/deals` | `productId` | `dealCreateSchema` | Cree une opportunite |
| POST | `/api/crm/deals/:id/stage` | — | `{stage}` | Change l'etape d'une opportunite |
| GET | `/api/crm/relances` | `productId` | — | Brouillons de relance pour deals dormants (apercu) |

### Agenda

| Methode | Path | Query | Body | Description |
|---------|------|-------|------|-------------|
| GET | `/api/agenda` | `productId` | — | Resume agenda + aujourd'hui + a venir |
| POST | `/api/agenda/events` | `productId` | `eventCreateSchema` | Cree un evenement |

### Workflows

| Methode | Path | Query | Body | Description |
|---------|------|-------|------|-------------|
| GET | `/api/workflows` | `productId` | — | Liste les workflows + derniere execution |
| GET | `/api/workflows/:id` | `productId` | — | Detail d'un workflow + 10 dernieres executions |
| GET | `/api/workflow-runs` | `limit` (1-100, def 20), `offset`, `workflow`, `productId` | — | Liste les executions de workflow |
| GET | `/api/workflow-runs/:id` | — | — | Detail d'une execution |

### Produits

| Methode | Path | Query | Body | Description |
|---------|------|-------|------|-------------|
| GET | `/api/products` | `includeArchived` (`true`/`false`) | — | Liste les produits |
| POST | `/api/products` | — | `productCreateSchema` | Cree un produit |
| GET | `/api/products/:id` | — | — | Detail d'un produit |
| PUT | `/api/products/:id` | — | `productUpdateSchema` | Met a jour un produit |
| DELETE | `/api/products/:id` | `hard` (`true`/`false`) | — | Archive ou supprime definitivement |
| GET | `/api/products/:id/settings` | — | — | Overrides de parametres du produit |
| PUT | `/api/products/:id/settings` | — | `{key,value}` | Definit un parametre produit |

### Acquisition — signaux d'intention & contenu

| Methode | Path | Query | Body | Description |
|---------|------|-------|------|-------------|
| GET | `/api/reddit/search-subreddits` | `q` (1-64), `limit` (1-25, def 8), `includeNsfw` | — | Recherche de subreddits |
| GET | `/api/intent-signals` | `productId`, `status`, `limit` (1-500) | — | Liste les signaux d'intention |
| PATCH | `/api/intent-signals/:id` | — | `intentSignalPatchSchema` | Met a jour statut/notes d'un signal |
| POST | `/api/intent-signals/:id/analyze` | — | `generateRepliesSchema` | Analyse un signal (IA) |
| GET | `/api/intent-signals/:id/replies` | — | — | Liste les variantes de reponse |
| POST | `/api/intent-signals/:id/replies/generate` | — | `generateRepliesSchema` | Genere des variantes de reponse |
| PATCH | `/api/intent-signal-replies/:id` | — | `intentReplyPatchSchema` | Marque une reponse utilisee/non utilisee |
| POST | `/api/content/suggest-audience` | — | `suggestAudienceSchema` | Suggere une audience cible (IA) |
| POST | `/api/content/suggest-ctas` | — | `suggestCtasSchema` | Suggere des CTA (IA) |
| POST | `/api/content/suggest-description` | — | `suggestDescriptionSchema` | Suggere une description produit (IA) |
| POST | `/api/content/suggest-value-props` | — | `suggestValuePropsSchema` | Suggere des propositions de valeur (IA) |
| POST | `/api/content/suggest-subreddits` | — | `suggestSubredditsSchema` | Suggere des subreddits (IA) |
| POST | `/api/content/suggest-hn-keywords` | — | `suggestHnKeywordsSchema` | Suggere des mots-cles HN (IA) |
| POST | `/api/products/:id/content/generate-posts` | — | `generatePostsSchema` | Genere des brouillons de contenu |
| GET | `/api/content-drafts` | `productId`, `status`, `kind`, `limit` (1-500) | — | Liste les brouillons de contenu |
| PATCH | `/api/content-drafts/:id` | — | `contentDraftPatchSchema` | Met a jour un brouillon |
| DELETE | `/api/content-drafts/:id` | — | — | Supprime un brouillon |
| GET | `/api/github-import/repos` | `username`, `includeForks`, `includeArchived` | — | Liste les repos d'un utilisateur GitHub |
| POST | `/api/github-import/bulk` | — | `bulkImportRequestSchema` | Import en masse de produits depuis des repos |

### Veille — statut, runs, parametres

| Methode | Path | Query | Body | Description |
|---------|------|-------|------|-------------|
| GET | `/api/status` | `productId` | — | Statut des runs (configure) / minimal (mode setup) |
| GET | `/api/runs` | `limit` (def 20), `offset`, `type`, `productId` | — | Historique des runs (vide en mode setup) |
| GET | `/api/collect-status` | `productId` | — | Statut de la collecte de tweets **[configuré uniquement]** |
| GET | `/api/settings` | — | — | Parametres globaux, masques (vide en mode setup) |
| POST | `/api/settings` | — | `{key:value,...}` | Met a jour les parametres editables **[configuré uniquement]** |
| POST | `/api/credentials` | — | `{X_SESSION_AUTH_TOKEN,X_SESSION_CSRF_TOKEN}` | Valide + stocke les cookies X **[configuré uniquement]** |
| GET | `/api/summaries` | `limit`, `offset`, `month` (`YYYY-MM`), `search`, `productId` | — | Liste les resumes de run **[configuré uniquement]** |
| GET | `/api/monthly-summaries` | `productId` | — | Syntheses mensuelles (12 mois) **[configuré uniquement]** |
| GET | `/api/monthly-summaries/available` | `productId` | — | Mois disponibles **[configuré uniquement]** |
| GET | `/api/monthly-summaries/:year/:month` | `productId` | — | Recupere/verifie une synthese mensuelle **[configuré uniquement]** |
| POST | `/api/monthly-summaries/generate` | — | `{year,month,productId?}` | Genere une synthese mensuelle (IA) **[configuré uniquement]** |
| DELETE | `/api/summaries/:id` | — | — | Supprime run + resume **[configuré uniquement]** |
| POST | `/api/summaries/:id/rerun` | — | — | Rejoue un run precedent **[configuré uniquement]** |
| GET | `/api/runs/:id/tweets` | `limit` (1-200, def 50), `offset` | — | Tweets d'un run **[configuré uniquement]** |

### Veille — declenchement et integrations

| Methode | Path | Query | Body | Description |
|---------|------|-------|------|-------------|
| POST | `/api/trigger` | `productId` | — | Declenche un run de publication **[configuré uniquement]** |
| POST | `/api/trigger-collect` | `productId` | — | Declenche une collecte de tweets **[configuré uniquement]** |
| POST | `/api/detect-gql-ids` | — | — | Auto-detecte les IDs GraphQL X **[configuré uniquement]** |
| GET | `/api/cron-schedule` | — | — | Crons actifs/sauvegardes/par defaut **[configuré uniquement]** |
| POST | `/api/cron-schedule` | — | `{schedule}` | Definit le cron de publication **[configuré uniquement]** |
| POST | `/api/collect-cron-schedule` | — | `{schedule}` | Definit le cron de collecte **[configuré uniquement]** |
| POST | `/api/discord-webhook` | — | `{DISCORD_WEBHOOK_URL}` | Enregistre le webhook Discord **[configuré uniquement]** |
| DELETE | `/api/discord-webhook` | — | — | Supprime le webhook Discord **[configuré uniquement]** |
| POST | `/api/runs/:id/send-discord` | — | — | Envoie le resume d'un run sur Discord **[configuré uniquement]** |
| POST | `/api/test-discord` | — | — | Teste le webhook Discord **[configuré uniquement]** |

## Schemas de corps de requete

Conventions transverses : montants en **centimes** (`amount_cents`, entier),
dates au format **`YYYY-MM-DD`**, datetimes au format **ISO 8601**. `req` =
requis, `opt` = optionnel, `def` = valeur par defaut.

- **`invoiceCreateSchema`** — `client_name` (string, req), `client_email`
  (email, opt), `amount_cents` (int > 0, req), `currency` (3 car., opt def
  `eur`), `issued_on` (`YYYY-MM-DD`, opt), `due_on` (`YYYY-MM-DD`, req),
  `status` (`draft`|`sent`|`paid`|`void`, opt def `sent`).
- **`ledgerCreateSchema`** — `kind` (`recette`|`depense`, req), `amount_cents`
  (int > 0, req), `label` (string, req), `occurred_on` (`YYYY-MM-DD`, opt).
- **`comptaConfigSchema`** — `activityType` (`services_bnc`|`services_bic`|`vente`,
  opt), `declarationPeriod` (`monthly`|`quarterly`, opt).
- **`contactCreateSchema`** — `name` (string, req), `email` (email, opt),
  `company` (opt), `phone` (opt), `status` (`lead`|`active`|`inactive`, opt def
  `lead`), `source` (opt def `manual`), `notes` (opt).
- **`dealCreateSchema`** — `contact_id` (string, req), `title` (string, req),
  `stage` (`nouveau`|`qualifie`|`proposition`|`gagne`|`perdu`, opt def
  `nouveau`), `amount_cents` (int >= 0, opt def 0).
- **`interactionCreateSchema`** — `contact_id` (string, req), `kind`
  (`note`|`email`|`call`|`meeting`, opt def `note`), `summary` (string, req),
  `occurred_on` (`YYYY-MM-DD`, opt).
- **`eventCreateSchema`** — `title` (string, req), `starts_at` (ISO datetime,
  req), `ends_at` (ISO datetime, opt), `location` (opt).
- **`productCreateSchema`** — `id` (slug 1-64, minuscules alphanum + tirets,
  req), `name` (1-120, req), plus des bascules de source optionnelles
  `x_enabled` / `reddit_enabled` / `hn_enabled` avec `reddit_subreddits[]` /
  `hn_keywords[]`, `intent_enabled` / `intent_keywords[]`,
  `product_description`, `target_audience`, `value_props[]`,
  `call_to_actions[]`, `product_url`, `content_voice`, `content_language`, etc.
  (au moins une source doit etre activee).
- **`generatePostsSchema`** — `count` (int 1-10, req), `targetSource`
  (`x`|`reddit`|`generic`, req).
- **`generateRepliesSchema`** — `count` (int 1-5, opt def 3).

## Exemples par module

### Cockpit

```bash
curl -u admin:PASSWORD http://localhost:3000/api/cockpit
solopilot cockpit
solopilot cockpit --product mon-produit
```

### Facturation

```bash
# Lister les factures envoyees
curl -u admin:PASSWORD 'http://localhost:3000/api/facturation/invoices?status=sent'
solopilot get facturation/invoices -q status=sent

# Creer une facture (montant en centimes, dates YYYY-MM-DD)
curl -u admin:PASSWORD -X POST http://localhost:3000/api/facturation/invoices \
  -H 'content-type: application/json' \
  -d '{"client_name":"ACME","amount_cents":120000,"due_on":"2026-07-01"}'
solopilot post facturation/invoices '{"client_name":"ACME","amount_cents":120000,"due_on":"2026-07-01"}'

# Marquer payee
solopilot post facturation/invoices/INVOICE_ID/paid
```

### Comptabilité

```bash
solopilot comptabilite
solopilot post comptabilite/config '{"activityType":"services_bnc","declarationPeriod":"quarterly"}'
solopilot post comptabilite/ledger '{"kind":"recette","amount_cents":50000,"label":"Mission X"}'
```

### CRM

```bash
solopilot post crm/contacts '{"name":"Jane Doe","email":"jane@acme.com","company":"ACME"}'
solopilot post crm/deals '{"contact_id":"CONTACT_ID","title":"Refonte site","amount_cents":300000}'
solopilot post crm/deals/DEAL_ID/stage '{"stage":"proposition"}'
```

### Agenda

```bash
solopilot agenda
solopilot post agenda/events '{"title":"RDV client","starts_at":"2026-06-10T14:00:00+02:00","ends_at":"2026-06-10T15:00:00+02:00"}'
```

### Veille

```bash
solopilot trigger          # run de publication (resume IA)
solopilot collect          # collecte de tweets
solopilot runs
solopilot get summaries -q month=2026-06
```
