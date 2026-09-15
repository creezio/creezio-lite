/**
 * @creezio/granola — module natif Granola (meeting notes).
 *
 * Le kit fournit le moteur générique : récepteur webhook signé
 * (Standard Webhooks), sync des notes en brand.db, client + proxys de
 * l'API publique Granola. La marque compose `granolaMigrations()` dans ses
 * migrations brand et enregistre `createGranolaMount({ defaults })` sous
 * l'id `granola` — l'URL à coller dans Granola est alors
 * `https://<origine-publique>/api/v1/modules/granola/webhook`.
 */

export {
  GRANOLA_CONFIG_KEYS,
  GRANOLA_DEFAULT_API_BASE_URL,
  GRANOLA_NOTES_TRANSCRIPT_SQL,
  GRANOLA_SCHEMA_SQL,
  granolaMigrations,
  maskSecret,
  mergeGranolaConfig,
  type GranolaModuleConfig,
} from "./config.js";

export {
  GRANOLA_WEBHOOK_TOLERANCE_S,
  signGranolaPayload,
  verifyGranolaSignature,
  type GranolaSignatureCheck,
  type GranolaWebhookHeaders,
} from "./signature.js";

export {
  createGranolaClient,
  type GranolaApiResult,
  type GranolaClient,
  type GranolaClientOptions,
  type GranolaFetch,
  type GranolaQuery,
} from "./client.js";

export { createGranolaMount, type GranolaMountOptions } from "./mount.js";
