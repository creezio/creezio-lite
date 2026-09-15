/**
 * Scénario de base générique — visite du socle OS Creezio (sidebar,
 * recherche, assistant). Sert de démo « jour 1 » à toute marque qui n'a pas
 * encore déclaré son scénario produit, et de fixture aux gates kit.
 *
 * Aucun texte métier marque : uniquement les surfaces OS communes.
 */

import type { DemoScenario, DemoStep } from "./types.js";

export type GenericOsTourOptions = {
  /** Nom du produit affiché dans les cartes (ex. « Acme »). */
  productName: string;
  /** Route d'atterrissage de fin de visite (défaut `/`). */
  homeHref?: string;
};

export type OsFeatureChaptersOptions = {
  /** Inclut les chapitres réservés aux administrateurs (défaut `false`). */
  isAdmin?: boolean;
};

/** Titre de la page courante (h1 du contenu principal en priorité). */
const PAGE_TITLE_SELECTOR = "main h1, h1";

/** Chapitre standard : clic sur le libellé de nav + carte sur le titre de page. */
function clickChapter(
  slug: string,
  navLabel: string,
  title: string,
  body: string,
): DemoStep[] {
  return [
    {
      id: `os-${slug}-nav`,
      kind: "click",
      target: { text: navLabel },
      optional: true,
    },
    {
      id: `os-${slug}-carte`,
      kind: "highlight",
      target: { selector: PAGE_TITLE_SELECTOR },
      title,
      body,
      optional: true,
    },
  ];
}

/**
 * Chapitre admin : navigation directe (le groupe Admin de la sidebar peut
 * être replié — un clic sur le libellé échouerait) + carte sur le titre.
 */
function navigateChapter(
  slug: string,
  href: string,
  title: string,
  body: string,
): DemoStep[] {
  return [
    {
      id: `os-${slug}-nav`,
      kind: "navigate",
      href,
      optional: true,
    },
    {
      id: `os-${slug}-carte`,
      kind: "highlight",
      target: { selector: PAGE_TITLE_SELECTOR },
      title,
      body,
      optional: true,
    },
  ];
}

/**
 * Chapitres composables présentant les fonctionnalités natives de l'OS
 * Creezio : Tâches, Mails, Assistant IA, Préférences pour tous les rôles ;
 * `isAdmin: true` ajoute Collaborateurs, Configuration et les pages Admin
 * (Analytics, Database, Plugins, Intégrations, API, MCP, Logs API/MCP).
 *
 * Toutes les cibles sont `optional` (skip silencieux si la marque n'expose
 * pas la surface) et tous les ids sont préfixés `os-` — composables dans
 * n'importe quel scénario marque.
 */
export function osFeatureChapters(
  opts: OsFeatureChaptersOptions = {},
): DemoStep[] {
  const steps: DemoStep[] = [
    ...clickChapter(
      "taches",
      "Tâches",
      "Tâches",
      "Un kanban natif pour organiser le travail de l'équipe, colonne par colonne. L'assistant IA peut y créer des missions et suivre leur avancement.",
    ),
    ...clickChapter(
      "mails",
      "Mails",
      "Mails",
      "La boîte de réception connectée de l'équipe, directement dans l'application. Lisez, répondez et classez vos messages sans changer d'outil.",
    ),
    {
      id: "os-assistant-carte",
      kind: "highlight",
      target: { selector: "[data-creezio-assistant-ui]" },
      title: "Assistant IA",
      body: "L'assistant répond en s'appuyant sur les données réelles de votre espace. Il peut aussi agir dans l'interface à votre place, comme un collègue.",
      optional: true,
    },
    ...clickChapter(
      "parametres",
      "Préférences",
      "Préférences",
      "Chaque utilisateur ajuste ici son expérience : profil, apparence, notifications. Les réglages sont propres à votre compte et appliqués immédiatement.",
    ),
  ];

  if (opts.isAdmin) {
    steps.push(
      ...clickChapter(
        "collaborateurs",
        "Collaborateurs",
        "Collaborateurs",
        "Invitez votre équipe et gérez les comptes depuis cette page. Chaque collaborateur dispose de son propre accès sécurisé.",
      ),
      ...clickChapter(
        "configuration",
        "Configuration",
        "Configuration",
        "Le centre de contrôle de l'application : identité, modules et comportements globaux. Une page réservée aux administrateurs de l'espace.",
      ),
      ...navigateChapter(
        "analytics",
        "/admin/analytics",
        "Analytics",
        "Suivez l'usage réel de l'application : activité, volumes et tendances. Des indicateurs prêts à l'emploi, sans configuration.",
      ),
      ...navigateChapter(
        "database",
        "/admin/database",
        "Database",
        "Explorez et modifiez les données directement depuis l'administration. Chaque table est consultable et éditable en toute sécurité.",
      ),
      ...navigateChapter(
        "plugins",
        "/admin/plugins",
        "Plugins",
        "Étendez l'application avec des plugins installables à chaud. Chacun s'exécute isolé, avec ses propres données.",
      ),
      ...navigateChapter(
        "integrations",
        "/admin/integrations",
        "Intégrations",
        "Connectez vos services tiers et gérez leurs clés au même endroit. Les intégrations deviennent ensuite disponibles pour les modules et les automatisations.",
      ),
      ...navigateChapter(
        "api",
        "/admin/api",
        "API",
        "Une façade HTTP complète expose vos données aux outils externes. Créez des clés d'accès et suivez leur utilisation depuis cette page.",
      ),
      ...navigateChapter(
        "mcp",
        "/admin/mcp",
        "MCP",
        "Le serveur MCP permet aux agents IA externes de piloter l'application. Vous contrôlez ici les accès et les outils exposés.",
      ),
      ...navigateChapter(
        "request-logs",
        "/admin/request-logs",
        "Logs API / MCP",
        "Chaque requête API ou MCP est journalisée ici en détail. Idéal pour auditer les accès et diagnostiquer un comportement inattendu.",
      ),
    );
  }

  return steps;
}

/** Visite guidée générique du shell OS (nav, chapitres OS, assistant). */
export function genericOsTourScenario(
  opts: GenericOsTourOptions,
): DemoScenario {
  const product = opts.productName;
  const home = opts.homeHref ?? "/";
  return {
    id: "os-tour",
    title: `Découvrir ${product}`,
    description: "Visite guidée des surfaces de base de l'application.",
    enabled: true,
    autoStart: false,
    steps: [
      {
        id: "welcome",
        kind: "say",
        title: `Bienvenue sur ${product}`,
        body: "Suivez le curseur : cette visite guidée vous présente l'application en direct. Vous pouvez la quitter à tout moment.",
      },
      {
        id: "sidebar",
        kind: "highlight",
        target: { selector: "aside, nav" },
        title: "Votre espace de travail",
        body: "La navigation regroupe toutes les sections de l'application. Chaque module y ajoute automatiquement son entrée.",
        optional: true,
      },
      ...osFeatureChapters({ isAdmin: false }),
      {
        id: "end",
        kind: "navigate",
        href: home,
        title: "À vous de jouer",
        body: "Vous pouvez relancer cette visite à tout moment depuis le bouton « Visite guidée ».",
      },
    ],
  };
}
