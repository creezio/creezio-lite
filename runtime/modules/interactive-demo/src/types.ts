/**
 * Contrat déclaratif des scénarios de démo interactive.
 *
 * Un scénario = une liste ordonnée d'étapes JSON-sérialisables : c'est ce
 * format qui vit en DB (overrides) et dans le fichier de défauts marque
 * (`server/src/electron/brand-interactive-demo-content.ts`). Ajouter /
 * enlever / réordonner des étapes = éditer ce tableau, rien d'autre.
 */

/**
 * Désignation d'un élément de la page.
 *
 * - `string` : essayé comme sélecteur CSS, puis comme `data-aid`, puis comme
 *   libellé d'élément interactif (texte visible / aria-label / placeholder) ;
 * - objet : critères explicites, essayés dans l'ordre `selector` → `aid` →
 *   `text` — `within` restreint la recherche à un conteneur (sélecteur CSS).
 */
export type DemoTarget =
  | string
  | {
      /** Sélecteur CSS exact. */
      selector?: string;
      /** Valeur de l'attribut `data-aid` (kit shell-ui). */
      aid?: string;
      /** Libellé d'élément interactif (match exact puis inclusif, accents ignorés). */
      text?: string;
      /** Sélecteur CSS du conteneur dans lequel chercher. */
      within?: string;
    };

/** Champs communs à toutes les étapes. */
export type DemoStepBase = {
  /** Id stable (clé d'édition — jamais renommer une étape publiée). */
  id: string;
  /** Titre affiché dans la carte de narration. */
  title?: string;
  /** Texte de la carte (phrases courtes, markdown non interprété). */
  body?: string;
  /**
   * Étape tolérante : cible introuvable → l'étape est sautée avec une note
   * discrète au lieu d'interrompre la démo. Défaut `true` pour les étapes
   * DOM-dépendantes (une démo ne doit jamais bloquer l'utilisateur).
   */
  optional?: boolean;
  /** Avance automatique après N ms (sinon attente du bouton « Suivant »). */
  autoAdvanceMs?: number;
  /** Pause avant l'exécution de l'étape (laisser la page se poser). */
  delayMs?: number;
  /** Timeout de résolution de cible (défaut 6000 ms). */
  timeoutMs?: number;
};

/** Carte de narration plein écran (pas de cible). */
export type DemoSayStep = DemoStepBase & { kind: "say"; title: string };

/** Navigation SPA vers une route de l'app. */
export type DemoNavigateStep = DemoStepBase & { kind: "navigate"; href: string };

/** Spotlight + carte ancrée sur un élément (sans interaction). */
export type DemoHighlightStep = DemoStepBase & {
  kind: "highlight";
  target: DemoTarget;
  /** Placement préféré de la carte (défaut `auto`). */
  placement?: "top" | "bottom" | "left" | "right" | "auto";
};

/** Le faux curseur se déplace jusqu'à la cible et clique réellement. */
export type DemoClickStep = DemoStepBase & { kind: "click"; target: DemoTarget };

/** Le faux curseur clique un champ puis tape le texte caractère par caractère. */
export type DemoTypeStep = DemoStepBase & {
  kind: "type";
  target: DemoTarget;
  text: string;
  /** Envoie Entrée + submit du formulaire après la frappe. */
  submit?: boolean;
};

/** Défilement d'une page (ou jusqu'à une cible). */
export type DemoScrollStep = DemoStepBase & {
  kind: "scroll";
  direction?: "down" | "up";
  target?: DemoTarget;
};

/** Pause simple. */
export type DemoWaitStep = DemoStepBase & { kind: "wait"; ms: number };

/**
 * Attente active d'une condition de page (polling, même cadence que la
 * résolution de cible) :
 *
 * - `target` posé (sans `absent`) → attendre que la cible EXISTE ;
 * - `target` + `absent: true` → attendre que la cible N'EXISTE PLUS ;
 * - `url` posé → attendre que `location.pathname` commence par `url` ;
 * - `target` + `url` → ET logique des deux conditions.
 *
 * Au moins un des deux critères (`target` ou `url`) est requis. Timeout
 * défaut 8000 ms ; au timeout, même politique que la cible introuvable
 * (`optional !== false` → étape sautée avec note ; `optional: false` →
 * démo interrompue). Étape silencieuse par défaut : la carte n'est
 * affichée pendant l'attente que si `title`/`body` sont posés.
 */
export type DemoWaitForStep = DemoStepBase & {
  kind: "waitFor";
  /** Cible attendue (présente, ou absente si `absent: true`). */
  target?: DemoTarget;
  /** Inverse la condition cible : attendre la disparition. */
  absent?: boolean;
  /** Préfixe attendu de `location.pathname` (doit commencer par `/`). */
  url?: string;
};

export type DemoStep =
  | DemoSayStep
  | DemoNavigateStep
  | DemoHighlightStep
  | DemoClickStep
  | DemoTypeStep
  | DemoScrollStep
  | DemoWaitStep
  | DemoWaitForStep;

export type DemoStepKind = DemoStep["kind"];

/** Scénario complet (défauts marque OU résultat du merge défauts + override). */
export type DemoScenario = {
  /** Id stable (clé de merge défauts/override). */
  id: string;
  /** Titre affiché dans le lanceur et la carte d'intro. */
  title: string;
  /** Sous-titre du lanceur. */
  description?: string;
  /** `false` = scénario désactivé (jamais proposé). Défaut `true`. */
  enabled?: boolean;
  /**
   * Candidat au lancement automatique à la première visite (après setup /
   * onboarding). Un seul scénario `autoStart` est lancé ; « déjà vu » est
   * persisté par utilisateur (preferences + localStorage).
   */
  autoStart?: boolean;
  /**
   * Rôles autorisés à voir le scénario dans le lanceur et l'autoStart.
   * Absent ou vide = visible pour tous. Un lancement explicite
   * (`startInteractiveDemo(id)`) ignore ce filtre.
   */
  roles?: string[];
  steps: DemoStep[];
};

/**
 * Override partiel stocké en DB (une ligne par scénario) : les champs
 * présents priment sur les défauts. `steps` fourni = REMPLACE le tableau
 * entier (édition explicite : ajouter/enlever/réordonner sans règles de
 * merge ambiguës). Un override dont l'id est inconnu des défauts et qui
 * porte `title` + `steps` devient un scénario additionnel.
 */
export type DemoScenarioOverride = Partial<DemoScenario> & { id: string };

const STEP_KINDS: readonly DemoStepKind[] = [
  "say",
  "navigate",
  "highlight",
  "click",
  "type",
  "scroll",
  "wait",
  "waitFor",
];

/**
 * Filtre par rôle du lanceur et de l'autoStart : un scénario sans `roles`
 * (ou avec un tableau vide) est visible pour tous ; `role` null/undefined
 * = pas de filtrage (comportement historique).
 */
export function scenarioMatchesRole(
  scenario: Pick<DemoScenario, "roles">,
  role?: string | null,
): boolean {
  if (role == null) return true;
  const roles = scenario.roles;
  if (!Array.isArray(roles) || roles.length === 0) return true;
  return roles.includes(role);
}

function isValidTarget(t: unknown): boolean {
  if (typeof t === "string") return t.trim().length > 0;
  if (!t || typeof t !== "object" || Array.isArray(t)) return false;
  const o = t as Record<string, unknown>;
  return ["selector", "aid", "text"].some(
    (k) => typeof o[k] === "string" && (o[k] as string).trim().length > 0,
  );
}

/**
 * Validation pure d'un scénario (défauts marque ou scénario mergé) —
 * renvoie la liste des erreurs (vide = valide). Jamais de throw.
 */
export function validateDemoScenario(scenario: unknown): string[] {
  const errors: string[] = [];
  if (!scenario || typeof scenario !== "object" || Array.isArray(scenario)) {
    return ["scenario_invalide"];
  }
  const s = scenario as Partial<DemoScenario>;
  if (typeof s.id !== "string" || !s.id.trim()) errors.push("id_requis");
  if (typeof s.title !== "string" || !s.title.trim()) errors.push("titre_requis");
  if (
    s.roles !== undefined &&
    (!Array.isArray(s.roles) ||
      s.roles.some((r) => typeof r !== "string" || !r.trim()))
  ) {
    errors.push("roles_invalide");
  }
  if (!Array.isArray(s.steps) || s.steps.length === 0) {
    errors.push("etapes_requises");
    return errors;
  }
  const seen = new Set<string>();
  s.steps.forEach((step, i) => {
    const at = `etape_${i}`;
    if (!step || typeof step !== "object") {
      errors.push(`${at}_invalide`);
      return;
    }
    const st = step as Partial<DemoStep> & Record<string, unknown>;
    if (typeof st.id !== "string" || !st.id.trim()) errors.push(`${at}_id_requis`);
    else if (seen.has(st.id)) errors.push(`${at}_id_duplique`);
    else seen.add(st.id);
    if (!STEP_KINDS.includes(st.kind as DemoStepKind)) {
      errors.push(`${at}_kind_invalide`);
      return;
    }
    switch (st.kind) {
      case "say":
        if (typeof st.title !== "string" || !st.title.trim()) {
          errors.push(`${at}_titre_requis`);
        }
        break;
      case "navigate":
        if (typeof st.href !== "string" || !(st.href as string).startsWith("/")) {
          errors.push(`${at}_href_invalide`);
        }
        break;
      case "highlight":
      case "click":
        if (!isValidTarget(st.target)) errors.push(`${at}_cible_invalide`);
        break;
      case "type":
        if (!isValidTarget(st.target)) errors.push(`${at}_cible_invalide`);
        if (typeof st.text !== "string") errors.push(`${at}_texte_requis`);
        break;
      case "scroll":
        if (st.target !== undefined && !isValidTarget(st.target)) {
          errors.push(`${at}_cible_invalide`);
        }
        break;
      case "wait":
        if (typeof st.ms !== "number" || !(st.ms > 0)) errors.push(`${at}_ms_invalide`);
        break;
      case "waitFor": {
        const hasTarget = st.target !== undefined;
        const hasUrl = st.url !== undefined;
        if (!hasTarget && !hasUrl) {
          errors.push(`${at}_cible_ou_url_requise`);
          break;
        }
        if (hasTarget && !isValidTarget(st.target)) {
          errors.push(`${at}_cible_invalide`);
        }
        if (
          hasUrl &&
          (typeof st.url !== "string" || !(st.url as string).startsWith("/"))
        ) {
          errors.push(`${at}_url_invalide`);
        }
        break;
      }
    }
  });
  return errors;
}
