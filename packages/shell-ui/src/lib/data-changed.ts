/**
 * Bus client de réactivité data (mutations → UI).
 *
 * Contrat :
 * - Émetteurs : `emitDataChanged({ resource, ids?, source })` après une
 *   mutation confirmée (UI, fetch qui lit le header API, tool MCP/assistant).
 * - Consommateurs : `subscribeDataChanged` / hook UI `useCreezioResource`
 *   (rafraîchit la page ouverte sans reload manuel).
 *
 * Header HTTP homonyme (EntitySpec / mounts) : `x-creezio-data-changed`
 * (valeur = resource, CSV si plusieurs). Le fetch interceptor kit le
 * transforme en événement navigateur.
 *
 * Tools MCP / assistant : `inferResourceFromToolName(toolName)` → resource
 * (ou null si lecture). Convention `module.<owner>.<action>` + table d'alias
 * + préfixes d'écriture legacy (`add_to_*`, `create_*`, …).
 */

export const CREEZIO_DATA_CHANGED_EVENT = "creezio:data-changed";
export const CREEZIO_DATA_CHANGED_HEADER = "x-creezio-data-changed";

export type CreezioDataChangedDetail = {
  /** Identifiant de ressource (ex. `panier`, `commandes`, table EntitySpec). */
  resource: string;
  ids?: string[];
  /** Provenance : `ui` | `api` | `mcp` | `assistant` | libre. */
  source?: string;
  at?: number;
};

export function emitDataChanged(detail: CreezioDataChangedDetail): void {
  if (typeof window === "undefined") return;
  const resource = String(detail.resource || "").trim();
  if (!resource) return;
  window.dispatchEvent(
    new CustomEvent(CREEZIO_DATA_CHANGED_EVENT, {
      detail: {
        resource,
        ids: detail.ids,
        source: detail.source,
        at: detail.at ?? Date.now(),
      } satisfies CreezioDataChangedDetail,
    }),
  );
}

export function subscribeDataChanged(
  handler: (detail: CreezioDataChangedDetail) => void,
  opts?: { resource?: string | string[] },
): () => void {
  if (typeof window === "undefined") return () => {};
  const wanted = opts?.resource
    ? new Set(
        (Array.isArray(opts.resource) ? opts.resource : [opts.resource]).map(
          (r) => r.trim(),
        ),
      )
    : null;

  const onEvent = (e: Event) => {
    const detail = (e as CustomEvent<CreezioDataChangedDetail>).detail;
    if (!detail?.resource) return;
    if (wanted && !wanted.has(detail.resource)) return;
    handler(detail);
  };
  window.addEventListener(CREEZIO_DATA_CHANGED_EVENT, onEvent);
  return () => window.removeEventListener(CREEZIO_DATA_CHANGED_EVENT, onEvent);
}

/** Parse le header `x-creezio-data-changed` (CSV) → resources. */
export function parseDataChangedHeader(
  value: string | null | undefined,
): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Alias owner / stem outil → resource UI (`useCreezioResource`).
 * Les clés sont en minuscules ; valeurs = id resource bus.
 */
const TOOL_OWNER_TO_RESOURCE: Record<string, string> = {
  panier: "panier",
  cart: "panier",
  commande: "commandes",
  commandes: "commandes",
  sku: "skus",
  skus: "skus",
  produit: "produits",
  product: "produits",
  products: "produits",
  produits: "produits",
  catalog: "produits",
  catalogue: "produits",
  fournisseur: "fournisseurs",
  fournisseurs: "fournisseurs",
  supplier: "fournisseurs",
  vendor: "fournisseurs",
  client: "clients",
  customers: "clients",
  customer: "clients",
  clients: "clients",
  task: "tasks",
  tasks: "tasks",
  tache: "tasks",
  taches: "tasks",
  todo: "tasks",
  todos: "tasks",
  ai_task: "tasks",
  ai_collaborator: "tasks",
  mail: "mails",
  mails: "mails",
  email: "mails",
  emails: "mails",
  promo: "promotions",
  promotion: "promotions",
  promotions: "promotions",
  stack: "stack",
  prix: "prix",
  releve: "prix",
  releves: "prix",
  releves_prix: "prix",
  optimiser: "optimiser",
  conditions: "conditions",
  data_mapping: "data_mapping",
  widget: "widgets",
  widgets: "widgets",
};

/** Verbes / préfixes d'action clairement lecture seule. */
const READ_ACTION_RE =
  /^(get|list|search|find|read|count|describe|schema|status|suggest|scenario|graph|stats|rfa)(_|$)/;

/** Préfixes d'écriture legacy (`add_to_panier`, `create_ai_task`, …). */
const WRITE_PREFIX_RE =
  /^(?:add_to_|add_|create_|update_|delete_|close_|set_|remove_|archive_|upsert_|patch_|answer_)/;

function normalizeOwnerStem(raw: string): string {
  return raw
    .replace(/_ligne$/, "")
    .replace(/_item$/, "")
    .replace(/_line$/, "")
    .replace(/_entry$/, "");
}

function resourceFromOwner(owner: string): string | null {
  const key = normalizeOwnerStem(owner.trim().toLowerCase());
  if (!key) return null;
  return TOOL_OWNER_TO_RESOURCE[key] ?? key;
}

/**
 * Heuristique tool MCP / assistant → resource (écriture).
 * Retourne null si tool probablement lecture seule.
 *
 * Conventions supportées :
 * 1. `module.<owner>.<action>` — action lecture → null ; sinon resource(owner)
 * 2. Contient panier/cart / promotions… (mots-clés métier)
 * 3. Préfixes d'écriture legacy → stem → resource
 */
export function inferResourceFromToolName(toolName: string): string | null {
  const n = String(toolName || "").trim().toLowerCase();
  if (!n) return null;

  // 1) Convention module.<owner>.<action>[_…]
  const mod = /^module\.([a-z0-9_-]+)\.([a-z0-9_.-]+)$/.exec(n);
  if (mod) {
    const owner = mod[1]!;
    const action = mod[2]!;
    if (READ_ACTION_RE.test(action)) return null;
    return resourceFromOwner(owner);
  }

  // Lecture seule legacy (préfixe ou suffixe)
  if (
    /^(get_|list_|search_|find_|read_|count_|describe_|schema_)/.test(n) ||
    n.endsWith("_get") ||
    n.endsWith("_list") ||
    n.endsWith("_search")
  ) {
    return null;
  }

  // 2) Mots-clés métier (outil plat ou composé)
  if (/panier|cart/.test(n)) return "panier";
  if (/promotions?|promo\b/.test(n)) return "promotions";
  if (/\bstack\b|add_to_stack|remove_from_stack/.test(n)) return "stack";
  if (/commande/.test(n)) return "commandes";
  if (/\bskus?\b/.test(n)) return "skus";
  if (/produit|product|catalog/.test(n)) return "produits";
  if (/fournisseur|supplier|vendor/.test(n)) return "fournisseurs";
  if (/client|customer/.test(n)) return "clients";
  if (/task|tache|todo|ai_task|ai_collaborator|ai_question/.test(n)) {
    return "tasks";
  }
  if (/mail|email/.test(n)) return "mails";
  if (/optimiser/.test(n)) return "optimiser";
  if (/conditions?|rfa/.test(n)) return "conditions";
  if (/releve|prix/.test(n)) return "prix";

  // 3) Préfixes d'écriture → stem
  if (WRITE_PREFIX_RE.test(n)) {
    const stem = n
      .replace(WRITE_PREFIX_RE, "")
      .replace(/_ligne$/, "")
      .replace(/_item$/, "");
    if (!stem) return null;
    // create_ai_task → ai_task ; add_to_panier déjà couvert plus haut
    return resourceFromOwner(stem);
  }

  return null;
}

let fetchPatched = false;

/**
 * Intercepte `window.fetch` une fois : si la réponse porte
 * `x-creezio-data-changed`, émet le bus client (source `api`).
 */
export function installCreezioDataChangedFetch(): void {
  if (typeof window === "undefined" || fetchPatched) return;
  const original = window.fetch.bind(window);
  fetchPatched = true;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await original(input, init);
    try {
      const header = res.headers.get(CREEZIO_DATA_CHANGED_HEADER);
      for (const resource of parseDataChangedHeader(header)) {
        emitDataChanged({ resource, source: "api" });
      }
    } catch {
      /* ignore */
    }
    return res;
  };
}

/** Tests uniquement. */
export function resetDataChangedFetchForTests(): void {
  fetchPatched = false;
}
