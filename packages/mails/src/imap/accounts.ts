/**
 * Comptes IMAP — shape API publique (le secret n'est JAMAIS renvoyé :
 * seule la référence `integration://…` transite) + parsing des inputs
 * CRUD (`/api/v1/email/accounts`).
 */

import type { MailAccount } from "../types.js";
import { getMailSecretBridge } from "../transport-resolve.js";
import type { MailAccountInput, MailAccountPatch } from "../sqlite-store.js";

export type MailAccountPublic = {
  id: string;
  label: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  /** Référence secret (jamais la valeur). */
  secretRef: string;
  foldersJson: string | null;
  lastUidvalidity: string | null;
  lastUid: number;
  syncState: string;
  lastSyncAt: string | null;
  lastError: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export function toPublicAccount(account: MailAccount): MailAccountPublic {
  return {
    id: account.id,
    label: account.label,
    host: account.host,
    port: account.port,
    secure: account.secure,
    username: account.username,
    secretRef: account.secretRef,
    foldersJson: account.foldersJson,
    lastUidvalidity: account.lastUidvalidity,
    lastUid: account.lastUid,
    syncState: account.syncState,
    lastSyncAt: account.lastSyncAt,
    lastError: account.lastError,
    enabled: account.enabled,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

/**
 * Résout la référence secret d'un input compte : `secretRef` direct
 * (`integration://…`) ou `secret` en clair stocké via le pont secrets
 * (app-runtime → @creezio/integrations, provider `imap`).
 */
function resolveSecretRefInput(
  b: Record<string, unknown>,
  label: string,
): { ok: true; secretRef: string | null } | { ok: false; error: string } {
  const secretRef = String(b.secretRef || "").trim();
  if (secretRef) {
    if (!secretRef.startsWith("integration://")) {
      return { ok: false, error: "secretRef doit être une référence integration://" };
    }
    return { ok: true, secretRef };
  }
  const secret = String(b.secret || "").trim();
  if (!secret) return { ok: true, secretRef: null };
  const bridge = getMailSecretBridge();
  if (!bridge?.store) {
    return {
      ok: false,
      error:
        "secret en clair refusé : store d'intégrations indisponible — fournir secretRef",
    };
  }
  try {
    const ref = bridge.store({
      provider: "imap",
      label: `IMAP ${label}`.trim(),
      secret,
    });
    return { ok: true, secretRef: ref };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "stockage du secret impossible",
    };
  }
}

export function parseAccountCreateInput(
  body: unknown,
): { ok: true; input: MailAccountInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Requête invalide" };
  }
  const b = body as Record<string, unknown>;
  const label = String(b.label || "").trim();
  const host = String(b.host || "").trim();
  const username = String(b.username || "").trim();
  if (!label || !host || !username) {
    return { ok: false, error: "label, host et username requis" };
  }
  const secretResult = resolveSecretRefInput(b, label);
  if (!secretResult.ok) return secretResult;
  if (!secretResult.secretRef) {
    return { ok: false, error: "secretRef (integration://…) ou secret requis" };
  }
  const port = b.port != null ? Number(b.port) : 993;
  return {
    ok: true,
    input: {
      label,
      host,
      port: Number.isFinite(port) ? port : 993,
      secure: b.secure !== false && b.secure !== 0 && b.secure !== "0",
      username,
      secretRef: secretResult.secretRef,
      foldersJson:
        b.foldersJson != null ? String(b.foldersJson) : null,
      enabled: b.enabled !== false,
    },
  };
}

export function parseAccountPatchInput(
  body: unknown,
): { ok: true; patch: MailAccountPatch } | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Requête invalide" };
  }
  const b = body as Record<string, unknown>;
  const patch: MailAccountPatch = {};
  if (b.label != null) patch.label = String(b.label);
  if (b.host != null) patch.host = String(b.host);
  if (b.port != null) {
    const port = Number(b.port);
    if (!Number.isFinite(port)) return { ok: false, error: "port invalide" };
    patch.port = port;
  }
  if (b.secure != null) {
    patch.secure = b.secure !== false && b.secure !== 0 && b.secure !== "0";
  }
  if (b.username != null) patch.username = String(b.username);
  if (b.foldersJson !== undefined) {
    patch.foldersJson = b.foldersJson == null ? null : String(b.foldersJson);
  }
  if (b.enabled != null) patch.enabled = Boolean(b.enabled);
  if (b.secretRef != null || b.secret != null) {
    const secretResult = resolveSecretRefInput(
      b,
      String(b.label || b.username || ""),
    );
    if (!secretResult.ok) return secretResult;
    if (secretResult.secretRef) patch.secretRef = secretResult.secretRef;
  }
  return { ok: true, patch };
}
