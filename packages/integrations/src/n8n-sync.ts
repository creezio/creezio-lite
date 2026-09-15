/**
 * Push des intégrations vers le n8n embarqué (API publique, write-only).
 *
 * Faisabilité prouvée (ADR-integrations-store) : n8n ne réexpose JAMAIS la
 * valeur d'une credential via son API — il n'est donc qu'une DESTINATION
 * d'exécution (workflows), jamais la source de vérité. Le store natif pousse
 * ici une credential `creezio:<slug>` à chaque création/remplacement.
 *
 * Best-effort : n8n absent (client thin, warm off, boot en cours) ⇒ échec
 * non bloquant, re-sync possible via POST /:id/sync-n8n.
 */
import { getIntegrationProvider } from "./providers.js";

export type N8nBridge = {
  /** Ex. http://127.0.0.1:15678/api/v1 (env Hermes N8N_API_URL). */
  apiUrl: string;
  apiKey: string;
};

export type N8nIntegrationsSync = {
  available: () => boolean;
  /** Crée ou remplace la credential n8n. Retourne l'id n8n, null si KO. */
  push: (item: {
    slug: string;
    provider: string;
    secret: string;
    meta: Record<string, unknown>;
    n8nCredentialId: string | null;
  }) => Promise<{ ok: boolean; n8nCredentialId: string | null; detail: string }>;
  remove: (
    n8nCredentialId: string,
  ) => Promise<{ ok: boolean; detail: string }>;
};

export function n8nCredentialName(slug: string): string {
  return `creezio:${slug}`;
}

export function createN8nIntegrationsSync(opts: {
  getBridge: () => N8nBridge | null;
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
}): N8nIntegrationsSync {
  const doFetch = opts.fetchImpl || fetch;
  const log = opts.log || (() => {});

  const call = async (
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; json: Record<string, unknown> | null }> => {
    const bridge = opts.getBridge();
    if (!bridge) return { status: 0, json: null };
    const res = await doFetch(`${bridge.apiUrl.replace(/\/$/, "")}${path}`, {
      method,
      headers: {
        "X-N8N-API-KEY": bridge.apiKey,
        "content-type": "application/json",
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    return { status: res.status, json };
  };

  return {
    available: () => Boolean(opts.getBridge()),

    push: async (item) => {
      const provider = getIntegrationProvider(item.provider);
      if (!provider) {
        return {
          ok: false,
          n8nCredentialId: item.n8nCredentialId,
          detail: `provider inconnu: ${item.provider}`,
        };
      }
      const bridge = opts.getBridge();
      if (!bridge) {
        return {
          ok: false,
          n8nCredentialId: item.n8nCredentialId,
          detail: "n8n indisponible (pas de bridge API)",
        };
      }
      const data = provider.n8n.buildData(item.secret, item.meta);
      try {
        // Remplacement : PATCH write-only sur la credential existante.
        if (item.n8nCredentialId) {
          const patched = await call(
            "PATCH",
            `/credentials/${item.n8nCredentialId}`,
            { data },
          );
          if (patched.status === 200) {
            log(`n8n-sync: credential ${item.n8nCredentialId} mise à jour`);
            return {
              ok: true,
              n8nCredentialId: item.n8nCredentialId,
              detail: "updated",
            };
          }
          // Credential supprimée côté n8n → recréation propre plus bas.
          log(
            `n8n-sync: PATCH ${item.n8nCredentialId} → ${patched.status}, recréation`,
          );
        }
        const created = await call("POST", "/credentials", {
          name: n8nCredentialName(item.slug),
          type: provider.n8n.credentialType,
          data,
        });
        const id =
          created.status === 200 && created.json
            ? String(created.json.id || "")
            : "";
        if (!id) {
          return {
            ok: false,
            n8nCredentialId: item.n8nCredentialId,
            detail: `POST /credentials → ${created.status}`,
          };
        }
        log(`n8n-sync: credential créée ${id} (${n8nCredentialName(item.slug)})`);
        return { ok: true, n8nCredentialId: id, detail: "created" };
      } catch (e) {
        return {
          ok: false,
          n8nCredentialId: item.n8nCredentialId,
          detail: e instanceof Error ? e.message : String(e),
        };
      }
    },

    remove: async (n8nCredentialId) => {
      try {
        const r = await call("DELETE", `/credentials/${n8nCredentialId}`);
        if (r.status === 0) return { ok: false, detail: "n8n indisponible" };
        // 404 = déjà supprimée côté n8n : objectif atteint.
        const ok = r.status === 200 || r.status === 404;
        return { ok, detail: `DELETE → ${r.status}` };
      } catch (e) {
        return {
          ok: false,
          detail: e instanceof Error ? e.message : String(e),
        };
      }
    },
  };
}
