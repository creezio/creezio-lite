/**
 * GUID NSIS déterministe — même algorithme qu'electron-builder
 * (`UUID.v5(appId, NAMESPACE_OID)`).
 *
 * NAMESPACE_OID = `6ba7b812-9dad-11d1-80b4-00c04fd430c8`
 * (vérifié contre les GUID kit de référence).
 */

import { createHash } from "node:crypto";

/** Namespace OID RFC 4122 (electron-builder / UUID.v5). */
export const ELECTRON_BUILDER_NS_OID =
  "6ba7b812-9dad-11d1-80b4-00c04fd430c8";

function uuidToBytes(u: string): Buffer {
  const hex = u.replace(/-/g, "");
  if (hex.length !== 32) {
    throw new Error(`UUID invalide: ${u}`);
  }
  return Buffer.from(hex, "hex");
}

function bytesToUuid(buf: Buffer): string {
  const h = buf.toString("hex");
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    h.slice(12, 16),
    h.slice(16, 20),
    h.slice(20, 32),
  ].join("-");
}

/**
 * UUID v5 (SHA-1) name-based, aligné sur `uuid` npm / electron-builder.
 */
export function uuidV5(name: string, namespace = ELECTRON_BUILDER_NS_OID): string {
  const ns = uuidToBytes(namespace);
  const hash = createHash("sha1")
    .update(ns)
    .update(name, "utf8")
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant RFC 4122
  return bytesToUuid(bytes);
}

/** GUID NSIS pour un `appId` electron-builder. */
export function nsisGuidFromAppId(appId: string): string {
  return uuidV5(appId, ELECTRON_BUILDER_NS_OID);
}
