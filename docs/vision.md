# Solopilot — Vision

> Le système d'exploitation autonome de l'entreprise d'une personne.

## Le problème

Un auto-entrepreneur porte seul tous les métiers d'une entreprise : commercial,
marketing, production, administratif, comptable, support. Chacun a son outil
(un pour la veille, un pour les factures, un pour l'agenda, un pour l'URSSAF, un
pour le CRM), aucun ne se parle, et le pilotage se fait de tête. Le temps passé
à _administrer_ l'activité est du temps qui n'est pas facturé.

## La proposition

Solopilot est un back-office unique et autonome. Au lieu d'empiler des outils,
on décrit son entreprise une fois (activités, clients, offres, voix) et on
laisse des **workflows** pilotés par IA faire tourner le quotidien :

- collecter ce qui se dit (veille),
- repérer et qualifier les prospects (acquisition),
- entretenir la relation client (CRM),
- émettre et relancer les factures (facturation),
- suivre le chiffre d'affaires et les échéances sociales (comptabilité),
- orchestrer l'agenda et les rappels (agenda),
- et condenser tout ça dans un **brief quotidien** unique le matin (cockpit).

L'humain garde la main sur les décisions ; la machine fait le travail répétitif,
prépare les brouillons, et alerte au bon moment. On ne se substitue jamais à
l'entrepreneur (pas d'envoi de message en son nom sans validation) — on le rend
autonome.

## Le principe directeur : tout est un workflow

Le bot actuel sait déjà faire une chose en deux temps : _collecter_ puis
_publier_. Solopilot généralise ce schéma en un **moteur de workflows** : chaque
processus métier (relancer une facture, préparer la déclaration URSSAF, scanner
les signaux d'achat, produire le brief du matin) est un workflow déclaratif, avec
un déclencheur, des étapes typées et un historique d'exécutions traçable.

Conséquence : ajouter une capacité métier = ajouter un workflow, pas réécrire la
plateforme. La veille IA d'aujourd'hui devient _un_ workflow parmi d'autres.

## Ce qui est réutilisé (le socle existant)

Rien n'est jeté. Le socle technique actuel devient l'infrastructure du moteur :

| Brique actuelle | Devient |
|---|---|
| `cron-manager.ts` | Le planificateur de workflows |
| table `runs` + `run-service.ts` | Le journal d'exécutions (`workflow_runs`) |
| `collect-service` / publish | Des **étapes** réutilisables (`fetch.sources`, `ai.summarize`, `notify`) |
| `products` | Les **activités** (lignes d'activité de l'entreprise) |
| adaptateurs X / Reddit / HN | Des **connecteurs source** |
| `discord-notifier` | Un **connecteur de notification** |
| intent-signals / studio / leads | Le module **Acquisition** |
| `ai-filter` | L'**étape IA** générique |
| Dashboard React | Le **cockpit** et les écrans par module |

## Les intégrations clés

L'environnement expose déjà les connecteurs qui font la différence pour un
auto-entrepreneur :

- **Stripe** → facturation, paiements, encaissements, relances.
- **Google Calendar** → agenda, rendez-vous, time-blocking, rappels.
- **GitHub Models / OpenAI SDK** → le cerveau (résumés, scoring, rédaction).
- **Discord / Email** → les canaux de notification du brief et des alertes.

## Hors périmètre (assumé)

- Multi-utilisateur, RBAC, équipes — Solopilot reste mono-propriétaire.
- Se substituer à un expert-comptable ou à un logiciel certifié de comptabilité.
  Solopilot _prépare_ et _rappelle_ ; il ne télédéclare pas à votre place sans
  validation, et ne remplace pas l'obligation de conformité.
- Auto-poster / répondre automatiquement en votre nom — c'est un assistant, pas
  un usurpateur.

## Critère de réussite

> « Le matin, j'ouvre Solopilot, je lis un seul brief, je valide trois
> brouillons, et mon administratif de la journée est fait. »
