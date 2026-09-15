/**
 * Définitions d'outils plateforme (SoT kit) — explore / SQL / Meili / surface / UI / supplier.
 * Métier (module.*) = discovery MCP. Tasks = PLATFORM_TASK_TOOL_DEFINITIONS + adapter tasks.
 * Phase O4r — remplace la duplication ×3 dans prompts.ts marques.
 */
import type { AssistantToolDefinition } from "../brand/types.js";

export const PLATFORM_TOOL_DEFINITIONS: AssistantToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "list_tables",
      description:
        "Liste les tables SQLite du CRM avec nombre de lignes et de colonnes.",
      parameters: {
        type: "object",
        properties: {
          q: {
            type: "string",
            description: "Filtre optionnel sur le nom de table (ex. produit, marketplace)",
          },
          limit: {
            type: "integer",
            description: "Nb max de tables retournées (défaut 80, max 200)",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "describe_table",
      description:
        "Décrit une table : colonnes + types + enums + linkColumns + childTables + FK.",
      parameters: {
        type: "object",
        properties: {
          table: {
            type: "string",
            description: "Nom exact de la table (ex. produits, fournisseurs, releves_prix, promotions)",
          },
          sample_distinct: {
            type: "boolean",
            description: "Échantillonner les enums et linkColumns (défaut true)",
          },
        },
        required: ["table"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_columns",
      description:
        "Cherche dans le schéma des tables/colonnes/valeurs contenant un mot-clé.",
      parameters: {
        type: "object",
        properties: {
          q: {
            type: "string",
            description: "Mot-clé (nom de colonne, fragment de table, ou valeur)",
          },
          scope: {
            type: "string",
            enum: ["columns", "values", "both"],
            description: "columns = noms ; values = DISTINCT contenant q ; both = défaut",
          },
          limit: {
            type: "integer",
            description: "Nb max de hits (défaut 40, max 80)",
          },
        },
        required: ["q"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_distinct_values",
      description:
        "Liste les valeurs DISTINCT exactes d'une colonne (avec counts). OBLIGATOIRE avant un filtre égalité texte douteux.",
      parameters: {
        type: "object",
        properties: {
          table: { type: "string", description: "Table SQLite" },
          column: {
            type: "string",
            description: "Colonne catégorielle à inspecter",
          },
          limit: {
            type: "integer",
            description: "Nb max de valeurs (défaut 30, max 100)",
          },
        },
        required: ["table", "column"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_knowledge",
      description:
        "Recherche keyword Meilisearch (indexes marque). PRIORITAIRE pour noms flous / typos / accents. Option ville pour filtrer. NE PAS utiliser pour un COUNT exact.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Mots-clés produit/fournisseur (ex. paella, nutella). La ville peut rester dans la query ou passer via ville.",
          },
          ville: {
            type: "string",
            description:
              "Filtre géo optionnel sur fournisseurs.ville (ex. Paris). Appliqué après Meili.",
          },
          limit: { type: "integer", description: "Nb docs par index (défaut 5)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_sql",
      description:
        "SQL SQLite lecture seule (SELECT/WITH). Lire metadata.totalMatching. Ne JAMAIS inventer de littéraux enum. LIMIT liste ≤100.",
      parameters: {
        type: "object",
        properties: {
          sql: {
            type: "string",
            description:
              "Requête SELECT/WITH. Ex count par fournisseur: SELECT COUNT(*) AS n FROM produits p JOIN fournisseurs f ON f.id=p.fournisseur_id WHERE f.nom LIKE '%Agidra%'",
          },
        },
        required: ["sql"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_entity",
      description:
        "Détail d'une entité CRM par id local / nom / id_produit (marketplace, produit, releve).",
      parameters: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            description: "Kind d'entité (config marque / getEntity)",
          },
          id: {
            type: "string",
            description: "id entier, nom/slug fournisseur, ref_fournisseur ou libellé produit…",
          },
        },
        required: ["kind", "id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "surface_list_targets",
      description:
        "Inventaire unifié des éléments VISIBLES sur la surface active (CRM React OU site externe Electron). Préférer cet outil à ui_list_targets / supplier_list_targets. Retourne url/path + titre + cibles. TOUJOURS avant surface_click / surface_type.",
      parameters: {
        type: "object",
        properties: {
          q: {
            type: "string",
            description:
              "Filtre optionnel sur le libellé (ex. 'email', 'like', 'panier')",
          },
          tabId: {
            type: "string",
            description:
              "Override onglet site externe (sinon tabId de la surface active)",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "surface_click",
      description:
        "Clic unifié sur la surface active (fake-cursor CRM ou onglet site externe). Cible = ref de surface_list_targets.",
      parameters: {
        type: "object",
        properties: {
          ref: { type: "string", description: "Ref de cible" },
          label: { type: "string", description: "Libellé si ref inconnue" },
          tabId: { type: "string", description: "Override onglet site externe" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "surface_type",
      description:
        "Saisie unifiée sur la surface active (champ CRM ou site externe). Autorisé sur email/password natifs si l'utilisateur le demande. PAS sur CAPTCHA Cloudflare.",
      parameters: {
        type: "object",
        properties: {
          ref: { type: "string", description: "Ref du champ" },
          label: { type: "string", description: "Placeholder / libellé" },
          text: { type: "string", description: "Texte à saisir" },
          submit: {
            type: "boolean",
            description: "Envoyer Entrée après la frappe (défaut false)",
          },
          tabId: { type: "string", description: "Override onglet site externe" },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "surface_scroll",
      description:
        "Défilement unifié sur la surface active (haut/bas) avant un nouveau surface_list_targets.",
      parameters: {
        type: "object",
        properties: {
          direction: { type: "string", enum: ["up", "down"] },
          tabId: { type: "string", description: "Override onglet site externe" },
        },
        required: ["direction"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "surface_read",
      description:
        "Lecture texte visible sur la surface active. Sur CRM : résumé page ; sur site externe : extraction texte.",
      parameters: {
        type: "object",
        properties: {
          q: {
            type: "string",
            description: "Filtre optionnel (blocs contenant ce texte)",
          },
          maxChars: {
            type: "integer",
            description: "Taille max (défaut 6000, supplier)",
          },
          tabId: { type: "string", description: "Override onglet site externe" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ui_list_targets",
      description:
        "CRM uniquement : inventaire DOM React. Sur surface supplier, utiliser surface_list_targets à la place (ui_* ne voit pas le site externe).",
      parameters: {
        type: "object",
        properties: {
          q: {
            type: "string",
            description:
              "Filtre optionnel sur le libellé des cibles (ex. 'like', 'fournisseur', 'Agidra')",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ui_click",
      description:
        "Clique un élément de la page via la souris virtuelle visible (le curseur se déplace puis clique réellement). Cible = ref retournée par ui_list_targets (prioritaire) ou libellé exact. Retourne la nouvelle page après le clic.",
      parameters: {
        type: "object",
        properties: {
          ref: {
            type: "string",
            description: "Ref de cible issue du dernier ui_list_targets (ex. t12)",
          },
          label: {
            type: "string",
            description: "Libellé visible de l'élément si ref inconnue (ex. 'Likés', 'Fournisseurs')",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ui_type",
      description:
        "Tape du texte dans un champ visible (recherche, filtre) via la souris virtuelle : clic dans le champ puis frappe simulée. Utiliser après ui_list_targets pour connaître la ref du champ.",
      parameters: {
        type: "object",
        properties: {
          ref: { type: "string", description: "Ref du champ (ui_list_targets)" },
          label: {
            type: "string",
            description: "Placeholder / libellé du champ si ref inconnue",
          },
          text: { type: "string", description: "Texte à saisir" },
          submit: {
            type: "boolean",
            description: "Envoyer Entrée après la frappe (défaut false — les recherches ont un debounce automatique)",
          },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ui_scroll",
      description:
        "Fait défiler la page de l'utilisateur vers le haut ou le bas (pour révéler des éléments hors écran avant ui_list_targets).",
      parameters: {
        type: "object",
        properties: {
          direction: { type: "string", enum: ["up", "down"] },
        },
        required: ["direction"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "external_list_tabs",
      description:
        "App desktop uniquement : liste les onglets sites externes ouverts (tabId, siteId, URL, titre). TOUJOURS appeler avant toute action external_* / supplier_* pour connaître les tabId valides.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "external_open_tab",
      description:
        "App desktop uniquement : ouvre (ou réutilise) un onglet site externe sur une URL. La session est persistante par siteId. Retourne le tabId pour les actions suivantes.",
      parameters: {
        type: "object",
        properties: {
          site_id: {
            type: "integer",
            description: "Id de partition du site (isole la session). 0 = générique.",
          },
          url: { type: "string", description: "URL à ouvrir (https://…)" },
        },
        required: ["site_id", "url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "external_list_targets",
      description:
        "App desktop uniquement : inventaire des éléments cliquables/saisissables VISIBLES dans un onglet site externe. TOUJOURS avant external_click / external_type.",
      parameters: {
        type: "object",
        properties: {
          tabId: { type: "string", description: "Onglet cible (external_list_tabs)" },
          q: { type: "string", description: "Filtre optionnel sur le libellé" },
        },
        required: ["tabId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "external_click",
      description:
        "App desktop uniquement : clic trusted dans un onglet site externe (ref de external_list_targets).",
      parameters: {
        type: "object",
        properties: {
          tabId: { type: "string" },
          ref: { type: "string" },
          label: { type: "string" },
        },
        required: ["tabId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "external_type",
      description:
        "App desktop uniquement : saisie trusted dans un champ d'un onglet site externe.",
      parameters: {
        type: "object",
        properties: {
          tabId: { type: "string" },
          ref: { type: "string" },
          label: { type: "string" },
          text: { type: "string" },
          submit: { type: "boolean" },
        },
        required: ["tabId", "text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "external_scroll",
      description:
        "App desktop uniquement : défile un onglet site externe (up/down).",
      parameters: {
        type: "object",
        properties: {
          tabId: { type: "string" },
          direction: { type: "string", enum: ["up", "down"] },
        },
        required: ["tabId", "direction"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "external_read",
      description:
        "App desktop uniquement : lit le texte visible d'un onglet site externe.",
      parameters: {
        type: "object",
        properties: {
          tabId: { type: "string" },
          q: { type: "string" },
          maxChars: { type: "integer" },
        },
        required: ["tabId"],
      },
    },
  },
  /* ── Alias dépréciés TF (supplier_* → external_*) — ne pas utiliser pour nouveau code ── */
  {
    type: "function",
    function: {
      name: "supplier_list_tabs",
      description:
        "DÉPRÉCIÉ → external_list_tabs. Liste les onglets sites externes ouverts.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "supplier_open_tab",
      description:
        "DÉPRÉCIÉ → external_open_tab. Ouvre un onglet site externe. Param fournisseur_id = site_id.",
      parameters: {
        type: "object",
        properties: {
          fournisseur_id: {
            type: "integer",
            description: "Alias déprécié de site_id",
          },
          site_id: { type: "integer", description: "Id de partition site" },
          url: { type: "string" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "supplier_list_targets",
      description: "DÉPRÉCIÉ → external_list_targets.",
      parameters: {
        type: "object",
        properties: {
          tabId: { type: "string" },
          q: { type: "string" },
        },
        required: ["tabId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "supplier_click",
      description: "DÉPRÉCIÉ → external_click.",
      parameters: {
        type: "object",
        properties: {
          tabId: { type: "string" },
          ref: { type: "string" },
          label: { type: "string" },
        },
        required: ["tabId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "supplier_type",
      description: "DÉPRÉCIÉ → external_type.",
      parameters: {
        type: "object",
        properties: {
          tabId: { type: "string" },
          ref: { type: "string" },
          label: { type: "string" },
          text: { type: "string" },
          submit: { type: "boolean" },
        },
        required: ["tabId", "text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "supplier_scroll",
      description: "DÉPRÉCIÉ → external_scroll.",
      parameters: {
        type: "object",
        properties: {
          tabId: { type: "string" },
          direction: { type: "string", enum: ["up", "down"] },
        },
        required: ["tabId", "direction"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "supplier_read",
      description: "DÉPRÉCIÉ → external_read.",
      parameters: {
        type: "object",
        properties: {
          tabId: { type: "string" },
          q: { type: "string" },
          maxChars: { type: "integer" },
        },
        required: ["tabId"],
      },
    },
  }
];

/** create_task / list_tasks — handlers kit via configureAssistantBrand({ tasks }). */
export const PLATFORM_TASK_TOOL_DEFINITIONS: AssistantToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "create_task",
      description:
        "Crée une tâche dans le kanban unifié /taches (ou /todos selon marque). OBLIGATOIRE dès qu'il y a une mission à faire.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Titre court de la mission" },
          body: { type: "string", description: "Consignes détaillées" },
          executor: {
            type: "string",
            enum: ["hermes", "ai", "human"],
            description: "Exécutant (défaut hermes)",
          },
          assignee_user_id: { type: "string" },
          recurring_schedule: { type: "string" },
          priority: { type: "integer" },
          dispatch: { type: "boolean" },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_tasks",
      description:
        "Liste les tâches du kanban unifié (sync Hermes si disponible).",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string" },
          executor: {
            type: "string",
            enum: ["hermes", "ai", "human"],
          },
          sync: { type: "boolean" },
        },
        required: [],
      },
    },
  },
];

export const PLATFORM_TASK_TOOL_ALIASES = {
  create_todo: "create_task",
  list_todos: "list_tasks",
} as const;
