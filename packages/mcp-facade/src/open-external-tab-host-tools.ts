/**
 * D-P18 — tool MCP host-only `open_external_tab` (desktop).
 * SoT kit partagée marques. Métier résolution URL reste injecté.
 */
import { z } from "zod";

export const CREEZIO_OPEN_EXTERNAL_TAB_MCP_TOOL_NAME =
  "open_external_tab" as const;

export type OpenExternalTabResolved = {
  url: string;
  fournisseurId: number;
  title: string;
  source: string;
};

export type OpenExternalTabResolveResult =
  | ({ ok: true } & OpenExternalTabResolved)
  | ({ ok: false; error: string } & Record<string, unknown>);

export type OpenExternalTabHostMcpToolConfig = {
  title: string;
  description: string;
  inputSchema: Record<string, z.ZodType>;
};

export type OpenExternalTabHostMcpRegisterFn = (
  name: string,
  config: OpenExternalTabHostMcpToolConfig,
  handler: (input: any) => Promise<unknown> | unknown,
) => void;

export type OpenExternalTabUser = {
  id: string;
  role?: string;
};

export type CreateOpenExternalTabHostMcpToolsOptions = {
  /** Enregistrement marque (`registerMcpTool` ou `server.registerTool`). */
  registerTool: OpenExternalTabHostMcpRegisterFn;
  /** `userId` du token MCP (Bearer / API key). */
  getActorUserId: () => string | null | undefined;
  /** Métier marque — résolution URL / catalogue. */
  resolveOpenTabRequest: (input: {
    url?: string;
    outil_slug?: string;
    fournisseur_id?: number;
    title?: string;
  }) => OpenExternalTabResolveResult;
  /** Params IPC desktop (alias marque de `toSupplierOpenTabParams`). */
  toOpenTabParams: (
    resolved: OpenExternalTabResolved,
  ) => Record<string, unknown>;
  /**
   * Dispatch action desktop (typiquement `dispatchSupplierAction`
   * avec `"supplier_open_tab"`).
   */
  dispatchOpenTabAction: (
    params: Record<string, unknown>,
    opts: { targetUserId: string; requireTargetOnline: boolean },
  ) => Promise<Record<string, unknown>>;
  getUserById: (id: string) => OpenExternalTabUser | null | undefined;
  getOwner: () => { id: string } | null | undefined;
  /** Titre tool MCP (défaut neutre). */
  title?: string;
  /** Description tool MCP (défaut neutre). */
  description?: string;
  /** feature-off : expose `outil_slug` dans le schéma. Défaut false. */
  includeOutilSlug?: boolean;
};

function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 1) }],
  };
}

function errorResult(message: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ error: message }),
      },
    ],
    isError: true,
  };
}

/**
 * Enregistre le tool MCP host `open_external_tab` (SoT kit).
 * Retourne la liste des noms enregistrés (`["open_external_tab"]`).
 */
export function createOpenExternalTabHostMcpTools(
  options: CreateOpenExternalTabHostMcpToolsOptions,
): readonly string[] {
  const {
    registerTool,
    getActorUserId,
    resolveOpenTabRequest,
    toOpenTabParams,
    dispatchOpenTabAction,
    getUserById,
    getOwner,
    title = "Ouvrir un onglet externe",
    description =
      "Ouvre un onglet externe dans le desktop de l'utilisateur lié au token OAuth.",
    includeOutilSlug = false,
  } = options;

  const inputSchema: Record<string, z.ZodType> = {
    url: z.string().optional().describe("URL ou domaine"),
    fournisseur_id: z
      .number()
      .int()
      .optional()
      .describe("ID catalogue (0 ou omis = URL libre)"),
    title: z.string().optional().describe("Titre d'onglet"),
    target_user_id: z
      .string()
      .optional()
      .describe("Compte principal uniquement : autre utilisateur cible"),
  };
  if (includeOutilSlug) {
    inputSchema.outil_slug = z
      .string()
      .optional()
      .describe("Slug catalogue");
  }

  registerTool(
    CREEZIO_OPEN_EXTERNAL_TAB_MCP_TOOL_NAME,
    { title, description, inputSchema },
    async (input) => {
      try {
        const actorId = getActorUserId();
        if (!actorId) {
          return errorResult(
            "token MCP sans user_id — reconnectez le client MCP",
          );
        }
        let targetUserId = actorId;
        if (input.target_user_id && input.target_user_id !== actorId) {
          const actor = getUserById(actorId);
          const owner = getOwner();
          if (!actor || actor.role !== "owner" || actor.id !== owner?.id) {
            return errorResult(
              "Seul le compte principal peut cibler un autre utilisateur",
            );
          }
          if (!getUserById(input.target_user_id)) {
            return errorResult("Utilisateur cible introuvable");
          }
          targetUserId = input.target_user_id;
        }
        const resolved = resolveOpenTabRequest({
          url: input.url,
          outil_slug: input.outil_slug,
          fournisseur_id: input.fournisseur_id,
          title: input.title,
        });
        if (!resolved.ok) return jsonResult(resolved);
        const result = await dispatchOpenTabAction(
          toOpenTabParams(resolved),
          { targetUserId, requireTargetOnline: true },
        );
        return jsonResult({
          ...result,
          resolved: {
            url: resolved.url,
            fournisseur_id: resolved.fournisseurId,
            title: resolved.title,
            source: resolved.source,
          },
          target_user_id: targetUserId,
        });
      } catch (error) {
        return errorResult(
          error instanceof Error ? error.message : String(error),
        );
      }
    },
  );

  return [CREEZIO_OPEN_EXTERNAL_TAB_MCP_TOOL_NAME];
}
