# Plan de réimplémentation — architecture workflow

> Comment Solopilot est construit : un **moteur de workflows** générique, des
> **connecteurs**, et des **modules** métier qui ne sont que des dossiers de
> workflows. Voir [ADR-0013](adr/0013-from-bot-to-solopilot-workflow-platform.md).

## 1. Les quatre primitives

```
Trigger ──déclenche──▶ Workflow ──compose──▶ Step[] ──produit──▶ Run
   │                       │                     │                  │
 cron/manual/        définition            unité typée        instance + trace
 event/webhook       versionnée         (ctx,in)=>out         (workflow_runs)
```

- **Workflow** — définition déclarative : un déclencheur + des étapes ordonnées.
- **Trigger** — `cron` | `manual` | `event` | `webhook`.
- **Step** — fonction pure d'orchestration `(ctx, input) => output`, réutilisable.
- **Run** — exécution journalisée (généralise la table `runs` actuelle).

```ts
// src/workflow/types.ts
export type ModuleId =
  | 'cockpit' | 'veille' | 'acquisition'
  | 'crm' | 'facturation' | 'compta' | 'agenda';

export type Trigger =
  | { kind: 'cron'; expr: string }
  | { kind: 'manual' }
  | { kind: 'event'; on: string }
  | { kind: 'webhook'; path: string };

export interface StepDef { use: string; with?: Record<string, unknown>; }

export interface Workflow {
  id: string;            // 'facturation.relance-impayes'
  module: ModuleId;
  label: string;         // libellé FR pour le dashboard
  trigger: Trigger;
  steps: StepDef[];
  version: number;
  enabled: boolean;      // flag de rollout
}

export interface StepContext {
  activityId: string;             // ex-product_id
  config: Config;
  log: Logger;
  connectors: ConnectorRegistry;  // x, reddit, hn, discord, email, stripe, calendar, ai
  emit: (event: string, payload: unknown) => void;
}

export type Step<I = unknown, O = unknown> = (ctx: StepContext, input: I) => Promise<O>;
```

## 2. Le moteur (in-process, ~300 lignes)

> **État d'avancement.** Le moteur est implémenté et **testé de bout en bout**
> (`npm run test:workflow`, 14 assertions contre SQLite), **sans être câblé au
> scheduler de prod** — donc zéro impact (tous les workflows sont `enabled: false`) :
> - `src/workflow/types.ts` — primitives (Workflow, Trigger, Step, StepContext, WorkflowRun).
> - `src/workflow/registry.ts` — registre in-memory des workflows et étapes.
> - `src/workflow/engine.ts` — exécuteur séquentiel avec dégradation gracieuse.
> - `src/workflow/run-store.ts` — persistance des runs dans `workflow_runs` (migration idempotente dans `db.ts`).
> - `src/workflow/runner.ts` — contexte + connecteurs + garde de concurrence par `(module, activité)`.
> - `src/workflow/connectors.ts` — registre de connecteurs (Discord câblé en Phase 1).
> - `src/workflow/scheduler.ts` — planifie les workflows `cron` **activés** (no-op tant qu'aucun ne l'est).
> - `src/workflow/bootstrap.ts` — enregistrement idempotent des étapes + workflows.
> - `src/steps/{fetch,persist,notify}.ts` — étapes `fetch.sources`, `persist`, `notify.discord` déléguant aux services existants.
> - `src/modules/veille/workflows.ts` — définitions `veille.collect/digest/monthly` (`enabled: false`).
>
> Reste à faire pour clore la Phase 1 : implémenter `ai.summarize` (← `ai-filter`),
> brancher `scheduleWorkflows()` dans `scheduler.ts`, puis basculer `veille.*` en
> `enabled: true` à comportement constant et retirer les crons hérités.

Pas de file externe, pas de Redis — mono-processus, SQLite, comme le socle actuel.

- `engine.ts` — résout un `Workflow`, exécute ses `steps` en séquence en passant
  la sortie de l'un en entrée du suivant, journalise chaque étape dans la trace
  du run. **Dégradation gracieuse** : un connecteur mort fait *skip* l'étape, il
  ne fait pas échouer le run (exigence QA, ADR-0013).
- `runner.ts` — crée/clôt le `workflow_run`, applique les gardes de concurrence
  par module (généralisation de `publishRunning`/`collectRunning`).
- `registry.ts` — enregistre workflows + steps + connecteurs ; source de vérité
  pour le dashboard et le scheduler.
- `scheduler.ts` (évolution de `cron-manager`) — lit les triggers `cron` des
  workflows `enabled` et programme les ticks via `node-cron` (timezone
  Europe/Paris conservée).

```ts
// pseudo-code engine
export async function runWorkflow(wf: Workflow, ctx: StepContext) {
  const run = openRun(wf, ctx.activityId);
  let data: unknown = undefined;
  for (const def of wf.steps) {
    const step = registry.step(def.use);
    try {
      data = await step({ ...ctx, log: ctx.log.child({ step: def.use }) }, { ...def.with, ...(data as object) });
      run.trace.push({ step: def.use, status: 'ok' });
    } catch (err) {
      if (registry.step(def.use).degradable) { run.trace.push({ step: def.use, status: 'skipped' }); continue; }
      return failRun(run, err);
    }
  }
  return closeRun(run, data);
}
```

## 3. Catalogue d'étapes de base

| Step | Origine | Rôle |
|---|---|---|
| `fetch.sources` | `collect-service` + adapters | Collecte X/Reddit/HN |
| `ai.summarize` | `ai-filter` | Résumé thématique FR |
| `ai.score` | `intent-service` | Scoring de signaux/prospects |
| `ai.compose` | `content-studio` | Rédaction de brouillon (relance, post, reply) |
| `persist` | `tweet-store` / stores | Écriture idempotente en base |
| `decide` | nouveau | Branchement conditionnel (seuils, règles) |
| `notify.discord` | `discord-notifier` | Notification Discord |
| `notify.email` | nouveau | Notification e-mail |
| `stripe.list` / `stripe.invoice` | connecteur Stripe (MCP) | Factures, paiements |
| `calendar.pull` / `calendar.remind` | connecteur Google Calendar (MCP) | Agenda |

## 4. Connecteurs (généralisation des adaptateurs)

```ts
// src/connectors/registry.ts
export interface ConnectorRegistry {
  sources: Record<ItemSource, SourceReader>;  // x, reddit, hn
  discord: Notifier;
  email: Notifier;
  stripe: StripeConnector;     // MCP
  calendar: CalendarConnector; // Google Calendar MCP
  ai: AiConnector;             // GitHub Models / OpenAI SDK
}
```

Chaque connecteur expose une **santé** (`checkHealth()`) remontée dans le
cockpit : cookie X expiré, token Stripe invalide, calendrier déconnecté.

## 5. Arborescence cible

```
src/
├── workflow/
│   ├── types.ts            # Workflow, Trigger, Step, StepContext
│   ├── engine.ts           # exécution + dégradation gracieuse
│   ├── runner.ts           # workflow_runs + gardes concurrence
│   ├── registry.ts         # workflows + steps + connecteurs
│   └── scheduler.ts        # ex-cron-manager, triggers cron
├── steps/                  # catalogue d'étapes réutilisables
│   ├── fetch.ts ai.ts persist.ts decide.ts notify.ts
│   ├── stripe.ts calendar.ts
├── connectors/
│   ├── registry.ts
│   ├── sources/ (scraper, reddit, hn)   # ex-adapters
│   ├── discord.ts email.ts stripe.ts calendar.ts ai.ts
├── modules/
│   ├── cockpit/      workflows/daily-briefing.ts
│   ├── veille/       workflows/{collect,digest,monthly}.ts
│   ├── acquisition/  workflows/{scan-intent,draft-content}.ts
│   ├── crm/          workflows/followup-stale.ts        + store.ts
│   ├── facturation/  workflows/{sync-stripe,relance-impayes}.ts + store.ts
│   ├── compta/       workflows/{seuils,echeance-urssaf}.ts + store.ts
│   └── agenda/       workflows/{sync,rappels}.ts        + store.ts
├── db.ts                   # migrations idempotentes (étendu par module)
├── server.ts               # API Hono (route /workflows, /runs, + par module)
└── scheduler.ts            # entry point — boot serveur + moteur

frontend/src/pages/
├── cockpit.tsx   veille.tsx   acquisition.tsx
├── crm.tsx       facturation.tsx   compta.tsx   agenda.tsx
├── workflows.tsx (catalogue + activation)   runs.tsx   settings.tsx
```

## 6. Modèle de données (deltas par module)

Toutes les tables scopées par `product_id` (activité), migrations via
`addColumnIfMissing` / `CREATE TABLE IF NOT EXISTS` (idempotent).

```sql
-- Moteur
CREATE TABLE workflow_runs (        -- généralise runs
  id INTEGER PRIMARY KEY, product_id TEXT, workflow_id TEXT,
  trigger_type TEXT, status TEXT, started_at TEXT, finished_at TEXT,
  trace TEXT, summary TEXT, error_message TEXT);

-- Facturation
CREATE TABLE invoices (id TEXT PRIMARY KEY, product_id TEXT, contact_id TEXT,
  amount_cents INTEGER, currency TEXT, status TEXT, due_date TEXT,
  stripe_id TEXT, issued_at TEXT, paid_at TEXT);
CREATE TABLE quotes  (...);

-- Comptabilité
CREATE TABLE ledger (id INTEGER PRIMARY KEY, product_id TEXT, kind TEXT,
  amount_cents INTEGER, label TEXT, occurred_on TEXT, source TEXT);

-- CRM
CREATE TABLE contacts     (id TEXT PRIMARY KEY, product_id TEXT, name TEXT, ...);
CREATE TABLE deals        (id TEXT PRIMARY KEY, product_id TEXT, contact_id TEXT, stage TEXT, ...);
CREATE TABLE interactions (id INTEGER PRIMARY KEY, contact_id TEXT, kind TEXT, ...);

-- Agenda
CREATE TABLE calendar_events (id TEXT PRIMARY KEY, product_id TEXT,
  external_id TEXT, title TEXT, starts_at TEXT, ends_at TEXT, source TEXT);
```

## 7. API (extension de `server.ts`)

```
GET  /api/workflows                 # catalogue + état (enabled, dernier run)
POST /api/workflows/:id/run         # déclenchement manuel
PATCH /api/workflows/:id            # enabled, trigger
GET  /api/runs?workflow=&activity=  # journal (généralise /runs)
GET  /api/cockpit                   # agrégat du brief
GET  /api/facturation/invoices ...  # CRUD par module
```

## 8. Ordre de réimplémentation (rappel des phases)

1. **Moteur** — types, engine, runner, registry, scheduler ; replier veille
   dessus à comportement constant (ADR-0014).
2. **Cockpit** — `cockpit.daily-briefing` + écran d'accueil agrégé (ADR-0015).
3. **Facturation** — connecteur Stripe + relances (ADR-0016).
4. **Compta / CRM / Agenda** — en parallèle (ADR-0017+).
5. **Consolidation** — rename `product_id`→`activity_id`, retrait compat.

## 9. Invariants techniques

- **Strangler-fig** : le moteur ship en reproduisant l'existant ; modules
  derrière flag `enabled=false` par défaut.
- **Idempotence** des migrations et des étapes `persist` (réutilise
  `INSERT OR IGNORE`).
- **Dégradation gracieuse** : un connecteur mort *skip* son étape.
- **Jamais d'action en votre nom sans validation** (facture, mail, RDV stagés).
- **SQLite / WAL / mono-processus / mono-utilisateur** conservés.
- French côté utilisateur, English côté code (inchangé).
