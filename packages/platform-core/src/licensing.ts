/**
 * Licence desktop hors-ligne (Ed25519) — gold kit paramétré.
 *
 * Format clé : `{keyPrefix}-<payload base64url>-<signature base64url>`
 * où payload = { email, plan, exp }. Vérification avec clé publique PEM
 * (env ou option) — aucune connexion serveur requise.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type LicenseStatus =
  | { state: "valid"; email: string; plan: string; expiresAt: string }
  | { state: "expired"; email: string; plan: string; expiresAt: string }
  | { state: "invalid"; reason: string }
  | { state: "unlicensed" };

export type LicensingOptions = {
  /** Racine userData (déjà résolue). */
  userDataRoot: string;
  /** Préfixe clé, ex. `kit`, `CV`, `FIDU`. */
  keyPrefix: string;
  /** PEM Ed25519 publique ; vide = mode permissif unlicensed. */
  publicKeyPem?: string;
  /** Nom fichier sous userData (défaut `license.key`). */
  licenseFileName?: string;
};

function licenseFile(opts: LicensingOptions): string {
  return path.join(
    opts.userDataRoot,
    opts.licenseFileName?.trim() || "license.key",
  );
}

export function storeLicenseKey(opts: LicensingOptions, key: string): void {
  fs.writeFileSync(licenseFile(opts), key.trim(), { mode: 0o600 });
}

export function checkLicense(opts: LicensingOptions): LicenseStatus {
  let key: string;
  try {
    key = fs.readFileSync(licenseFile(opts), "utf8").trim();
  } catch {
    return { state: "unlicensed" };
  }
  const pem = (opts.publicKeyPem || "").trim();
  if (!pem) {
    return { state: "unlicensed" };
  }

  const prefix = opts.keyPrefix.replace(/[^A-Za-z0-9]/g, "") || "APP";
  const re = new RegExp(
    `^${prefix}-([A-Za-z0-9_-]+)-([A-Za-z0-9_-]+)$`,
  );
  const m = key.match(re);
  if (!m || !m[1] || !m[2]) {
    return { state: "invalid", reason: "format de clé invalide" };
  }
  const payloadB64 = m[1];
  const sigB64 = m[2];

  try {
    const payloadBuf = Buffer.from(payloadB64, "base64url");
    const ok = crypto.verify(
      null,
      payloadBuf,
      crypto.createPublicKey(pem),
      Buffer.from(sigB64, "base64url"),
    );
    if (!ok) return { state: "invalid", reason: "signature invalide" };
    const payload = JSON.parse(payloadBuf.toString("utf8")) as {
      email: string;
      plan: string;
      exp: string;
    };
    if (new Date(payload.exp).getTime() < Date.now()) {
      return {
        state: "expired",
        email: payload.email,
        plan: payload.plan,
        expiresAt: payload.exp,
      };
    }
    return {
      state: "valid",
      email: payload.email,
      plan: payload.plan,
      expiresAt: payload.exp,
    };
  } catch (e) {
    return {
      state: "invalid",
      reason: e instanceof Error ? e.message : "clé illisible",
    };
  }
}
