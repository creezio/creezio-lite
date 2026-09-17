// Port ClaimStore D1/SQLite pour l’admission signed (contrat C01).
// CAS fence+génération+état+expiration. Pas de jeton guest, pas d’exactly-once métier.
import type { LiteEnvironment } from './types.ts';
import {
  isPublicTenantId,
  publicIngressLimits,
  type ClaimFence,
  type ClaimKey,
  type ClaimOutcome,
  type ClaimStore,
  type SanitizedSnapshot,
} from './public-ingress-engine.ts';

export type PublicIngressClaimStoreConfig = {
  leaseTtlMs?: number;
  maxAttempts?: number;
  snapshotMaxBytes?: number;
  nowMs?: () => number;
};

export const publicIngressClaimStoreDefaults = Object.freeze({
  leaseTtlMs: 30_000,
  maxAttempts: 8,
  snapshotMaxBytes: 8_192,
});

const SENSITIVE_KEY = /password|passwd|secret|token|authorization|cookie|api_?key|jwt|bearer|credential|hash|session|rawbytes|set-cookie/i;
const SUCCESS_STATUSES = new Set([200, 201, 202]);
const SNAPSHOT_FAIL_STATUSES = new Set([400, 403, 404, 409, 410, 413, 415, 422, 429, 503]);
const ENTRY_ID = /^[a-z][a-z0-9_.-]{0,119}$/;
const TABLE = 'lite_public_ingress_claims';

type ClaimRow = {
  tenant_id: string;
  entry_id: string;
  event_id: string;
  digest_hex: string;
  state: string;
  generation: number;
  token: string;
  attempts: number;
  lease_until: string;
  snapshot_json: string | null;
};

type D1Like = LiteEnvironment['DB'];

function requirePositiveInt(name: string, value: number | undefined, fallback: number): number {
  const n = value === undefined ? fallback : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) throw new Error(`${name} invalide.`);
  return n;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function nowOf(clock: () => number): number {
  const ms = clock();
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) throw new Error('Horloge de claim invalide.');
  return Math.floor(ms);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function sensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key) || key === 'db' || key === 'env' || key === 'LITE_INTEGRATION_SECRET' || key === 'secret';
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > 8) return undefined;
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map(item => sanitizeValue(item, depth + 1));
  const row = asRecord(value);
  if (!row) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(row)) {
    if (sensitiveKey(key)) return undefined;
    out[key] = sanitizeValue(item, depth + 1);
  }
  return out;
}

export function sanitizeClaimSnapshot(snapshot: SanitizedSnapshot): SanitizedSnapshot | undefined {
  if (!snapshot || (snapshot.ok !== true && snapshot.ok !== false)) return undefined;
  if (snapshot.ok && !SUCCESS_STATUSES.has(snapshot.status)) return undefined;
  if (!snapshot.ok && !SNAPSHOT_FAIL_STATUSES.has(snapshot.status)) return undefined;
  const body = sanitizeValue(snapshot.body, 0);
  if (body === undefined && snapshot.body !== undefined && snapshot.body !== null) return undefined;
  return snapshot.ok ? { ok: true, status: snapshot.status, body } : { ok: false, status: snapshot.status, body };
}

function snapshotJson(snapshot: SanitizedSnapshot | undefined, maxBytes: number): string | undefined {
  if (!snapshot) return undefined;
  const clean = sanitizeClaimSnapshot(snapshot);
  if (!clean) return undefined;
  const json = JSON.stringify(clean);
  if (typeof json !== 'string' || json.length > maxBytes) return undefined;
  return json;
}

function snapshotFromJson(raw: string | null | undefined): SanitizedSnapshot | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { return undefined; }
  const row = asRecord(parsed);
  if (!row || (row.ok !== true && row.ok !== false) || typeof row.status !== 'number') return undefined;
  return sanitizeClaimSnapshot(row as unknown as SanitizedSnapshot);
}

function digestHex(digest: Uint8Array): string {
  if (!(digest instanceof Uint8Array) || digest.byteLength < 1 || digest.byteLength > 64) {
    throw new Error('Digest de claim invalide.');
  }
  let hex = '';
  for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

function assertKey(key: ClaimKey): ClaimKey {
  if (!key || typeof key.tenantId !== 'string' || !isPublicTenantId(key.tenantId)) throw new Error('ClaimKey.tenantId invalide.');
  if (typeof key.entryId !== 'string' || !ENTRY_ID.test(key.entryId)) throw new Error('ClaimKey.entryId invalide.');
  if (typeof key.eventId !== 'string' || !key.eventId || key.eventId.length > publicIngressLimits.eventIdMaxLength) {
    throw new Error('ClaimKey.eventId invalide.');
  }
  return { tenantId: key.tenantId, entryId: key.entryId, eventId: key.eventId };
}

function fenceOf(value: ClaimFence | undefined): ClaimFence | undefined {
  if (!value || !value.key || typeof value.token !== 'string' || !value.token || typeof value.generation !== 'number' || !Number.isInteger(value.generation) || value.generation < 1) {
    return undefined;
  }
  try { return { key: assertKey(value.key), generation: value.generation, token: value.token }; }
  catch { return undefined; }
}

function copyFence(key: ClaimKey, generation: number, token: string): ClaimFence {
  return { key: { tenantId: key.tenantId, entryId: key.entryId, eventId: key.eventId }, generation, token };
}

function changesOf(result: { meta?: { changes?: number } } | undefined): number {
  return Number(result?.meta?.changes ?? 0);
}

function rowOf(result: unknown): ClaimRow | undefined {
  const row = (result as { results?: unknown[] } | undefined)?.results?.[0];
  return row && typeof row === 'object' ? row as ClaimRow : undefined;
}

function newToken(): string {
  return crypto.randomUUID();
}

function classify(row: ClaimRow | undefined, digest: string, key: ClaimKey, ours?: string): ClaimOutcome {
  if (!row) throw new Error('Ligne de claim introuvable après écriture.');
  if (ours && row.token === ours && row.state === 'processing') {
    return { kind: 'acquired', fence: copyFence(key, Number(row.generation), row.token) };
  }
  if (row.digest_hex !== digest) return { kind: 'digest_collision' };
  if (row.state === 'completed') {
    const snapshot = snapshotFromJson(row.snapshot_json);
    if (!snapshot || snapshot.ok !== true) throw new Error('Snapshot completed illisible.');
    return { kind: 'completed', snapshot };
  }
  if (row.state === 'permanent_failure') {
    const snapshot = snapshotFromJson(row.snapshot_json);
    return snapshot && snapshot.ok === false ? { kind: 'permanent_failure', snapshot } : { kind: 'permanent_failure' };
  }
  if (row.state === 'attempts_exhausted') return { kind: 'attempts_exhausted' };
  return { kind: 'busy' };
}

export function createD1ClaimStore(db: D1Like, config: PublicIngressClaimStoreConfig = {}): ClaimStore {
  if (!db || typeof db.prepare !== 'function' || typeof db.batch !== 'function') {
    throw new Error('ClaimStore exige une base D1 avec prepare et batch.');
  }
  const leaseTtlMs = requirePositiveInt('leaseTtlMs', config.leaseTtlMs, publicIngressClaimStoreDefaults.leaseTtlMs);
  const maxAttempts = requirePositiveInt('maxAttempts', config.maxAttempts, publicIngressClaimStoreDefaults.maxAttempts);
  const snapshotMaxBytes = requirePositiveInt('snapshotMaxBytes', config.snapshotMaxBytes, publicIngressClaimStoreDefaults.snapshotMaxBytes);
  const clock = config.nowMs ?? Date.now;

  const insertSql = `INSERT INTO ${TABLE}(tenant_id,entry_id,event_id,digest_hex,state,generation,token,attempts,lease_until,snapshot_json,created_at,updated_at) VALUES(?,?,?,?, 'processing',1,?,1,?,NULL,?,?) ON CONFLICT(tenant_id,entry_id,event_id) DO NOTHING`;
  const takeoverSql = `UPDATE ${TABLE} SET state='processing',generation=generation+1,token=?,attempts=attempts+1,lease_until=?,updated_at=? WHERE tenant_id=? AND entry_id=? AND event_id=? AND digest_hex=? AND attempts<? AND (state='retryable' OR (state='processing' AND lease_until<=?))`;
  const exhaustSql = `UPDATE ${TABLE} SET state='attempts_exhausted',updated_at=? WHERE tenant_id=? AND entry_id=? AND event_id=? AND digest_hex=? AND state IN ('processing','retryable') AND attempts>=? AND (state='retryable' OR lease_until<=?)`;
  const selectSql = `SELECT tenant_id,entry_id,event_id,digest_hex,state,generation,token,attempts,lease_until,snapshot_json FROM ${TABLE} WHERE tenant_id=? AND entry_id=? AND event_id=?`;
  const casCompleteSql = `UPDATE ${TABLE} SET state='completed',snapshot_json=?,updated_at=? WHERE tenant_id=? AND entry_id=? AND event_id=? AND token=? AND generation=? AND state='processing' AND lease_until>?`;
  const casRetrySql = `UPDATE ${TABLE} SET state='retryable',lease_until=?,updated_at=? WHERE tenant_id=? AND entry_id=? AND event_id=? AND token=? AND generation=? AND state='processing' AND lease_until>?`;
  const casFailSql = `UPDATE ${TABLE} SET state='permanent_failure',snapshot_json=?,updated_at=? WHERE tenant_id=? AND entry_id=? AND event_id=? AND token=? AND generation=? AND state='processing' AND lease_until>?`;
  const casRenewSql = `UPDATE ${TABLE} SET lease_until=?,updated_at=? WHERE tenant_id=? AND entry_id=? AND event_id=? AND token=? AND generation=? AND state='processing' AND lease_until>?`;

  return {
    async claim(key, digest) {
      const claimed = assertKey(key);
      const hex = digestHex(digest);
      const now = nowOf(clock);
      const nowIso = iso(now);
      const leaseUntil = iso(now + leaseTtlMs);
      const token = newToken();
      const results = await db.batch([
        db.prepare(insertSql).bind(claimed.tenantId, claimed.entryId, claimed.eventId, hex, token, leaseUntil, nowIso, nowIso),
        db.prepare(takeoverSql).bind(token, leaseUntil, nowIso, claimed.tenantId, claimed.entryId, claimed.eventId, hex, maxAttempts, nowIso),
        db.prepare(exhaustSql).bind(nowIso, claimed.tenantId, claimed.entryId, claimed.eventId, hex, maxAttempts, nowIso),
        db.prepare(selectSql).bind(claimed.tenantId, claimed.entryId, claimed.eventId),
      ]);
      const inserted = changesOf(results[0]);
      const tookOver = changesOf(results[1]);
      const ours = inserted || tookOver ? token : undefined;
      return classify(rowOf(results[3]), hex, claimed, ours);
    },
    async complete(fence, snapshot) {
      const held = fenceOf(fence);
      const json = snapshotJson(snapshot, snapshotMaxBytes);
      if (!held || !json) return false;
      const parsed = JSON.parse(json) as SanitizedSnapshot;
      if (parsed.ok !== true) return false;
      const now = nowOf(clock);
      const nowIso = iso(now);
      const result = await db.prepare(casCompleteSql).bind(
        json, nowIso, held.key.tenantId, held.key.entryId, held.key.eventId, held.token, held.generation, nowIso,
      ).run();
      return changesOf(result) === 1;
    },
    async retry(fence) {
      const held = fenceOf(fence);
      if (!held) return false;
      const now = nowOf(clock);
      const nowIso = iso(now);
      const result = await db.prepare(casRetrySql).bind(
        nowIso, nowIso, held.key.tenantId, held.key.entryId, held.key.eventId, held.token, held.generation, nowIso,
      ).run();
      return changesOf(result) === 1;
    },
    async failPermanent(fence, snapshot) {
      const held = fenceOf(fence);
      if (!held) return false;
      let json: string | null = null;
      if (snapshot !== undefined) {
        const encoded = snapshotJson(snapshot, snapshotMaxBytes);
        if (!encoded) return false;
        const parsed = JSON.parse(encoded) as SanitizedSnapshot;
        if (parsed.ok !== false) return false;
        json = encoded;
      }
      const now = nowOf(clock);
      const nowIso = iso(now);
      const result = await db.prepare(casFailSql).bind(
        json, nowIso, held.key.tenantId, held.key.entryId, held.key.eventId, held.token, held.generation, nowIso,
      ).run();
      return changesOf(result) === 1;
    },
    async renew(fence) {
      const held = fenceOf(fence);
      if (!held) return false;
      const now = nowOf(clock);
      const nowIso = iso(now);
      const leaseUntil = iso(now + leaseTtlMs);
      const result = await db.prepare(casRenewSql).bind(
        leaseUntil, nowIso, held.key.tenantId, held.key.entryId, held.key.eventId, held.token, held.generation, nowIso,
      ).run();
      return changesOf(result) === 1;
    },
  };
}
