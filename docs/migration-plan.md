# Plan de migration — X AI Weekly Bot → Solopilot

> Objectif : transformer le bot de veille en **Solopilot**, le back-office
> autonome de l'auto-entrepreneur, sans interruption de service ni réécriture.
> Voir [vision.md](vision.md) et [ADR-0013](adr/0013-from-bot-to-solopilot-workflow-platform.md).

## Principe : strangler-fig, jamais big-bang

Le moteur de workflows expédié en Phase 1 **reproduit à l'identique** le
comportement actuel (collecte horaire + digest 07:30). Chaque nouveau module
s'ajoute _à côté_, derrière un flag, et n'est activé qu'une fois éprouvé. À
aucun moment le déploiement de production ne perd une capacité existante.

Chaque phase est :
- indépendamment livrable et déployable,
- réversible (flag off + migration idempotente),
- conclue par un ADR dédié (0014+) quand elle touche l'architecture.

---

## Phase 0 — Renommage & identité (cette PR)

Le renommage est volontairement scindé en deux : ce qui est **sans risque**
(identité, docs) est fait ici ; ce qui touche l'**infra** (repo Git, GHCR, tags
d'image) est un checklist d'ops à exécuter délibérément pour ne pas casser la CI.

### Fait dans cette PR (sans risque)
- [x] `package.json` : `name` → `solopilot`, `description` réécrite.
- [x] `docs/vision.md`, `docs/migration-plan.md`, `docs/reimplementation-plan.md`.
- [x] `docs/adr/0013-...` (décision d'architecture).
- [x] `docs/workflows/catalog.md` (catalogue des workflows cibles).
- [x] `README.md`, `CLAUDE.md`, `AGENT.md` : nouvelle identité et périmètre.

### Checklist ops à exécuter manuellement (hors code, pour ne pas casser le déploiement)
> À faire en une fenêtre de maintenance, dans cet ordre :

1. **Renommer le dépôt GitHub** `wifsimster/x-ai-weekly-bot` → `wifsimster/solopilot`
   (Settings → Repository name). GitHub conserve les redirections automatiques.
2. **Mettre à jour les remotes locaux** : `git remote set-url origin git@github.com:wifsimster/solopilot.git`.
3. **GHCR** : le chemin d'image `ghcr.io/wifsimster/x-ai-weekly-bot` devient
   `ghcr.io/wifsimster/solopilot`. Mettre à jour, **dans une PR dédiée** :
   - les scripts `docker:build` / `docker:tag` / `docker:push` de `package.json`,
   - `compose.yml` (`image:`),
   - `.github/workflows/release.yml` (refs d'image),
   - `deploy/deploy.sh` et le chemin serveur `/opt/docker/x-ai-weekly-bot/`.
4. **Conserver l'ancienne image** taggée le temps que le serveur bascule, puis
   re-pull sous le nouveau nom (`docker compose pull && up -d`).

> ⚠️ Ces 4 points ne sont **pas** faits dans cette PR : les changer ici, avant
> de renommer GHCR, casserait `release.yml` au prochain merge sur `main`.

---

## Phase 1 — Moteur de workflows (le socle)

**But :** extraire le moteur générique et y replier la logique actuelle, à
comportement constant. **Voir [ADR-0014](adr/0014-workflow-engine.md).**

- [x] `src/workflow/` : `types.ts`, `engine.ts`, `runner.ts`, `registry.ts`,
      `run-store.ts`, `connectors.ts`, `scheduler.ts`, `bootstrap.ts`.
- [x] Catalogue d'étapes de base, par **délégation** à l'existant (strangler-fig) :
      `fetch.sources` (← `collect-service`), `ai.summarize` (← `ai-filter`),
      `persist` (← collecte), `notify.discord` (← `discord-notifier`).
- [x] `workflow_runs` : table dédiée + trace JSON, via migration idempotente.
      `runs` laissée intacte, les deux coexistent pendant la migration.
- [x] Gardes de concurrence généralisées par `(module, activité)` (←
      `publishRunning` / `collectRunning`).
- [x] Définir `veille.collect/digest/monthly` (définitions, `enabled: false`).
- [x] Smoke test de bout en bout (`npm run test:workflow`, 21 assertions / SQLite).
- [~] `cron-manager` → `WorkflowScheduler` : `scheduler.ts` écrit mais **non câblé**
      à l'entrypoint de prod (planifie uniquement les workflows `enabled`).
- [ ] `dev:once` exécute un workflow nommé plutôt que la publication codée en dur.
- [ ] **Flip** : implémenter le mark-as-used dans le workflow, brancher
      `scheduleWorkflows()`, basculer `veille.*` en `enabled: true` à comportement
      constant, retirer les crons hérités. *(étape qui change le comportement —
      déliberément différée, après rodage du moteur désactivé.)*

**Critère de sortie :** en prod, aucune différence observable. Mêmes runs, même
digest Discord à 07:30.

---

## Phase 2 — Cockpit (le brief quotidien)

**But :** une page d'accueil unique et un brief matinal agrégé — la valeur
« go-to » immédiate, avant même d'ajouter de nouveaux domaines.
**Voir [ADR-0015](adr/0015-cockpit-daily-briefing.md).**

- [x] Service d'agrégation `buildBriefing(activityId)` (lecture seule : veille,
      acquisition, santé workflows ; facturation/compta/agenda en `planned`).
- [x] Rendu markdown FR déterministe `renderBriefingText` (sans appel IA).
- [x] Workflow `cockpit.daily-briefing` (cron 07:30, `enabled: false`) =
      `[cockpit.aggregate, notify.discord]`.
- [x] API `GET /api/cockpit` + écran Cockpit (cartes par module, statuts `À venir`).
- [x] Smoke test étendu (agrégation + rendu + composabilité du workflow).
- [ ] Connecteur `notify.email` (en plus de Discord) pour le brief.
- [ ] Variante IA du brief + planification (fait partie du flip différé).

**Critère de sortie :** un brief quotidien unique remplace la lecture de
plusieurs écrans.

---

## Phase 3 — Facturation (Stripe)

**But :** le premier domaine administratif à fort ROI. Connecteur Stripe déjà
disponible dans l'environnement.

- [ ] Tables `invoices`, `quotes` (devis), scoping `product_id`.
- [ ] Connecteur `StripeConnector` (MCP) : lister factures/paiements, créer
      facture (staging + validation 1-clic).
- [ ] Workflow `facturation.sync-stripe` (cron) : importe l'état des paiements.
- [ ] Workflow `facturation.relance-impayes` (cron quotidien) : factures échues
      → `ai.compose` (brouillon de relance) → mise en attente de validation.
- [ ] Écran Facturation : devis, factures, encaissements, relances en attente.

**Critère de sortie :** plus aucune facture impayée oubliée ; relances en un
clic. ADR-0016 « Facturation ».

---

## Phase 4 — Comptabilité & URSSAF, CRM, Agenda

Trois modules indépendants, livrables en parallèle ou en séquence.

### Comptabilité
- [ ] Table `ledger` (recettes/dépenses), calcul du CA glissant.
- [ ] Workflow `compta.seuils` : surveille les plafonds micro-entreprise et le
      seuil de franchise TVA, alerte avant dépassement.
- [ ] Workflow `compta.echeance-urssaf` : rappel de déclaration (mensuel/trim.)
      avec CA pré-calculé. **Rappel + préparation, pas de télédéclaration.**

### CRM
- [ ] Tables `contacts`, `deals`, `interactions`. Les leads d'Acquisition se
      promeuvent en contacts.
- [ ] Workflow `crm.followup-stale` : relance les opportunités dormantes (brouillon).

### Agenda
- [ ] Connecteur `CalendarConnector` (Google Calendar MCP).
- [ ] Workflow `agenda.sync` : pull des événements → alimente le cockpit.
- [ ] Workflow `agenda.rappels` : rappels de RDV / time-blocking.

**Critère de sortie :** les six domaines métier tournent en workflows. ADR-0017+.

---

## Phase 5 — Nettoyage & consolidation

- [ ] Renommage profond `product_id` → `activity_id` (migration table-rebuild,
      sur le modèle de `rebuildMonthlySummariesIfLegacyUnique`).
- [ ] Retrait des vues de compat (`runs`).
- [ ] Documentation de chaque workflow dans `docs/workflows/`.
- [ ] Revue de sécurité des connecteurs (masquage tokens, périmètre Stripe).

---

## Tableau récapitulatif

| Phase | Livrable | Risque | Réversible | ADR |
|---|---|---|---|---|
| 0 | Renommage + identité + docs | Faible | Oui | 0013 |
| 1 | Moteur de workflows | Moyen | Oui (flag) | 0014 |
| 2 | Cockpit + brief | Faible | Oui | 0015 |
| 3 | Facturation (Stripe) | Moyen | Oui (flag) | 0016 |
| 4 | Compta / CRM / Agenda | Moyen | Oui (flag) | 0017+ |
| 5 | Consolidation | Faible | — | — |

## Garde-fous de migration (invariants)

1. **La prod ne régresse jamais.** Phase 1 est à comportement constant ;
   tout nouveau module est derrière un flag `off` par défaut.
2. **Migrations idempotentes uniquement** — réutiliser `addColumnIfMissing` /
   `CREATE TABLE IF NOT EXISTS` ; jamais de `DROP` destructif hors rebuild
   transactionnel encadré.
3. **Aucune action en votre nom sans validation** (factures, mails, RDV).
4. **Conformité honnête** : Solopilot rappelle et prépare, ne certifie ni ne
   télédéclare.
5. **SQLite, mono-utilisateur, in-process** restent les contraintes du socle.
