// Transport HTTP à racines fixes pour les fournisseurs d'agents (contrat D03).
// Le credential est relu à chaque appel via le port injecté ; aucun cache, retry,
// polling, persistance ni journalisation de corps. Ce module n'est pas réexporté
// par index.ts : aucun appelant ne choisit une URL arbitraire.
import type { AgentProviderId, DeliveryKnowledge, ProviderClientOptions, ProviderCredential, ProviderFailureReason } from './types.ts';
import { ProviderFailure } from './types.ts';

export const providerRoots: Readonly<Record<AgentProviderId, string>> = Object.freeze({
  cursor: 'https://api.cursor.com',
  xai: 'https://api.x.ai',
});

export const transportLimits = Object.freeze({
  timeoutMs: Object.freeze({ default: 15_000, min: 1_000, max: 120_000 }),
  maxResponseBytes: Object.freeze({ default: 2_000_000, min: 1_024, max: 16_000_000 }),
  errorBodyBytes: 65_536,
  retryAfterMaxMs: 3_600_000,
  credentialMaxLength: 4_096,
});

// Codes fournisseur relayés tels quels ; tout autre code ou message est ignoré.
export const allowedProviderCodes: Readonly<Record<AgentProviderId, readonly string[]>> = Object.freeze({
  cursor: Object.freeze([
    'unauthorized', 'api_key_not_found', 'plan_required', 'role_forbidden', 'feature_unavailable',
    'integration_not_connected', 'validation_error', 'missing_body', 'invalid_model', 'invalid_branch_name',
    'repository_required', 'repository_access', 'pr_resolution_failed', 'artifact_not_found',
    'service_account_required', 'agent_not_found', 'run_not_found', 'agent_busy', 'agent_archived',
    'agent_id_conflict', 'run_not_cancellable', 'rate_limit_exceeded', 'usage_limit_exceeded',
    'stream_expired', 'stream_unavailable', 'invalid_last_event_id', 'client_cancelled',
    'not_implemented', 'upstream_error', 'internal_error',
  ]),
  xai: Object.freeze([
    'invalid_request_error', 'invalid_api_key', 'unauthorized', 'forbidden', 'insufficient_quota',
    'rate_limit_exceeded', 'model_not_found', 'context_length_exceeded', 'server_error',
  ]),
});

export type TransportRequest<T> = {
  method: 'GET' | 'POST';
  path: string;
  body?: Record<string, unknown>;
  validate: (data: unknown) => T;
  signal?: AbortSignal;
};

export type Transport = {
  readonly provider: AgentProviderId;
  readonly root: string;
  request<T>(request: TransportRequest<T>): Promise<T>;
};

function boundedInteger(value: unknown, bounds: { default: number; min: number; max: number }, field: string, provider: AgentProviderId) {
  if (value === undefined) return bounds.default;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < bounds.min || value > bounds.max) {
    throw new ProviderFailure({ provider, code: 'invalid_request', delivery: 'not_sent', reason: 'schema', field });
  }
  return value;
}

// Chemins construits par les adaptateurs uniquement : absolus, sans requête, fragment ni segment relatif.
export function assertPath(provider: AgentProviderId, path: string) {
  if (typeof path !== 'string' || path.length > 2_048 || !/^(?:\/(?:[A-Za-z0-9._~-]|%[0-9A-Fa-f]{2})+)+$/.test(path) || path.split('/').some(segment => /^\.+$/.test(segment))) {
    throw new ProviderFailure({ provider, code: 'invalid_request', delivery: 'not_sent', reason: 'schema', field: 'path' });
  }
  return path;
}

export function isValidCredential(provider: AgentProviderId, credential: unknown): credential is ProviderCredential {
  if (!credential || typeof credential !== 'object') return false;
  const c = credential as Record<string, unknown>;
  return c.provider === provider && c.enabled === true && typeof c.key === 'string'
    && c.key.length > 0 && c.key.length <= transportLimits.credentialMaxLength && /^[\x21-\x7e]+$/.test(c.key);
}

function credentialReason(provider: AgentProviderId, credential: unknown): ProviderFailureReason {
  if (!credential || typeof credential !== 'object') return 'credential_missing';
  const c = credential as Record<string, unknown>;
  if (c.provider !== provider) return 'credential_mismatch';
  if (c.enabled !== true) return 'credential_disabled';
  return 'credential_malformed';
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  let ms: number;
  if (/^\d{1,7}$/.test(trimmed)) ms = Number(trimmed) * 1000;
  else {
    const date = Date.parse(trimmed);
    if (Number.isNaN(date)) return undefined;
    ms = date - now;
  }
  return Math.min(Math.max(ms, 0), transportLimits.retryAfterMaxMs);
}

function extractProviderCode(provider: AgentProviderId, body: Uint8Array | null): string | undefined {
  if (!body) return undefined;
  let data: unknown;
  try { data = JSON.parse(new TextDecoder().decode(body)); } catch { return undefined; }
  if (!data || typeof data !== 'object') return undefined;
  const record = data as Record<string, unknown>;
  const nested = record.error && typeof record.error === 'object' ? record.error as Record<string, unknown> : undefined;
  const candidates = [nested?.code, record.code, nested?.type];
  const allowed = allowedProviderCodes[provider];
  for (const candidate of candidates) if (typeof candidate === 'string' && allowed.includes(candidate)) return candidate;
  return undefined;
}

// Lecture en flux, bornée avant la fin : renvoie null dès que la limite est dépassée.
export async function readBounded(response: Response, maximum: number): Promise<Uint8Array | null> {
  const declared = response.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximum)) { await response.body?.cancel(); return null; }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function isJsonContentType(response: Response) {
  const type = response.headers.get('content-type')?.toLowerCase() ?? '';
  return type.startsWith('application/json') || /\+json(?:;|$)/.test(type.split(';')[0]);
}

export function createTransport(provider: AgentProviderId, options: ProviderClientOptions): Transport {
  if (!options || typeof options.resolveCredential !== 'function') {
    throw new ProviderFailure({ provider, code: 'invalid_request', delivery: 'not_sent', reason: 'schema', field: 'resolveCredential' });
  }
  if (options.fetch !== undefined && typeof options.fetch !== 'function') {
    throw new ProviderFailure({ provider, code: 'invalid_request', delivery: 'not_sent', reason: 'schema', field: 'fetch' });
  }
  const timeoutMs = boundedInteger(options.timeoutMs, transportLimits.timeoutMs, 'timeoutMs', provider);
  const maxResponseBytes = boundedInteger(options.maxResponseBytes, transportLimits.maxResponseBytes, 'maxResponseBytes', provider);
  const root = providerRoots[provider];
  const resolveCredential = options.resolveCredential;
  const fetchImpl = options.fetch;

  async function request<T>(input: TransportRequest<T>): Promise<T> {
    const path = assertPath(provider, input.path);
    const signal = input.signal;
    if (signal?.aborted) throw new ProviderFailure({ provider, code: 'provider_timeout', delivery: 'not_sent', reason: 'caller_abort' });

    // Le budget (délai + abort de l'appelant) couvre toute l'opération, résolution du credential incluse.
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const interrupted = (delivery: DeliveryKnowledge) => new ProviderFailure({
      provider, code: timedOut ? 'provider_timeout' : signal?.aborted ? 'provider_timeout' : 'provider_unreachable',
      delivery, reason: timedOut ? 'timeout' : signal?.aborted ? 'caller_abort' : 'network',
    });

    try {
      // Résolution vivante : un credential révoqué ou désactivé arrête l'appel avant tout réseau.
      // Une résolution bloquée est abandonnée à l'expiration ou à l'annulation ; sa valeur tardive est ignorée.
      const abandoned = Symbol('abandoned');
      const interruption = new Promise<typeof abandoned>(resolve => { controller.signal.addEventListener('abort', () => resolve(abandoned), { once: true }); });
      let resolution: Promise<unknown>;
      try { resolution = Promise.resolve(resolveCredential()); }
      catch { throw new ProviderFailure({ provider, code: 'credential_unavailable', delivery: 'not_sent', reason: 'credential_missing' }); }
      resolution.catch(() => undefined);
      const outcome = await Promise.race([resolution.then(value => ({ value }), () => ({ failed: true as const })), interruption]);
      if (outcome === abandoned || controller.signal.aborted) {
        throw timedOut
          ? new ProviderFailure({ provider, code: 'credential_unavailable', delivery: 'not_sent', reason: 'timeout' })
          : new ProviderFailure({ provider, code: 'provider_timeout', delivery: 'not_sent', reason: 'caller_abort' });
      }
      if ('failed' in outcome) throw new ProviderFailure({ provider, code: 'credential_unavailable', delivery: 'not_sent', reason: 'credential_missing' });
      const credential = outcome.value;
      if (!isValidCredential(provider, credential)) {
        throw new ProviderFailure({ provider, code: 'credential_unavailable', delivery: 'not_sent', reason: credentialReason(provider, credential) });
      }
      const headers: Record<string, string> = { authorization: `Bearer ${credential.key}`, accept: 'application/json' };
      let body: string | undefined;
      if (input.body !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(input.body); }

      // Budget épuisé pendant la validation : aucun fetch n'est invoqué.
      if (controller.signal.aborted) throw interrupted('not_sent');
      let response: Response;
      try {
        // fetch serveur par défaut ; jamais de suivi de redirection pour ne pas transférer l'identifiant.
        response = await (fetchImpl ?? globalThis.fetch)(root + path, { method: input.method, headers, body, redirect: 'manual', signal: controller.signal });
      } catch { throw interrupted('unknown'); }

      const status = response.status;
      if (status >= 300 && status < 400) {
        await response.body?.cancel();
        throw new ProviderFailure({ provider, code: 'provider_redirect', delivery: 'responded', status, reason: 'redirect' });
      }
      if (status < 200 || status >= 400) {
        let errorBody: Uint8Array | null = null;
        try { errorBody = await readBounded(response, Math.min(maxResponseBytes, transportLimits.errorBodyBytes)); } catch { errorBody = null; }
        const providerCode = extractProviderCode(provider, errorBody);
        const retryAfterMs = status === 429 || status === 503 ? parseRetryAfter(response.headers.get('retry-after')) : undefined;
        const code = status === 401 || status === 403 ? 'provider_auth'
          : status === 429 ? 'provider_quota'
          : status >= 400 && status < 500 ? 'provider_rejected'
          : status >= 500 ? 'provider_unreachable'
          : 'provider_response';
        throw new ProviderFailure({ provider, code, delivery: 'responded', status, providerCode, retryAfterMs, reason: 'http_status' });
      }
      if (!isJsonContentType(response)) {
        await response.body?.cancel();
        throw new ProviderFailure({ provider, code: 'provider_response', delivery: 'responded', status, reason: 'not_json' });
      }
      let bytes: Uint8Array | null;
      try { bytes = await readBounded(response, maxResponseBytes); }
      catch { throw interrupted('responded'); }
      if (bytes === null) throw new ProviderFailure({ provider, code: 'provider_response', delivery: 'responded', status, reason: 'too_large' });
      let data: unknown;
      try { data = JSON.parse(new TextDecoder().decode(bytes)); }
      catch { throw new ProviderFailure({ provider, code: 'provider_response', delivery: 'responded', status, reason: 'not_json' }); }
      try { return input.validate(data); }
      catch (error) {
        if (error instanceof ProviderFailure) throw error;
        throw new ProviderFailure({ provider, code: 'provider_response', delivery: 'responded', status, reason: 'schema' });
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  return Object.freeze({ provider, root, request });
}

// Aides de validation partagées par les adaptateurs : elles lèvent une ProviderFailure
// `provider_response` (réponse) ou `invalid_request` (entrée) selon le contexte fourni.
export type Check = { provider: AgentProviderId; delivery: DeliveryKnowledge; code: 'invalid_request' | 'provider_response'; status?: number };

export function failCheck(check: Check, field: string, reason: ProviderFailureReason = 'schema'): never {
  throw new ProviderFailure({ provider: check.provider, code: check.code, delivery: check.delivery, reason, field, status: check.status });
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
export function expectRecord(check: Check, value: unknown, field: string) {
  if (!isRecord(value)) failCheck(check, field);
  return value;
}
export function expectString(check: Check, value: unknown, field: string, max = 10_000, min = 1) {
  if (typeof value !== 'string' || value.length < min || value.length > max) failCheck(check, field);
  return value;
}
export function optionalString(check: Check, value: unknown, field: string, max = 10_000) {
  if (value === undefined || value === null) return undefined;
  return expectString(check, value, field, max, 0);
}
export function optionalBoolean(check: Check, value: unknown, field: string) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') failCheck(check, field);
  return value;
}
export function expectEnum<T extends string>(check: Check, value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) failCheck(check, field, check.code === 'provider_response' ? 'unknown_status' : 'schema');
  return value as T;
}
export function expectArray(check: Check, value: unknown, field: string, max: number) {
  if (!Array.isArray(value) || value.length > max) failCheck(check, field);
  return value as unknown[];
}
export function optionalInteger(check: Check, value: unknown, field: string, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) failCheck(check, field);
  return value;
}
// Une clé inconnue n'est jamais recopiée dans l'échec : seul le conteneur connu est nommé.
export function rejectUnknownKeys(check: Check, value: Record<string, unknown>, allowed: readonly string[], field: string) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) failCheck(check, field, 'unknown_field');
}
