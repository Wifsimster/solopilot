/**
 * Guided product tour — declarative step list.
 *
 * Each step optionally navigates to a `route` and spotlights the DOM element
 * carrying the matching `data-tour` attribute (`target`). When the target is
 * not present (e.g. the desktop sidebar on a mobile viewport) the step falls
 * back to a centered card so the copy is still shown. Keep copy in French to
 * match the rest of the UI.
 */
export interface TourStep {
  /** Stable id (also used as React key). */
  id: string;
  /** `data-tour` value of the element to spotlight. Omit for a centered step. */
  target?: string;
  /** Route to navigate to before showing the step. */
  route?: string;
  /** Preferred placement of the explanation card relative to the target. */
  placement?: 'right' | 'left' | 'top' | 'bottom';
  title: string;
  body: string;
}

export const TOUR_STORAGE_KEY = 'solopilot_tour_v1_done';
export const TOUR_START_EVENT = 'solopilot:start-tour';

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    title: 'Bienvenue dans Solopilot 👋',
    body: "Solopilot est votre back-office autonome. Voici une visite rapide des fonctionnalités clés. Vous pourrez la relancer à tout moment depuis la barre latérale.",
  },
  {
    id: 'sidebar',
    target: 'sidebar-nav',
    route: '/',
    placement: 'right',
    title: 'Votre navigation',
    body: "Toutes les fonctionnalités sont rangées par intention : Monitorer, Engager, Gérer et Configurer.",
  },
  {
    id: 'dashboard',
    target: 'nav-dashboard',
    route: '/',
    placement: 'right',
    title: 'Dashboard',
    body: "Le tableau de bord de la veille : derniers runs, statistiques et synthèse IA du jour en un coup d'œil.",
  },
  {
    id: 'cockpit',
    target: 'nav-cockpit',
    route: '/',
    placement: 'right',
    title: 'Cockpit',
    body: "Le briefing transversal : veille, acquisition, facturation, comptabilité et agenda réunis en une seule vue.",
  },
  {
    id: 'summaries',
    target: 'nav-summaries',
    route: '/',
    placement: 'right',
    title: 'Synthèses',
    body: "Retrouvez les synthèses IA quotidiennes et mensuelles, avec recherche et historique complet.",
  },
  {
    id: 'workflows',
    target: 'nav-workflows',
    route: '/',
    placement: 'right',
    title: 'Workflows',
    body: "Le moteur qui orchestre tout : déclencheurs cron, événements et webhooks, par module métier.",
  },
  {
    id: 'leads',
    target: 'nav-leads',
    route: '/',
    placement: 'right',
    title: 'Opportunités',
    body: "Les signaux d'intention détectés dans la veille — à traiter, reporter, répondre ou écarter.",
  },
  {
    id: 'crm',
    target: 'nav-crm',
    route: '/',
    placement: 'right',
    title: 'CRM',
    body: 'Vos contacts et votre pipeline de deals, du premier échange à la signature.',
  },
  {
    id: 'studio',
    target: 'nav-studio',
    route: '/',
    placement: 'right',
    title: 'Studio',
    body: "L'atelier de contenu : brouillons générés par l'IA à éditer, copier et publier.",
  },
  {
    id: 'facturation',
    target: 'nav-facturation',
    route: '/',
    placement: 'right',
    title: 'Facturation',
    body: 'Vos factures et encaissements Stripe, avec leur statut de paiement.',
  },
  {
    id: 'comptabilite',
    target: 'nav-comptabilite',
    route: '/',
    placement: 'right',
    title: 'Comptabilité',
    body: 'Le suivi du chiffre d’affaires et des cotisations URSSAF, prêt à déclarer.',
  },
  {
    id: 'agenda',
    target: 'nav-agenda',
    route: '/',
    placement: 'right',
    title: 'Agenda',
    body: 'Votre calendrier et vos événements à venir, synchronisés avec Google Calendar.',
  },
  {
    id: 'products',
    target: 'nav-products',
    route: '/',
    placement: 'right',
    title: 'Produits',
    body: 'Configurez les produits suivis et leurs sources de veille (X, Reddit, Hacker News, intentions).',
  },
  {
    id: 'product-switcher',
    target: 'product-switcher',
    route: '/',
    placement: 'top',
    title: 'Sélecteur de produit',
    body: 'Basculez entre vos produits : tout le tableau de bord se met à jour pour le produit choisi.',
  },
  {
    id: 'theme',
    target: 'theme-switcher',
    route: '/',
    placement: 'top',
    title: 'Thème',
    body: 'Choisissez l’apparence claire, sombre ou automatique selon votre système.',
  },
  {
    id: 'settings',
    target: 'nav-settings',
    route: '/',
    placement: 'right',
    title: 'Paramètres',
    body: 'Cookies de session X, identifiants GraphQL et réglages globaux se configurent ici.',
  },
  {
    id: 'done',
    title: 'Vous êtes prêt 🚀',
    body: "C'est terminé ! Relancez cette visite quand vous le souhaitez via « Visite guidée » en bas de la barre latérale.",
  },
];
