/**
 * ProductModel — contrat intermédiaire entre un brief produit (PRD) et le scaffold.
 *
 * Le brief reste non technique. Le parsing produit un modèle structuré que les
 * générateurs **génériques** consomment (CRUD + wiring OS).
 *
 * Anti-triche : on n’injecte PAS un clone kit (optimiser/scan/stack…).
 * Le cœur inféré du PRD « fournisseurs → prix → panier → commande » suffit
 * pour le bootstrap ; les modules suivants sont écrits par l’agent (mini-PRDs).
 */

export type FieldType = "text" | "number" | "date" | "boolean" | "ref" | "json";

export interface ProductField {
  name: string;
  type: FieldType;
  required?: boolean;
  ref?: string;
  label?: string;
}

export interface ProductEntity {
  id: string;
  label: string;
  labelPlural: string;
  fields: ProductField[];
  archivable?: boolean;
  /**
   * Permission par module (opt-in) — threadée sur l'EntitySpec généré
   * (`spec.permission`, garde `authorizeModuleAccess`) ET l'entrée de nav
   * du module (`BrandNavItem.permission`, sidebar filtrée). Utilisée par
   * les apps admin (`adminProductModel` — permissions ADMIN_MODULE_PERMISSIONS
   * de @creezio/admin) ; absente = comportement historique (garde session
   * de bordure seule).
   */
  permission?: string;
}

export interface ProductPage {
  id: string;
  path: string;
  title: string;
  entityId?: string;
  kind: "list" | "detail" | "form" | "flow" | "dashboard";
  /** Permission de l'entrée de nav de la page (voir ProductEntity.permission). */
  permission?: string;
}

export interface ProductFlow {
  id: string;
  label: string;
  steps: string[];
}

export interface PlatformNeeds {
  auth: boolean;
  desktop: boolean;
  pluginApi: boolean;
  chat: boolean;
  sync: boolean;
  /**
   * Parcours produit `/onboarding` après setup.
   * `false` = demo / app sans étapes (post-setup → home).
   * Absent = laisser le défaut kit (activé côté brand-spec / features).
   */
  onboarding?: boolean;
}

export interface ProductModel {
  brandId: string;
  brandName: string;
  domain: string;
  tagline: string;
  entities: ProductEntity[];
  pages: ProductPage[];
  flows: ProductFlow[];
  platformNeeds: PlatformNeeds;
  sourcePrdPath?: string;
  /**
   * Vertical détecté — champ LIBRE (aligné sur le contrat OS brand-spec).
   * La factory connaît `chr` comme générateur legacy assumé (`isChrModel`),
   * mais aucun type n'énumère les verticaux.
   */
  vertical?: string;
  /**
   * Preset de feed Meili (brand.yaml `meili.feedPreset`) — id du registre
   * factory (`generators/meili-feed-presets.ts`) ; prioritaire sur le
   * vertical pour le rendu du feed. `none`/`custom` = pas de preset.
   */
  meiliFeedPreset?: string;
}

const RESERVED_BRAND_IDS = new Set([
  "tempoflow",
  "certivan",
  "fidu",
  "creezio",
  "demobrand",
]);

export function safeBrandId(raw: string): string {
  let id = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .replace(/^[0-9]+/, "")
    .slice(0, 32);
  if (!id) id = "brandapp";
  if (RESERVED_BRAND_IDS.has(id)) id = `${id}3`;
  return id;
}

export function defaultPlatformNeeds(): PlatformNeeds {
  return {
    auth: true,
    desktop: true,
    pluginApi: true,
    chat: true,
    sync: false,
  };
}

const STUB_FILL_RE = /\(à remplir\)/i;

/** Marqueur de spec / PRD non rempli — apply métier interdit. */
export function isProductSpecStub(text: string): boolean {
  return STUB_FILL_RE.test(text);
}

/**
 * @deprecated `creezio demo-app` est retiré. Utiliser `creezio brand create`.
 * Plus aucun module `notes` par défaut.
 */
export function blankAppModel(opts: {
  brandId: string;
  brandName: string;
  domain: string;
}): ProductModel {
  return {
    brandId: safeBrandId(opts.brandId),
    brandName: opts.brandName,
    domain: opts.domain,
    tagline: "App vierge sur OS Creezio — serveur Docker par défaut",
    vertical: "generic",
    entities: [],
    pages: [
      {
        id: "dashboard",
        path: "/dashboard",
        title: "Dashboard",
        kind: "dashboard",
      },
    ],
    flows: [],
    platformNeeds: { ...defaultPlatformNeeds(), onboarding: false },
  };
}

/**
 * CHR uniquement si `vertical: chr` est déclaré (jamais d'inférence).
 * Générateur legacy assumé (fixture --from-prd historique) : la factory PEUT
 * connaître ce vertical — le contrat OS (brand-spec), lui, ne l'énumère plus.
 */
export function isChrModel(model: ProductModel): boolean {
  return model.vertical === "chr";
}

/**
 * Cœur minimum déduit du PRD « fournisseurs → prix → panier → commande ».
 * Pas de modules bonus (optimiser, scan, stack…) — ceux-là = agent + mini-PRDs.
 */
export function corePurchaseEntities(): ProductEntity[] {
  return [
    {
      id: "fournisseurs",
      label: "Fournisseur",
      labelPlural: "Fournisseurs",
      archivable: true,
      fields: [
        { name: "nom", type: "text", required: true, label: "Nom" },
        { name: "contact", type: "text", label: "Contact" },
        { name: "email", type: "text", label: "Email" },
        { name: "telephone", type: "text", label: "Téléphone" },
        { name: "site_web", type: "text", label: "Site web" },
        { name: "notes", type: "text", label: "Notes" },
      ],
    },
    {
      id: "produits",
      label: "Produit",
      labelPlural: "Produits",
      archivable: true,
      fields: [
        { name: "nom", type: "text", required: true, label: "Nom" },
        { name: "unite", type: "text", label: "Unité" },
        { name: "categorie", type: "text", label: "Catégorie" },
        {
          name: "fournisseur_id",
          type: "ref",
          ref: "fournisseurs",
          label: "Fournisseur",
        },
      ],
    },
    {
      id: "prix",
      label: "Prix",
      labelPlural: "Prix",
      fields: [
        {
          name: "produit_id",
          type: "ref",
          ref: "produits",
          required: true,
          label: "Produit",
        },
        {
          name: "fournisseur_id",
          type: "ref",
          ref: "fournisseurs",
          required: true,
          label: "Fournisseur",
        },
        { name: "montant", type: "number", required: true, label: "Montant HT" },
        { name: "devise", type: "text", label: "Devise" },
        { name: "promo", type: "boolean", label: "Promo" },
        { name: "promo_label", type: "text", label: "Libellé promo" },
      ],
    },
    {
      id: "panier_lignes",
      label: "Ligne panier",
      labelPlural: "Panier",
      fields: [
        {
          name: "produit_id",
          type: "ref",
          ref: "produits",
          required: true,
          label: "Produit",
        },
        {
          name: "fournisseur_id",
          type: "ref",
          ref: "fournisseurs",
          required: true,
          label: "Fournisseur",
        },
        { name: "quantite", type: "number", required: true, label: "Quantité" },
        { name: "prix_unitaire", type: "number", label: "Prix unitaire" },
      ],
    },
    {
      id: "commandes",
      label: "Commande",
      labelPlural: "Commandes",
      fields: [
        {
          name: "fournisseur_id",
          type: "ref",
          ref: "fournisseurs",
          required: true,
          label: "Fournisseur",
        },
        { name: "statut", type: "text", required: true, label: "Statut" },
        { name: "total_ht", type: "number", label: "Total HT" },
        { name: "notes", type: "text", label: "Notes" },
      ],
    },
  ];
}

export function corePurchasePages(): ProductPage[] {
  return [
    { id: "dashboard", path: "/dashboard", title: "Dashboard", kind: "dashboard" },
    {
      id: "fournisseurs",
      path: "/fournisseurs",
      title: "Fournisseurs",
      entityId: "fournisseurs",
      kind: "list",
    },
    {
      id: "produits",
      path: "/produits",
      title: "Produits",
      entityId: "produits",
      kind: "list",
    },
    { id: "prix", path: "/prix", title: "Prix", entityId: "prix", kind: "list" },
    {
      id: "panier",
      path: "/panier",
      title: "Panier",
      entityId: "panier_lignes",
      kind: "flow",
    },
    {
      id: "commandes",
      path: "/commandes",
      title: "Commandes",
      entityId: "commandes",
      kind: "list",
    },
  ];
}

export function coreOrderFlow(): ProductFlow {
  return {
    id: "commande_fournisseur",
    label: "Commander chez un fournisseur",
    steps: ["fournisseurs", "produits", "prix", "panier", "commandes"],
  };
}

/** @deprecated alias — préférer corePurchaseEntities (cœur PRD, pas catalogue oracle). */
export const chrCatalogEntities = corePurchaseEntities;
/** @deprecated alias */
export const chrCatalogPages = corePurchasePages;
/** @deprecated alias */
export const chrOrderFlow = coreOrderFlow;

function extractBrandName(text: string, fallbackH1: string): string {
  const fromNom = text.match(/^\s*Nom\s*:\s*(.+)$/im)?.[1]?.trim();
  if (fromNom) return fromNom.replace(/[.。].*$/, "").trim();
  const fromProductBold = text.match(
    /\*\*([A-Za-z][A-Za-z0-9][A-Za-z0-9 _-]{1,40})\*\*\s*[—–-]\s*application/i,
  )?.[1]?.trim();
  if (fromProductBold) return fromProductBold;
  const cleaned = fallbackH1
    .replace(/\s*[—–-].*$/, "")
    .replace(/^PRD(\s+produit)?\s+/i, "")
    .trim();
  return cleaned || "BrandApp";
}

function slugEntityId(raw: string): string {
  const id = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return id || "entite";
}

function fieldTypeFromHint(hint: string): FieldType {
  const h = hint.toLowerCase();
  if (/nombre|number|int|prix|montant|quantit/.test(h)) return "number";
  if (/date|datetime/.test(h)) return "date";
  if (/bool|oui\/non/.test(h)) return "boolean";
  if (/json|objet/.test(h)) return "json";
  if (/ref|fk|id_/.test(h)) return "ref";
  return "text";
}

function singularizeFr(plural: string): string {
  const t = plural.trim();
  if (/articles$/i.test(t)) return t.replace(/articles$/i, "Article");
  if (/s$/i.test(t) && t.length > 3) return t.slice(0, -1);
  return t;
}

function extractEntitiesFromMarkdown(text: string): ProductEntity[] {
  const heading = text.match(/^##\s+Entit[ée]s\b[^\n]*/im);
  if (!heading || heading.index === undefined) return [];
  const afterHeading = text.slice(heading.index + heading[0].length).replace(
    /^\r?\n/,
    "",
  );
  const nextH2 = afterHeading.search(/^##\s/m);
  const body = nextH2 === -1 ? afterHeading : afterHeading.slice(0, nextH2);
  const entities: ProductEntity[] = [];
  const headingRe = /^###\s+(.+)$/gm;
  const headings = [...body.matchAll(headingRe)];
  if (headings.length) {
    for (let i = 0; i < headings.length; i++) {
      const title = headings[i]![1]!.trim();
      const start = headings[i]!.index! + headings[i]![0].length;
      const end = headings[i + 1]?.index ?? body.length;
      const chunk = body.slice(start, end);
      const id = slugEntityId(title);
      const fields: ProductField[] = [];
      for (const line of chunk.split("\n")) {
        const m = line.match(/^\s*[-*]\s+([A-Za-zÀ-ÿ][\wÀ-ÿ]*)\s*(?:\(([^)]+)\))?/);
        if (!m) continue;
        const name = slugEntityId(m[1]!);
        if (!name || name === id) continue;
        fields.push({
          name,
          type: fieldTypeFromHint(m[2] || "texte"),
          required: /requis|required/i.test(m[2] || ""),
          label: m[1],
        });
      }
      if (!fields.length) {
        fields.push({ name: "titre", type: "text", required: true, label: "Titre" });
      }
      entities.push({
        id,
        label: singularizeFr(title),
        labelPlural: title,
        archivable: true,
        fields,
      });
    }
    return entities;
  }
  for (const line of body.split("\n")) {
    const m = line.match(/^\s*[-*]\s+([A-Za-zÀ-ÿ][\wÀ-ÿ -]{1,40})\s*$/);
    if (!m) continue;
    const title = m[1]!.trim();
    if (STUB_FILL_RE.test(title)) continue;
    const id = slugEntityId(title);
    entities.push({
      id,
      label: singularizeFr(title),
      labelPlural: title,
      archivable: true,
      fields: [
        { name: "titre", type: "text", required: true, label: "Titre" },
      ],
    });
  }
  return entities;
}

function pagesFromEntities(entities: ProductEntity[]): ProductPage[] {
  return [
    { id: "dashboard", path: "/dashboard", title: "Dashboard", kind: "dashboard" },
    ...entities.map((e) => ({
      id: e.id,
      path: `/${e.id}`,
      title: e.labelPlural,
      entityId: e.id,
      kind: "list" as const,
    })),
  ];
}

function detectExplicitVertical(
  text: string,
  optsVertical?: string,
): string {
  const explicit = optsVertical?.trim();
  if (explicit) return explicit;
  const line = text.match(/^\s*vertical\s*:\s*([a-z][a-z0-9-]*)\s*$/im);
  return line?.[1] || "generic";
}

export function parseProductPrd(
  markdown: string,
  opts?: {
    sourcePath?: string;
    brandId?: string;
    brandName?: string;
    vertical?: string;
  },
): ProductModel {
  const text = markdown.replace(/\r\n/g, "\n");
  if (isProductSpecStub(text)) {
    throw new Error(
      "product.md est un stub « (à remplir) » — extraire les entités ou remplir le PRD avant apply (pas de fallback notes)",
    );
  }
  const h1 = text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "Nouvelle app";
  const brandName =
    opts?.brandName?.trim() || extractBrandName(text, h1) || "BrandApp";
  const brandId = opts?.brandId
    ? safeBrandId(opts.brandId)
    : safeBrandId(brandName);

  const vertical = detectExplicitVertical(text, opts?.vertical);

  const taglineMatch =
    text.match(/\*\*Une phrase\*\*\s*[—\-:]\s*(.+)/i) ||
    text.match(/^>\s*(.+)$/m);
  const tagline =
    taglineMatch?.[1]?.trim() ??
    (vertical === "chr"
      ? "Prix fournisseurs, catalogue et commandes pour la restauration"
      : `Application métier ${brandName}`);

  if (vertical === "chr") {
    return {
      brandId,
      brandName,
      domain: `${brandId}.local`,
      tagline,
      entities: corePurchaseEntities(),
      pages: corePurchasePages(),
      flows: [coreOrderFlow()],
      platformNeeds: defaultPlatformNeeds(),
      sourcePrdPath: opts?.sourcePath,
      vertical: "chr",
    };
  }

  const entities = extractEntitiesFromMarkdown(text);
  if (!entities.length) {
    throw new Error(
      "parseProductPrd: aucune entité extraite (section ## Entités / ### headings requise). Fallback notes interdit. Déclarer vertical: chr pour le cœur achats.",
    );
  }

  return {
    brandId,
    brandName,
    domain: `${brandId}.local`,
    tagline,
    entities,
    pages: pagesFromEntities(entities),
    flows: [],
    platformNeeds: defaultPlatformNeeds(),
    sourcePrdPath: opts?.sourcePath,
    vertical: "generic",
  };
}

/**
 * CONVENTION OS — la home d'une marque vit à /dashboard : le workspace kit
 * (@creezio/shell-ui) canonise tout href "/" → "/dashboard" (normalizeHref /
 * targetHref) et l'onglet de base est créé sur /dashboard. Toute app générée
 * DOIT donc exposer une page /dashboard, sinon l'onglet de base et la
 * redirection "/" tombent sur un 404 (vécu foove2 : modèle générique sans
 * dashboard → redirect("/notes") résiduel).
 */
export function ensureDashboardPage(model: ProductModel): ProductModel {
  const hasDash = model.pages.some(
    (p) => p.kind === "dashboard" || p.path === "/dashboard",
  );
  if (hasDash) return model;
  return {
    ...model,
    pages: [
      {
        id: "dashboard",
        path: "/dashboard",
        title: "Dashboard",
        kind: "dashboard",
      },
      ...model.pages,
    ],
  };
}

export function assertProductModel(model: ProductModel): void {
  if (!model.brandId || !/^[a-z][a-z0-9]{1,31}$/.test(model.brandId)) {
    throw new Error(`ProductModel.brandId invalide: ${model.brandId}`);
  }
  if (!model.brandName.trim()) throw new Error("ProductModel.brandName vide");
  if (!model.entities.length) throw new Error("ProductModel.entities vide");
  if (!model.pages.length) throw new Error("ProductModel.pages vide");
}
