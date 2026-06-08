# Catalogue des workflows Solopilot

Chaque capacité métier est un **workflow** : un déclencheur, des étapes typées,
un historique d'exécutions. Voir [reimplementation-plan.md](../reimplementation-plan.md).

Légende statut : ✅ existe (à replier sur le moteur) · 🆕 nouveau.

## Cockpit

| Workflow | Déclencheur | Étapes | Statut |
|---|---|---|---|
| `cockpit.daily-briefing` | cron `30 7 * * *` | `cockpit.aggregate` → `notify.discord` | ✅ défini (`enabled: false`) |

Le brief unique du matin : agenda du jour, factures impayées, échéances URSSAF à
venir, leads chauds, dernier digest de veille — condensé en un message.

## Veille (le bot actuel, replié sur le moteur)

| Workflow | Déclencheur | Étapes | Statut |
|---|---|---|---|
| `veille.collect` | cron `0 * * * *` | `fetch.sources` → `persist` | ✅ |
| `veille.digest` | cron `30 7 * * *` | `fetch.sources` → lire corpus → `ai.summarize` → `notify.discord` | ✅ |
| `veille.monthly` | cron mensuel | agréger digests → `ai.summarize` → `persist` | ✅ |

## Acquisition (intent signals + studio + leads existants)

| Workflow | Déclencheur | Étapes | Statut |
|---|---|---|---|
| `acquisition.scan-intent` | cron | `fetch.sources` → match patterns → `ai.score` → `ai.compose` (reply) → `notify` | ✅ |
| `acquisition.draft-content` | manuel | corpus → `ai.compose` (post) → staging | ✅ |

## Facturation (Stripe)

| Workflow | Déclencheur | Étapes | Statut |
|---|---|---|---|
| `facturation.sync-stripe` | cron `0 */6 * * *` | `stripe.list` → `persist` (état paiements) | 🆕 |
| `facturation.relance-impayes` | cron `0 9 * * *` | requête factures échues → `ai.compose` (relance) → `decide` → staging validation | 🆕 |
| `facturation.emettre` | manuel/event | devis accepté → `stripe.invoice` (staging) → `notify` | 🆕 |

> Toute émission/relance est **mise en attente de validation** — jamais envoyée
> en votre nom sans clic.

## Comptabilité & URSSAF

| Workflow | Déclencheur | Étapes | Statut |
|---|---|---|---|
| `compta.seuils` | cron quotidien | calcul CA glissant → `decide` (plafond micro / seuil TVA) → `notify` si approche | 🆕 |
| `compta.echeance-urssaf` | cron mensuel/trim. | CA de la période → préparer récap → `notify` rappel déclaration | 🆕 |

> **Rappel et préparation uniquement.** Solopilot ne télédéclare pas et ne
> remplace pas un expert-comptable.

## CRM

| Workflow | Déclencheur | Étapes | Statut |
|---|---|---|---|
| `crm.followup-stale` | cron quotidien | requête deals dormants → `ai.compose` (relance) → staging | 🆕 |
| `crm.promote-lead` | event (lead qualifié) | lead → créer contact/deal → `persist` | 🆕 |

## Agenda (Google Calendar)

| Workflow | Déclencheur | Étapes | Statut |
|---|---|---|---|
| `agenda.sync` | cron `*/30 * * * *` | `calendar.pull` → `persist` | 🆕 |
| `agenda.rappels` | cron quotidien | événements du jour → `notify` rappels / time-blocking | 🆕 |

---

## Convention de nommage

`<module>.<verbe-ou-objet>` — minuscules, tiret pour les mots composés.
Exemples : `facturation.relance-impayes`, `compta.echeance-urssaf`,
`cockpit.daily-briefing`.

## Anatomie d'une définition de workflow

```ts
export const relanceImpayes: Workflow = {
  id: 'facturation.relance-impayes',
  module: 'facturation',
  label: 'Relancer les factures impayées',
  trigger: { kind: 'cron', expr: '0 9 * * *' },
  version: 1,
  enabled: false, // activé après validation (rollout par flag)
  steps: [
    { use: 'facturation.query-overdue' },
    { use: 'ai.compose', with: { template: 'relance', voice: 'professionnel' } },
    { use: 'decide', with: { stageForApproval: true } },
    { use: 'notify.email' },
  ],
};
```
