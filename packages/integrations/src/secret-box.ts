/**
 * Chiffrement au repos des secrets d'intégration — AES-256-GCM, clé dérivée
 * de l'AUTH_SECRET de l'instance (même mécanisme que les clés BYOK du chat
 * assistant). Si AUTH_SECRET change, le déchiffrement échoue proprement →
 * l'intégration est signalée `unreadable` et l'utilisateur ressaisit la clé.
 */
import crypto from "node:crypto";

const SECRET_PREFIX = "enc:v1:";

function boxKey(): Buffer {
  const secret = process.env.AUTH_SECRET || "dev-insecure-secret-change-me";
  return crypto
    .createHash("sha256")
    .update(`creezio-integrations:${secret}`)
    .digest();
}

export function sealIntegrationSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", boxKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${SECRET_PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function openIntegrationSecret(stored: string): string | null {
  if (!stored.startsWith(SECRET_PREFIX)) return null;
  try {
    const [ivB64, tagB64, dataB64] = stored
      .slice(SECRET_PREFIX.length)
      .split(":");
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      boxKey(),
      Buffer.from(ivB64!, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tagB64!, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64!, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

/** Indice non sensible affichable (ex. `sk-p…cwA`). */
export function integrationSecretHint(plain: string): string {
  const v = plain.trim();
  if (v.length <= 8) return `${v.slice(0, 1)}…`;
  return `${v.slice(0, 4)}…${v.slice(-3)}`;
}
