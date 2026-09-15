/**
 * Clé de récupération locale — port kit recovery-key.ts (pur crypto).
 */

import crypto from "node:crypto";

export type RecoveryVerifier = {
  algo: "scrypt";
  N: number;
  r: number;
  p: number;
  salt: string;
  hash: string;
};

export type RecoveryEnvelope = {
  algo: "aes-256-gcm";
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
};

export type RecoveryWrappedSecrets = {
  authUser: string;
  authPassword: string;
  authSecret: string;
};

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 32;

export function generateRecoveryKey(): string {
  const raw = crypto.randomBytes(16);
  const hex = raw.toString("hex").toUpperCase();
  const groups: string[] = [];
  for (let i = 0; i < hex.length; i += 4) {
    groups.push(hex.slice(i, i + 4));
  }
  return groups.join("-");
}

export function normalizeRecoveryKey(input: string): string {
  return String(input || "")
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-F]/g, "");
}

function scryptKey(secret: string, salt: Buffer): Buffer {
  return crypto.scryptSync(secret, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
}

export function createRecoveryVerifier(recoveryKey: string): RecoveryVerifier {
  const normalized = normalizeRecoveryKey(recoveryKey);
  if (normalized.length < 32) {
    throw new Error("Clé de récupération invalide");
  }
  const salt = crypto.randomBytes(16);
  const hash = scryptKey(normalized, salt);
  return {
    algo: "scrypt",
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    salt: salt.toString("base64"),
    hash: hash.toString("base64"),
  };
}

export function verifyRecoveryKey(
  recoveryKey: string,
  verifier: RecoveryVerifier | undefined | null,
): boolean {
  if (
    !verifier ||
    verifier.algo !== "scrypt" ||
    !verifier.salt ||
    !verifier.hash
  ) {
    return false;
  }
  const normalized = normalizeRecoveryKey(recoveryKey);
  if (normalized.length < 32) return false;
  try {
    const salt = Buffer.from(verifier.salt, "base64");
    const expected = Buffer.from(verifier.hash, "base64");
    const actual = crypto.scryptSync(normalized, salt, expected.length, {
      N: verifier.N || SCRYPT_N,
      r: verifier.r || SCRYPT_R,
      p: verifier.p || SCRYPT_P,
    });
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function wrapSecretsWithRecoveryKey(
  recoveryKey: string,
  secrets: RecoveryWrappedSecrets,
): RecoveryEnvelope {
  const normalized = normalizeRecoveryKey(recoveryKey);
  if (normalized.length < 32) throw new Error("Clé de récupération invalide");
  const salt = crypto.randomBytes(16);
  const key = scryptKey(normalized, salt);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(secrets), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    algo: "aes-256-gcm",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function unwrapSecretsWithRecoveryKey(
  recoveryKey: string,
  envelope: RecoveryEnvelope | undefined | null,
): RecoveryWrappedSecrets {
  if (!envelope || envelope.algo !== "aes-256-gcm") {
    throw new Error("Enveloppe de récupération absente");
  }
  const normalized = normalizeRecoveryKey(recoveryKey);
  if (normalized.length < 32) throw new Error("Clé de récupération invalide");
  const salt = Buffer.from(envelope.salt, "base64");
  const key = scryptKey(normalized, salt);
  const iv = Buffer.from(envelope.iv, "base64");
  const tag = Buffer.from(envelope.tag, "base64");
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  const parsed = JSON.parse(
    plaintext.toString("utf8"),
  ) as RecoveryWrappedSecrets;
  if (!parsed?.authUser || !parsed?.authPassword || !parsed?.authSecret) {
    throw new Error("Enveloppe de récupération corrompue");
  }
  return parsed;
}
