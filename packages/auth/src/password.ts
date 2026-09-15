import crypto from "node:crypto";

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .scryptSync(password, salt, 32, SCRYPT_PARAMS)
    .toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = parts[1]!;
  const expected = parts[2]!;
  const hash = crypto
    .scryptSync(password, salt, 32, SCRYPT_PARAMS)
    .toString("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function newToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}
