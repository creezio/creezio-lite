// Moteur d’admission publique (contrat C01). Types, validation de déclaration et
// orchestration à ports explicites. Aucune route HTTP, aucune requête D1, aucune
// signature fournisseur dans le noyau, aucune Identity. Un échantillon factory
// ne prouve pas chaque appel.
import type { LiteEnvironment } from './types.ts';
import { routeKey } from './operations.ts';

export type PublicAdmissionKind = 'signed' | 'guest';
export type CapabilityId = 'verify' | 'admitGuest' | 'claimStore' | 'vault' | 'limiter';
export type CapabilityProbe = { ready(): boolean; admit?(): Promise<'ok' | 'unavailable'> };
export type PublicIngressEntry = {
  id: string;
  method: 'POST' | 'GET';
  path: string;
  admission: PublicAdmissionKind;
  tenantId: string;
  maxBytes: number;
  contentTypes: readonly string[];
  timeoutMs: number;
  vaultRef?: { integrationId: string };
  abuse: {
    policy: string;
    requires: readonly CapabilityId[];
  };
};
export type RouteParams = Readonly<Record<string, string>>;
export type BoundedMeta = Readonly<{
  headers: Readonly<Record<string, string>>;
  query: Readonly<Record<string, string>>;
}>;
export type SignedProof = { kind: 'signed'; eventId: string; payloadDigest: Uint8Array };
export type GuestAdmission = {
  kind: 'guest';
  view?: Readonly<Record<string, unknown>>;
};
export type VerifyInput = {
  entry: PublicIngressEntry;
  tenantCandidate: string;
  rawBytes: Uint8Array;
  headers: Headers;
  nowMs: number;
  secret?: string;
};
export type ClaimKey = { tenantId: string; entryId: string; eventId: string };
export type ClaimFence = { key: ClaimKey; generation: number; token: string };
export type SanitizedSnapshot =
  | { ok: true; status: 200 | 201 | 202; body: unknown }
  | { ok: false; status: 400 | 403 | 404 | 409 | 410 | 413 | 415 | 422 | 429 | 503; body: unknown };
export type HandleResult =
  | { outcome: 'success'; status: 200 | 201 | 202; body: unknown }
  | { outcome: 'retry' }
  | { outcome: 'permanent'; status: 400 | 403 | 404 | 409 | 410 | 422; body: unknown };
export type ClaimOutcome =
  | { kind: 'acquired'; fence: ClaimFence }
  | { kind: 'busy' }
  | { kind: 'completed'; snapshot: SanitizedSnapshot }
  | { kind: 'digest_collision' }
  | { kind: 'permanent_failure'; snapshot?: SanitizedSnapshot }
  | { kind: 'attempts_exhausted' };
export type ClaimStore = {
  claim(key: ClaimKey, digest: Uint8Array): Promise<ClaimOutcome>;
  complete(fence: ClaimFence, snapshot: SanitizedSnapshot): Promise<boolean>;
  retry(fence: ClaimFence): Promise<boolean>;
  failPermanent(fence: ClaimFence, snapshot?: SanitizedSnapshot): Promise<boolean>;
  renew(fence: ClaimFence): Promise<boolean>;
};
export type PublicIngressServices = {
  readonly db: LiteEnvironment['DB'];
  readonly env: LiteEnvironment;
  readonly requestId: string;
  readonly tenantId: string;
};
export type PublicIngressBindings = {
  verify?(input: VerifyInput): Promise<{ ok: true; eventId: string } | { ok: false }>;
  admitGuest?(input: {
    entry: PublicIngressEntry;
    tenantId: string;
    params: RouteParams;
    meta: BoundedMeta;
    rawBytes: Uint8Array;
  }): Promise<{ ok: true; admission: GuestAdmission } | { ok: false }>;
  handle(ctx: PublicAdmissionContext): Promise<HandleResult>;
  claimStore?: ClaimStore;
  limiter?: CapabilityProbe;
};
export type PublicIngressFactory = (services: PublicIngressServices) => PublicIngressBindings;
export type PublicIngressDeclaration = {
  entries: readonly PublicIngressEntry[];
  resolveTenant(entry: PublicIngressEntry): string;
  createRequestScope: PublicIngressFactory;
};
export type PublicAdmissionContext = {
  kind: 'public';
  entryId: string;
  proof: SignedProof | GuestAdmission;
  tenantId: string;
  requestId: string;
  rawBytes: Uint8Array;
  params: RouteParams;
};

export type RouteCatalogEntry = {
  id: string;
  method: string;
  path: string;
  aliases?: readonly string[];
};

export type VaultPort = {
  ready(): boolean;
  decrypt(input: { tenantId: string; integrationId: string; aad: string }): Promise<string>;
};

export type PublicIngressKitPorts = {
  db: LiteEnvironment['DB'];
  env: LiteEnvironment;
  vault?: VaultPort;
};

export type PublicIngressInput = {
  method: string;
  path: string;
  headers: Headers | HeadersInit;
  rawBytes: Uint8Array;
  query?: Readonly<Record<string, string>>;
  nowMs: number;
  requestId: string;
};

export type PublicIngressAdmitResult =
  | { kind: 'unmatched' }
  | {
      kind: 'response';
      status: number;
      body: unknown;
      code?: string;
      replayed?: true;
    };

export const publicAdmissionKinds = Object.freeze(['signed', 'guest'] as const);
export const publicCapabilityIds = Object.freeze(['verify', 'admitGuest', 'claimStore', 'vault', 'limiter'] as const);
export const inboundMailRouteKey = routeKey('POST', '/api/v1/email/inbound/:orgId');
export const publicIngressLimits = Object.freeze({
  maxBytesCeiling: 5_242_880,
  timeoutMsMin: 1,
  timeoutMsMax: 120_000,
  paramMaxLength: 160,
  eventIdMaxLength: 160,
  integrationIdMaxLength: 160,
  policyMaxLength: 200,
});

const ENTRY_ID = /^[a-z][a-z0-9_.-]{0,119}$/;
const PATH_PARAM = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const TENANT_WS = /^ws_[a-f0-9]{32}$/;
const TENANT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INTEGRATION_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/;
const META_HEADER_ALLOWLIST = Object.freeze(['content-type', 'accept', 'user-agent']);
const FORBIDDEN_BINDING_KEYS = Object.freeze(['identity', 'session', 'principal', 'db', 'env', 'secret', 'workspace', 'credential']);
const SENSITIVE_KEY = /password|passwd|secret|token|authorization|cookie|api_?key|jwt|bearer|credential|hash|session|rawbytes|set-cookie/i;
const SUCCESS_STATUSES = new Set([200, 201, 202]);
const PERMANENT_STATUSES = new Set([400, 403, 404, 409, 410, 422]);
const SNAPSHOT_FAIL_STATUSES = new Set([400, 403, 404, 409, 410, 413, 415, 422, 429, 503]);

export type PublicIngressDeclarationCode =
  | 'declaration_invalid'
  | 'resolve_tenant_invalid'
  | 'factory_invalid'
  | 'entry_invalid'
  | 'duplicate_entry'
  | 'duplicate_route'
  | 'route_collision'
  | 'inbound_mail_collision'
  | 'signed_verify_required'
  | 'signed_claim_store_required'
  | 'guest_admit_required'
  | 'guest_claim_store_forbidden'
  | 'capability_missing'
  | 'singleton_factory'
  | 'circular_tenant_factory'
  | 'factory_probe_failed'
  | 'factory_probe_business_effect'
  | 'services_not_serializable'
  | 'identity_forbidden'
  | 'operations_catalog_required'
  | 'bounded_kind_forbidden';

export class PublicIngressDeclarationError extends Error {
  readonly code: PublicIngressDeclarationCode;
  constructor(code: PublicIngressDeclarationCode, message: string) {
    super(message);
    this.name = 'PublicIngressDeclarationError';
    this.code = code;
  }
}

export type PublicIngressProbeReport = Readonly<{
  sampledAllocations: number;
  provesEveryCall: false;
  reason: 'factory_sample_is_not_universal';
  tenantsProbed: readonly string[];
  requestIdsProbed: readonly string[];
  crossTenantProbe: 'compared' | 'not_applicable_single_tenant';
  operationsCatalog: 'checked';
  inboundMail: 'reserved';
  vaultPort: 'runtime_kit_port' | 'not_required';
  circularityGuards: 'installed' | 'not_installed_readonly';
}>;

export type PublicIngressValidation = Readonly<{
  declaration: PublicIngressDeclaration;
  probe: PublicIngressProbeReport;
}>;

export type PublicIngressValidationOptions = {
  operations: readonly RouteCatalogEntry[];
};

function refuse(code: PublicIngressDeclarationCode, message: string): never {
  throw new PublicIngressDeclarationError(code, message);
}

export function isPublicTenantId(value: string): boolean {
  return TENANT_WS.test(value) || TENANT_UUID.test(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function uniqueStrings(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function isCapabilityId(value: unknown): value is CapabilityId {
  return typeof value === 'string' && (publicCapabilityIds as readonly string[]).includes(value);
}

function assertEntry(entry: unknown, index: number): PublicIngressEntry {
  const row = asRecord(entry);
  if (!row) refuse('entry_invalid', `Entrée publique ${index} invalide.`);
  if (typeof row.id !== 'string' || !ENTRY_ID.test(row.id)) refuse('entry_invalid', `Identifiant d’entrée publique invalide : ${String(row.id)}.`);
  if (row.method !== 'POST' && row.method !== 'GET') refuse('entry_invalid', `Méthode d’entrée publique invalide : ${row.id}.`);
  if (typeof row.path !== 'string' || !row.path.startsWith('/api/v1/') || /\/\/|\s/.test(row.path) || row.path.length > 512) {
    refuse('entry_invalid', `Chemin d’entrée publique invalide : ${row.id}.`);
  }
  for (const segment of row.path.split('/')) {
    if (segment.startsWith(':') && !PATH_PARAM.test(segment.slice(1))) refuse('entry_invalid', `Paramètre de chemin invalide pour ${row.id}.`);
  }
  if (row.admission !== 'signed' && row.admission !== 'guest') {
    if (row.admission === 'bounded') refuse('bounded_kind_forbidden', `Le descripteur bounded n’est pas admis en v1 (${row.id}).`);
    refuse('entry_invalid', `Kind d’admission invalide : ${row.id}.`);
  }
  if (typeof row.tenantId !== 'string' || !isPublicTenantId(row.tenantId)) refuse('entry_invalid', `tenantId de configuration invalide : ${row.id}.`);
  if (row.mcp === true || row.tokenAllowed === true) refuse('entry_invalid', `Une entrée publique ne peut pas être mcp/tokenAllowed (${row.id}).`);
  if (typeof row.maxBytes !== 'number' || !Number.isInteger(row.maxBytes) || row.maxBytes < 0 || row.maxBytes > publicIngressLimits.maxBytesCeiling) {
    refuse('entry_invalid', `maxBytes invalide : ${row.id}.`);
  }
  if (!Array.isArray(row.contentTypes) || row.contentTypes.some(type => typeof type !== 'string' || !type.trim() || type.length > 120)) {
    refuse('entry_invalid', `contentTypes invalides : ${row.id}.`);
  }
  if (row.method === 'GET') {
    if (row.maxBytes !== 0) refuse('entry_invalid', `GET ${row.id} exige maxBytes = 0.`);
    if (row.contentTypes.length !== 0) refuse('entry_invalid', `GET ${row.id} n’exige pas de Content-Type.`);
  } else if (row.maxBytes < 1 || row.contentTypes.length < 1) {
    refuse('entry_invalid', `POST ${row.id} exige un plafond et des contentTypes.`);
  }
  if (typeof row.timeoutMs !== 'number' || !Number.isInteger(row.timeoutMs) || row.timeoutMs < publicIngressLimits.timeoutMsMin || row.timeoutMs > publicIngressLimits.timeoutMsMax) {
    refuse('entry_invalid', `timeoutMs invalide : ${row.id}.`);
  }
  if (row.vaultRef !== undefined) {
    const vault = asRecord(row.vaultRef);
    if (!vault || typeof vault.integrationId !== 'string' || !INTEGRATION_ID.test(vault.integrationId)) {
      refuse('entry_invalid', `vaultRef invalide : ${row.id}.`);
    }
  }
  const abuse = asRecord(row.abuse);
  if (!abuse || typeof abuse.policy !== 'string' || !abuse.policy.trim() || abuse.policy.length > publicIngressLimits.policyMaxLength) {
    refuse('entry_invalid', `abuse.policy invalide : ${row.id}.`);
  }
  if (!Array.isArray(abuse.requires) || !abuse.requires.every(isCapabilityId) || !uniqueStrings(abuse.requires)) {
    refuse('entry_invalid', `abuse.requires invalide : ${row.id}.`);
  }
  if (row.admission === 'guest' && (abuse.requires.includes('claimStore') || abuse.requires.includes('verify'))) {
    refuse('guest_claim_store_forbidden', `Guest ${row.id} ne déclare pas claimStore/verify.`);
  }
  if (row.admission === 'guest' && (row.vaultRef || abuse.requires.includes('vault'))) refuse('entry_invalid', `Guest ${row.id} n’ouvre pas de coffre.`);
  if ((abuse.requires.includes('vault') || row.vaultRef) && !(row.vaultRef && (row.admission === 'signed'))) {
    refuse('entry_invalid', `vaultRef signed est exigé lorsque le coffre est requis (${row.id}).`);
  }
  return row as unknown as PublicIngressEntry;
}

function requiredCapabilities(entry: PublicIngressEntry): CapabilityId[] {
  const required: CapabilityId[] = entry.admission === 'signed' ? ['verify', 'claimStore'] : ['admitGuest'];
  for (const capability of entry.abuse.requires) if (!required.includes(capability)) required.push(capability);
  if (entry.vaultRef && !required.includes('vault')) required.push('vault');
  return required;
}

function catalogRouteKeys(operations: readonly RouteCatalogEntry[]): Map<string, string> {
  const routes = new Map<string, string>();
  for (const operation of operations) {
    for (const path of [operation.path, ...(operation.aliases ?? [])]) {
      const key = routeKey(operation.method, path);
      if (!routes.has(key)) routes.set(key, operation.id);
    }
  }
  return routes;
}

function matchPath(route: string, pathname: string): RouteParams | null {
  const pattern = route.replace(/\/$/, '').split('/');
  const actual = pathname.replace(/\/$/, '').split('/');
  if (pattern.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i].startsWith(':')) {
      let value: string;
      try { value = decodeURIComponent(actual[i] ?? ''); } catch { return null; }
      if (!value || value.length > publicIngressLimits.paramMaxLength) return null;
      params[pattern[i].slice(1)] = value;
    } else if (pattern[i] !== actual[i]) return null;
  }
  return Object.freeze(params);
}

function matchEntry(entries: readonly PublicIngressEntry[], method: string, path: string): { entry: PublicIngressEntry; params: RouteParams } | undefined {
  const normalized = path.replace(/\/$/, '') || '/';
  const candidates: { entry: PublicIngressEntry; params: RouteParams; paramsCount: number }[] = [];
  for (const entry of entries) {
    if (entry.method !== method) continue;
    const params = matchPath(entry.path, normalized);
    if (params) candidates.push({ entry, params, paramsCount: (entry.path.match(/\/:/g) ?? []).length });
  }
  candidates.sort((a, b) => a.paramsCount - b.paramsCount);
  return candidates[0];
}

function headersOf(init: Headers | HeadersInit): Headers {
  return init instanceof Headers ? init : new Headers(init);
}

function header(headers: Headers, name: string): string | null {
  return headers.get(name);
}

function boundedMeta(headers: Headers, query: Readonly<Record<string, string>> | undefined): BoundedMeta {
  const allowed: Record<string, string> = {};
  for (const name of META_HEADER_ALLOWLIST) {
    const value = headers.get(name);
    if (value) allowed[name] = value;
  }
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(query ?? {})) {
    if (key.toLowerCase() === 'workspace') continue;
    if (typeof value === 'string') filtered[key] = value;
  }
  return Object.freeze({ headers: Object.freeze(allowed), query: Object.freeze(filtered) });
}

function contentTypeAllowed(value: string | null, allowed: readonly string[]): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase().split(';')[0]!.trim();
  return allowed.some(type => normalized === type.toLowerCase() || normalized.startsWith(type.toLowerCase()));
}

function probeDb(): LiteEnvironment['DB'] {
  const trap = (name: string) => () => {
    throw new PublicIngressDeclarationError('factory_probe_business_effect', `La factory ne doit pas déclencher d’effet métier en validation (${name}).`);
  };
  return new Proxy({} as LiteEnvironment['DB'], {
    get(_target, property) {
      if (property === 'then' || property === 'toJSON') return undefined;
      return trap(String(property));
    },
  });
}

function probeEnv(db: LiteEnvironment['DB']): LiteEnvironment {
  const env: LiteEnvironment = { DB: db, LITE_INTEGRATION_SECRET: 'probe-secret-not-for-verify' };
  return new Proxy(env, {
    get(target, property, receiver) {
      if (property === 'then' || property === 'toJSON') return undefined;
      if (property === 'DB') return db;
      if (property === 'LITE_INTEGRATION_SECRET' || property === 'BUCKET') {
        throw new PublicIngressDeclarationError('factory_probe_business_effect', 'La factory ne lit pas le coffre en validation.');
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

function freezeServices(services: PublicIngressServices): PublicIngressServices {
  const frozen = Object.defineProperties({
    db: services.db,
    env: services.env,
    requestId: services.requestId,
    tenantId: services.tenantId,
  } as PublicIngressServices, {
    toJSON: {
      enumerable: false,
      value() {
        throw new PublicIngressDeclarationError('services_not_serializable', 'db, env et secret ne sont pas sérialisables.');
      },
    },
  });
  return Object.freeze(frozen);
}

function inspectBindings(bindings: unknown, label: string): PublicIngressBindings {
  const row = asRecord(bindings);
  if (!row) refuse('factory_invalid', `Bindings invalides (${label}).`);
  for (const key of FORBIDDEN_BINDING_KEYS) {
    if (hasOwn(row, key) && row[key] !== undefined) refuse('identity_forbidden', `Bindings ${label} portent ${key}.`);
  }
  if (typeof row.handle !== 'function') refuse('capability_missing', `handle manquant (${label}).`);
  return row as unknown as PublicIngressBindings;
}

function bindingHas(bindings: PublicIngressBindings, capability: CapabilityId): boolean {
  if (capability === 'verify') return typeof bindings.verify === 'function';
  if (capability === 'admitGuest') return typeof bindings.admitGuest === 'function';
  if (capability === 'claimStore') {
    const store = bindings.claimStore;
    return !!store && typeof store.claim === 'function' && typeof store.complete === 'function'
      && typeof store.retry === 'function' && typeof store.failPermanent === 'function' && typeof store.renew === 'function';
  }
  if (capability === 'limiter') return !!bindings.limiter && typeof bindings.limiter.ready === 'function';
  if (capability === 'vault') return true;
  return false;
}

function assertSampleCapabilities(bindings: PublicIngressBindings, required: readonly CapabilityId[], label: string) {
  for (const capability of required) {
    if (capability === 'vault') continue;
    if (!bindingHas(bindings, capability)) refuse(capability === 'verify' ? 'signed_verify_required' : capability === 'claimStore' ? 'signed_claim_store_required' : capability === 'admitGuest' ? 'guest_admit_required' : 'capability_missing', `Capacité ${capability} absente de l’échantillon ${label}.`);
    if (capability === 'limiter' && bindings.limiter!.ready() !== true) refuse('capability_missing', `limiter.ready() doit être vrai sur l’échantillon ${label}.`);
  }
}

function wrapTenantFactory(declaration: PublicIngressDeclaration): { resolveTenant: PublicIngressDeclaration['resolveTenant']; createRequestScope: PublicIngressFactory } {
  let resolving = false;
  let constructing = false;
  const resolveTenant = (entry: PublicIngressEntry) => {
    if (constructing) refuse('circular_tenant_factory', 'createRequestScope ne rappelle pas resolveTenant.');
    resolving = true;
    try { return declaration.resolveTenant(entry); }
    finally { resolving = false; }
  };
  const createRequestScope = (services: PublicIngressServices) => {
    if (resolving) refuse('circular_tenant_factory', 'resolveTenant ne rappelle pas createRequestScope.');
    constructing = true;
    try { return declaration.createRequestScope(services); }
    finally { constructing = false; }
  };
  return { resolveTenant, createRequestScope };
}

export function validatePublicIngressDeclaration(
  declaration: unknown,
  options?: PublicIngressValidationOptions,
): PublicIngressValidation {
  if (!options || !Array.isArray(options.operations)) refuse('operations_catalog_required', 'Le catalogue d’opérations doit être fourni explicitement ; son absence n’est pas une unicité silencieuse.');
  const row = asRecord(declaration);
  if (!row || !Array.isArray(row.entries)) refuse('declaration_invalid', 'Déclaration publicIngress invalide.');
  if (typeof row.resolveTenant !== 'function') refuse('resolve_tenant_invalid', 'resolveTenant doit être une fonction de configuration.');
  if (typeof row.createRequestScope !== 'function') refuse('factory_invalid', 'createRequestScope doit être une fonction.');
  const entries = row.entries.map(assertEntry);
  if (!entries.length) refuse('declaration_invalid', 'Au moins une entrée publique est exigée.');
  const ids = new Map<string, string>();
  const routes = new Map<string, string>();
  const privateRoutes = catalogRouteKeys(options.operations);
  const requiredByKind: CapabilityId[] = [];
  let hasSigned = false;
  let hasGuest = false;
  for (const entry of entries) {
    if (ids.has(entry.id)) refuse('duplicate_entry', `Entrée publique dupliquée : ${entry.id}.`);
    ids.set(entry.id, entry.id);
    const key = routeKey(entry.method, entry.path);
    if (routes.has(key)) refuse('duplicate_route', `Route publique dupliquée : ${key}.`);
    routes.set(key, entry.id);
    if (key === inboundMailRouteKey) refuse('inbound_mail_collision', `Collision avec l’inbound mail : ${entry.id}.`);
    const owner = privateRoutes.get(key);
    if (owner) refuse('route_collision', `Collision de route publique ${key} (${owner}, ${entry.id}).`);
    if (entry.admission === 'signed') hasSigned = true;
    else hasGuest = true;
    for (const capability of requiredCapabilities(entry)) if (!requiredByKind.includes(capability)) requiredByKind.push(capability);
  }
  if (hasGuest && !hasSigned && requiredByKind.includes('claimStore')) refuse('guest_claim_store_forbidden', 'Guest seul n’admet pas claimStore.');
  const target = declaration as PublicIngressDeclaration;
  const originalResolve = target.resolveTenant;
  const originalFactory = target.createRequestScope;
  const wrapped = wrapTenantFactory({ entries, resolveTenant: originalResolve, createRequestScope: originalFactory });
  let circularityGuards: PublicIngressProbeReport['circularityGuards'] = 'not_installed_readonly';
  try {
    target.resolveTenant = wrapped.resolveTenant;
    target.createRequestScope = wrapped.createRequestScope;
    circularityGuards = 'installed';
  } catch {
    circularityGuards = 'not_installed_readonly';
  }
  try {
  const tenants = [...new Set(entries.map(entry => {
    let tenant: string;
    try { tenant = wrapped.resolveTenant(entry); }
    catch (error) {
      if (error instanceof PublicIngressDeclarationError) throw error;
      refuse('resolve_tenant_invalid', `resolveTenant a échoué pour ${entry.id}.`);
    }
    if (tenant !== entry.tenantId || !isPublicTenantId(tenant)) refuse('resolve_tenant_invalid', `resolveTenant doit renvoyer le tenant de configuration de ${entry.id}.`);
    return tenant;
  }))];
  const requestIds = ['ingress-probe:0', 'ingress-probe:1'];
  const db = probeDb();
  const env = probeEnv(db);
  const allocations: PublicIngressBindings[] = [];
  for (const requestId of requestIds) {
    for (const tenantId of tenants) {
      const services = freezeServices({ db, env, requestId, tenantId });
      let bindings: unknown;
      try { bindings = wrapped.createRequestScope(services); }
      catch (error) {
        if (error instanceof PublicIngressDeclarationError) throw error;
        refuse('factory_probe_failed', `createRequestScope a échoué sur l’échantillon ${tenantId}/${requestId}.`);
      }
      allocations.push(inspectBindings(bindings, `${tenantId}/${requestId}`));
    }
  }
  for (let i = 0; i < allocations.length; i++) {
    for (let j = i + 1; j < allocations.length; j++) {
      if (allocations[i] === allocations[j]) refuse('singleton_factory', 'createRequestScope ne peut pas renvoyer le même objet pour deux tenantId ou deux requestId.');
    }
  }
  const sample = allocations[0]!;
  if (hasSigned) {
    if (!bindingHas(sample, 'verify')) refuse('signed_verify_required', 'verify est obligatoire dès qu’une entrée signed est déclarée.');
    if (!bindingHas(sample, 'claimStore')) refuse('signed_claim_store_required', 'claimStore est obligatoire dès qu’une entrée signed est déclarée.');
  }
  if (hasGuest && !bindingHas(sample, 'admitGuest')) refuse('guest_admit_required', 'admitGuest est obligatoire dès qu’une entrée guest est déclarée.');
  if (!hasSigned && sample.claimStore) refuse('guest_claim_store_forbidden', 'claimStore est interdit lorsqu’aucune entrée signed n’existe.');
  assertSampleCapabilities(sample, requiredByKind, 'factory');
  return Object.freeze({
    declaration: target,
    probe: Object.freeze({
      sampledAllocations: allocations.length,
      provesEveryCall: false as const,
      reason: 'factory_sample_is_not_universal' as const,
      tenantsProbed: Object.freeze([...tenants]),
      requestIdsProbed: Object.freeze([...requestIds]),
      crossTenantProbe: tenants.length > 1 ? 'compared' as const : 'not_applicable_single_tenant' as const,
      operationsCatalog: 'checked' as const,
      inboundMail: 'reserved' as const,
      vaultPort: requiredByKind.includes('vault') ? 'runtime_kit_port' as const : 'not_required' as const,
      circularityGuards,
    }),
  });
  } finally {
    try {
      target.resolveTenant = originalResolve;
      target.createRequestScope = originalFactory;
    } catch { /* déclaration en lecture seule : sonde de circularité non réinstallée */ }
  }
}

function response(status: number, body: unknown, code?: string, replayed?: true): PublicIngressAdmitResult {
  return replayed ? { kind: 'response', status, body, ...(code ? { code } : {}), replayed } : { kind: 'response', status, body, ...(code ? { code } : {}) };
}

function failClosed(code: string, status = 503, message?: string): PublicIngressAdmitResult {
  return response(status, { error: { code, message: message ?? code } }, code);
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

function sanitizeSnapshot(snapshot: SanitizedSnapshot): SanitizedSnapshot | undefined {
  if (!snapshot || (snapshot.ok !== true && snapshot.ok !== false)) return undefined;
  if (snapshot.ok && !SUCCESS_STATUSES.has(snapshot.status)) return undefined;
  if (!snapshot.ok && !SNAPSHOT_FAIL_STATUSES.has(snapshot.status)) return undefined;
  const body = sanitizeValue(snapshot.body, 0);
  if (body === undefined && snapshot.body !== undefined && snapshot.body !== null) return undefined;
  return snapshot.ok ? { ok: true, status: snapshot.status, body } : { ok: false, status: snapshot.status, body };
}

async function digestOf(bytes: Uint8Array): Promise<Uint8Array> {
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', owned.buffer as ArrayBuffer));
}

function claimFence(value: ClaimFence | undefined): ClaimFence | undefined {
  if (!value || !value.key || typeof value.token !== 'string' || !value.token || typeof value.generation !== 'number' || !Number.isInteger(value.generation)) return undefined;
  if (typeof value.key.tenantId !== 'string' || typeof value.key.entryId !== 'string' || typeof value.key.eventId !== 'string') return undefined;
  return value;
}

function runtimeBindings(entry: PublicIngressEntry, bindings: PublicIngressBindings, kit: PublicIngressKitPorts): string | undefined {
  if (typeof bindings.handle !== 'function') return 'binding_unavailable';
  for (const key of FORBIDDEN_BINDING_KEYS) {
    if (hasOwn(bindings, key) && (bindings as Record<string, unknown>)[key] !== undefined) return 'identity_forbidden';
  }
  const required = requiredCapabilities(entry);
  for (const capability of required) {
    if (capability === 'vault') {
      if (!kit.vault || typeof kit.vault.ready !== 'function' || typeof kit.vault.decrypt !== 'function') return 'vault_unavailable';
      continue;
    }
    if (!bindingHas(bindings, capability)) {
      if (capability === 'verify') return 'verify_unavailable';
      if (capability === 'claimStore') return 'claim_store_unavailable';
      if (capability === 'admitGuest') return 'admit_guest_unavailable';
      if (capability === 'limiter') return 'limiter_unavailable';
      return 'binding_unavailable';
    }
  }
  return undefined;
}

async function readyOrUnavailable(probe: CapabilityProbe | undefined, code: string): Promise<string | undefined> {
  if (!probe) return code;
  try { if (probe.ready() !== true) return code; }
  catch { return code; }
  return undefined;
}

export async function admitPublicIngress(
  declaration: PublicIngressDeclaration,
  input: PublicIngressInput,
  kit: PublicIngressKitPorts,
): Promise<PublicIngressAdmitResult> {
  const matched = matchEntry(declaration.entries, input.method, input.path);
  if (!matched) return { kind: 'unmatched' };
  const { entry, params } = matched;
  const headers = headersOf(input.headers);
  const rawBytes = input.rawBytes;
  if (!(rawBytes instanceof Uint8Array)) return failClosed('payload_too_large', 413);
  const declared = header(headers, 'content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > entry.maxBytes)) return failClosed('payload_too_large', 413);
  if (rawBytes.byteLength > entry.maxBytes) return failClosed('payload_too_large', 413);
  if (entry.method === 'POST' && !contentTypeAllowed(header(headers, 'content-type'), entry.contentTypes)) {
    return failClosed('unsupported_media_type', 415);
  }
  const guarded = wrapTenantFactory(declaration);
  let tenantId: string;
  try { tenantId = guarded.resolveTenant(entry); }
  catch (error) {
    if (error instanceof PublicIngressDeclarationError && error.code === 'circular_tenant_factory') return failClosed('tenant_mismatch');
    return failClosed('tenant_unavailable');
  }
  if (tenantId !== entry.tenantId || !isPublicTenantId(tenantId)) return failClosed('tenant_mismatch');
  const services = freezeServices({
    db: kit.db,
    env: kit.env,
    requestId: input.requestId,
    tenantId,
  });
  let bindings: PublicIngressBindings;
  try {
    bindings = inspectBindings(guarded.createRequestScope(services), input.requestId);
  } catch (error) {
    if (error instanceof PublicIngressDeclarationError && error.code === 'identity_forbidden') return failClosed('identity_forbidden');
    if (error instanceof PublicIngressDeclarationError && error.code === 'circular_tenant_factory') return failClosed('factory_unavailable');
    return failClosed('factory_unavailable');
  }
  const missing = runtimeBindings(entry, bindings, kit);
  if (missing) return failClosed(missing);
  let secret: string | undefined;
  if (entry.vaultRef || entry.abuse.requires.includes('vault')) {
    const vault = kit.vault;
    const vaultDown = await readyOrUnavailable(vault, 'vault_unavailable');
    if (vaultDown || !vault || !entry.vaultRef) return failClosed('vault_unavailable');
    try {
      secret = await vault.decrypt({
        tenantId,
        integrationId: entry.vaultRef.integrationId,
        aad: `${tenantId}:${entry.vaultRef.integrationId}`,
      });
    } catch { return failClosed('vault_unavailable'); }
    if (typeof secret !== 'string' || !secret) return failClosed('vault_unavailable');
  }
  if (entry.abuse.requires.includes('limiter') || requiredCapabilities(entry).includes('limiter')) {
    const limiterDown = await readyOrUnavailable(bindings.limiter, 'limiter_unavailable');
    if (limiterDown) return failClosed(limiterDown);
    if (typeof bindings.limiter?.admit === 'function') {
      try {
        if (await bindings.limiter.admit() !== 'ok') return failClosed('limiter_unavailable');
      } catch { return failClosed('limiter_unavailable'); }
    }
  }
  let proof: SignedProof | GuestAdmission;
  if (entry.admission === 'signed') {
    let verified: { ok: true; eventId: string } | { ok: false };
    try {
      verified = await bindings.verify!({
        entry,
        tenantCandidate: tenantId,
        rawBytes,
        headers,
        nowMs: input.nowMs,
        ...(secret !== undefined ? { secret } : {}),
      });
    } catch { return failClosed('verify_unavailable'); }
    if (!verified || verified.ok !== true || typeof verified.eventId !== 'string' || !verified.eventId || verified.eventId.length > publicIngressLimits.eventIdMaxLength) {
      return failClosed('invalid_proof', 403);
    }
    proof = { kind: 'signed', eventId: verified.eventId, payloadDigest: await digestOf(rawBytes) };
  } else {
    let admitted: { ok: true; admission: GuestAdmission } | { ok: false };
    try {
      admitted = await bindings.admitGuest!({
        entry,
        tenantId,
        params,
        meta: boundedMeta(headers, input.query),
        rawBytes,
      });
    } catch { return failClosed('admit_guest_unavailable'); }
    if (!admitted || admitted.ok !== true || !admitted.admission || admitted.admission.kind !== 'guest') {
      return failClosed('guest_denied', 403);
    }
    const view = admitted.admission.view;
    if (view && sanitizeValue(view, 0) === undefined) return failClosed('guest_denied', 403);
    proof = admitted.admission;
  }
  const ctx: PublicAdmissionContext = Object.freeze({
    kind: 'public',
    entryId: entry.id,
    proof,
    tenantId,
    requestId: input.requestId,
    rawBytes,
    params,
  });
  if (entry.admission === 'guest') return finishHandle(entry, bindings, ctx, undefined);
  const store = bindings.claimStore!;
  const key: ClaimKey = { tenantId, entryId: entry.id, eventId: (proof as SignedProof).eventId };
  let claimed: ClaimOutcome;
  try { claimed = await store.claim(key, (proof as SignedProof).payloadDigest); }
  catch { return failClosed('claim_store_unavailable'); }
  if (claimed.kind === 'busy') return failClosed('busy');
  if (claimed.kind === 'digest_collision') return failClosed('digest_collision', 409);
  if (claimed.kind === 'attempts_exhausted') return failClosed('attempts_exhausted');
  if (claimed.kind === 'permanent_failure') {
    const snapshot = claimed.snapshot ? sanitizeSnapshot(claimed.snapshot) : undefined;
    if (snapshot && snapshot.ok === false) return response(snapshot.status, snapshot.body);
    return failClosed('permanent_failure', 422);
  }
  if (claimed.kind === 'completed') {
    const snapshot = sanitizeSnapshot(claimed.snapshot);
    if (!snapshot || snapshot.ok !== true) return failClosed('snapshot_invalid');
    return { kind: 'response', status: snapshot.status, body: snapshot.body, replayed: true };
  }
  if (claimed.kind !== 'acquired') return failClosed('claim_store_unavailable');
  const fence = claimFence(claimed.fence);
  if (!fence || fence.key.tenantId !== tenantId || fence.key.entryId !== entry.id || fence.key.eventId !== key.eventId) {
    return failClosed('fencing_failed');
  }
  return finishHandle(entry, bindings, ctx, fence);
}

async function finishHandle(
  entry: PublicIngressEntry,
  bindings: PublicIngressBindings,
  ctx: PublicAdmissionContext,
  fence: ClaimFence | undefined,
): Promise<PublicIngressAdmitResult> {
  const signed = entry.admission === 'signed';
  const store = bindings.claimStore;
  let winner: { type: 'handle'; result: HandleResult } | { type: 'timeout' } | { type: 'throw' } | undefined;
  const running = Promise.resolve().then(() => bindings.handle(ctx)).then(
    result => { if (!winner) winner = { type: 'handle', result }; },
    () => { if (!winner) winner = { type: 'throw' }; },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timed = new Promise<void>(resolve => {
    timer = setTimeout(() => { if (!winner) winner = { type: 'timeout' }; resolve(); }, entry.timeoutMs);
  });
  await Promise.race([running, timed]);
  if (timer) clearTimeout(timer);
  if (winner?.type === 'timeout') {
    if (signed && fence && store) { try { await store.retry(fence); } catch { /* fence laissé processing ; pas de 2xx */ } }
    return failClosed('timeout');
  }
  if (winner?.type !== 'handle') {
    if (signed && fence && store) { try { await store.retry(fence); } catch { /* idem */ } }
    return failClosed(signed ? 'handle_unavailable' : 'handle_unavailable');
  }
  const result = winner.result;
  if (!result || (result.outcome !== 'success' && result.outcome !== 'retry' && result.outcome !== 'permanent')) {
    if (signed && fence && store) { try { await store.retry(fence); } catch { /* idem */ } }
    return failClosed('handle_unavailable');
  }
  if (result.outcome === 'retry') {
    if (signed && fence && store) { try { await store.retry(fence); } catch { return failClosed('claim_store_unavailable'); } }
    return failClosed('retry');
  }
  if (result.outcome === 'permanent') {
    if (!PERMANENT_STATUSES.has(result.status)) return failClosed('handle_unavailable');
    const snapshot = sanitizeSnapshot({ ok: false, status: result.status, body: result.body });
    if (!snapshot || snapshot.ok !== false) return failClosed('snapshot_invalid');
    if (signed && fence && store) {
      try { await store.failPermanent(fence, snapshot); }
      catch { return failClosed('claim_store_unavailable'); }
    }
    return response(snapshot.status, snapshot.body);
  }
  if (!SUCCESS_STATUSES.has(result.status)) return failClosed('handle_unavailable');
  const snapshot = sanitizeSnapshot({ ok: true, status: result.status, body: result.body });
  if (!snapshot || snapshot.ok !== true) {
    if (signed && fence && store) { try { await store.failPermanent(fence, { ok: false, status: 422, body: { error: { code: 'snapshot_invalid' } } }); } catch { /* pas de 2xx */ } }
    return failClosed('snapshot_invalid', 422);
  }
  if (signed) {
    if (!fence || !store) return failClosed('claim_store_unavailable');
    let persisted: boolean;
    try { persisted = await store.complete(fence, snapshot); }
    catch { return failClosed('claim_store_unavailable'); }
    if (persisted !== true) return failClosed('fencing_failed');
  }
  return response(snapshot.status, snapshot.body);
}

export function createPublicIngressAdmission(
  declaration: PublicIngressDeclaration,
  kit: PublicIngressKitPorts,
  options: PublicIngressValidationOptions,
) {
  const validation = validatePublicIngressDeclaration(declaration, options);
  return {
    validation,
    admit(input: PublicIngressInput) {
      return admitPublicIngress(validation.declaration, input, kit);
    },
  };
}
