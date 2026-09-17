import type { CredentialContext, Principal, Role } from './types.ts';
import { roles as nativeRoles } from './validation.ts';

/** Native role groups exposed in the access UI; they are never a business profile. */
export const NATIVE_ROLE_GROUP = /^(role:)/;
const READ_METHODS = new Set(['GET', 'HEAD']);
const ROLE_SET = new Set<string>(nativeRoles);
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|([+-])(\d{2}):(\d{2}))$/;

export type AccessProfileId = string;
export type AccessCapabilityId = string;
export type AccessCapability = {
  id: AccessCapabilityId;
  label?: string;
  operations: readonly string[];
};
export type AccessProfile = {
  id: AccessProfileId;
  label?: string;
  revision: number;
  capabilities: readonly AccessCapabilityId[];
  receivableBy: readonly Role[];
  assignableBy: readonly Role[];
  assignmentApproval: 'owner';
};
export type GroupProfileBinding = {
  groupId: string;
  profileId: AccessProfileId;
  profileRevision: number;
};
export type AccessAdoptionReceipt = {
  catalogRevision: string;
  bindings: readonly GroupProfileBinding[];
  validUntil?: string;
};
export type AccessDeclaration = {
  catalogRevision: string;
  profiles: readonly AccessProfile[];
  capabilities: readonly AccessCapability[];
};
export type AccessAdoptionState = 'legacy' | 'incomplete' | 'adopted';
export type AccessDecisionReason =
  | 'allowed'
  | 'denied_incomplete'
  | 'denied_policy'
  | 'denied_role'
  | 'denied_credential'
  | 'denied_unbound'
  | 'denied_revision'
  | 'denied_unknown'
  | 'denied_delegation'
  | 'denied_conflict';
export type AccessQuery =
  | { kind: 'operation'; operationId: string }
  | { kind: 'capability'; capabilityId: AccessCapabilityId };
export type AccessDecision = Readonly<{
  allowed: boolean;
  reason: AccessDecisionReason;
  operationId?: string;
  capabilityIds: readonly AccessCapabilityId[];
}>;
export type AccessSnapshot = Readonly<{
  state: AccessAdoptionState;
  catalogRevision: string | null;
  receiptRevision: string | null;
  observedProfileIds: readonly AccessProfileId[];
}>;
export type DelegationMutation =
  | { kind: 'bind' | 'unbind'; groupId: string; profileId: AccessProfileId; profileRevision?: number }
  | { kind: 'groupMembers'; groupId: string; userIds: readonly string[] }
  | { kind: 'memberRole'; userId: string; role: Role }
  | { kind: 'memberRemove'; userId: string }
  | { kind: 'groupDelete'; groupId: string }
  | { kind: 'inviteCreate'; role: Role }
  | { kind: 'adopt' | 'rebind'; receipt: AccessAdoptionReceipt };
export type AccessCatalogEntry = Readonly<{
  id: string;
  roles: Role[];
  essential?: boolean;
  method: string;
  moduleId: string;
  tokenAllowed: boolean;
}>;
export type AccessDenial = Readonly<{ operationId: string; effect: 'deny' }>;
export type EvaluateAccessInput = Readonly<{
  snapshot: AccessSnapshot;
  declaration: AccessDeclaration | null;
  receipt: AccessAdoptionReceipt | null;
  principal: Principal;
  credential: CredentialContext;
  denials: readonly AccessDenial[];
  catalog: readonly AccessCatalogEntry[];
  query: AccessQuery;
}>;
export type ScopeAccessContext = Readonly<{
  snapshot: AccessSnapshot;
  evaluateAccess: (query: AccessQuery) => AccessDecision;
}>;

export const workspaceAdminOperationIds = [
  'workspaces.update',
  'members.list', 'members.get', 'members.update', 'members.remove',
  'invites.list', 'invites.create', 'invites.revoke',
  'audit.list', 'audit.get',
  'access.catalog', 'access.groups.create', 'access.groups.update',
  'access.groups.delete', 'access.policies.update',
  'access.receipt.update', 'access.bind', 'access.unbind',
  'tokens.list', 'tokens.create', 'tokens.revoke',
  'mcp.status', 'mcp.tools', 'mcp.clients', 'mcp.diagnostics', 'mcp.metrics',
  'mcp.clients.revoke', 'mcp.diagnostics.export', 'mcp.policies.update',
  'mcp.tools.create', 'mcp.tools.delete',
] as const;

const ADMIN_OPS = new Set<string>(workspaceAdminOperationIds);

export class AccessDeclarationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'AccessDeclarationError';
    this.code = code;
  }
}

const plain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const asString = (value: unknown): string | null => typeof value === 'string' && value.trim() && value === value.trim() ? value : null;
const asRoleList = (value: unknown): Role[] | null => {
  if (!Array.isArray(value) || !value.length) return null;
  const roles: Role[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || !ROLE_SET.has(item) || seen.has(item)) return null;
    seen.add(item);
    roles.push(item as Role);
  }
  return roles;
};
const uniqueStrings = (value: unknown): string[] | null => {
  if (!Array.isArray(value) || !value.length) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = asString(item);
    if (!text || seen.has(text)) return null;
    seen.add(text);
    out.push(text);
  }
  return out;
};

function validInstant(text: string): boolean {
  const match = RFC3339.exec(text);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  return match[7] === undefined || (Number(match[8]) <= 23 && Number(match[9]) <= 59);
}

function indexCatalog(catalog: unknown): Map<string, AccessCatalogEntry> | null {
  if (!Array.isArray(catalog)) return null;
  const map = new Map<string, AccessCatalogEntry>();
  for (const item of catalog) {
    if (!plain(item)) return null;
    const id = asString(item.id);
    const moduleId = asString(item.moduleId);
    const method = asString(item.method);
    const roles = asRoleList(item.roles);
    if (!id || !moduleId || !method || !roles || typeof item.tokenAllowed !== 'boolean') return null;
    if (item.essential !== undefined && typeof item.essential !== 'boolean') return null;
    if (map.has(id)) return null;
    map.set(id, Object.freeze({
      id, moduleId, method, roles: Object.freeze([...roles]) as Role[],
      tokenAllowed: item.tokenAllowed,
      ...(item.essential ? { essential: true } : {}),
    }));
  }
  return map;
}

type InspectOk = { ok: true; value: AccessDeclaration };
type InspectErr = { ok: false; code: string; message: string };
function inspectDeclaration(declaration: unknown, catalog: Map<string, AccessCatalogEntry>): InspectOk | InspectErr {
  const fail = (code: string, message: string): InspectErr => ({ ok: false, code, message });
  if (!plain(declaration)) return fail('invalid_shape', 'AccessDeclaration invalide.');
  if (Object.hasOwn(declaration, 'groupId') || Object.hasOwn(declaration, 'bindings')) {
    return fail('group_in_declaration', 'AccessDeclaration ne porte pas de groupId ni de liaisons.');
  }
  const catalogRevision = asString(declaration.catalogRevision);
  if (!catalogRevision) return fail('empty_revision', 'catalogRevision est obligatoire.');
  if (!Array.isArray(declaration.capabilities) || !declaration.capabilities.length) {
    return fail('empty_list', 'La liste des capacités ne peut pas être vide.');
  }
  if (!Array.isArray(declaration.profiles) || !declaration.profiles.length) {
    return fail('empty_list', 'La liste des profils ne peut pas être vide.');
  }
  const capabilities: AccessCapability[] = [];
  const capabilityIds = new Set<string>();
  for (const raw of declaration.capabilities) {
    if (!plain(raw)) return fail('invalid_shape', 'Capacité invalide.');
    const id = asString(raw.id);
    if (!id) return fail('invalid_shape', 'Identifiant de capacité invalide.');
    if (capabilityIds.has(id)) return fail('duplicate_id', `Capacité dupliquée : ${id}.`);
    capabilityIds.add(id);
    const operations = uniqueStrings(raw.operations);
    if (!operations) return fail('empty_list', `Opérations vides ou dupliquées pour ${id}.`);
    for (const operationId of operations) {
      if (operationId.startsWith('module:')) return fail('module_operation', `Une capacité ne cite pas module: (${operationId}).`);
      const entry = catalog.get(operationId);
      if (!entry) return fail('unknown_operation', `Opération inconnue dans la capacité ${id} : ${operationId}.`);
      if (entry.essential) return fail('essential_operation', `Une capacité ne peut pas citer une opération indispensable : ${operationId}.`);
    }
    if (raw.label !== undefined && typeof raw.label !== 'string') return fail('invalid_shape', `Libellé invalide pour ${id}.`);
    capabilities.push(Object.freeze({
      id, operations: Object.freeze([...operations]),
      ...(typeof raw.label === 'string' ? { label: raw.label } : {}),
    }));
  }
  const profiles: AccessProfile[] = [];
  const profileIds = new Set<string>();
  for (const raw of declaration.profiles) {
    if (!plain(raw)) return fail('invalid_shape', 'Profil invalide.');
    if (Object.hasOwn(raw, 'groupId')) return fail('group_in_declaration', 'Un profil ne porte pas de groupId.');
    const id = asString(raw.id);
    if (!id) return fail('invalid_shape', 'Identifiant de profil invalide.');
    if (NATIVE_ROLE_GROUP.test(id)) return fail('role_group', `Un profil n’est pas un groupe rôle : ${id}.`);
    if (profileIds.has(id)) return fail('duplicate_id', `Profil dupliqué : ${id}.`);
    profileIds.add(id);
    if (!Number.isInteger(raw.revision)) return fail('invalid_revision', `Révision invalide pour ${id}.`);
    if (raw.assignmentApproval !== 'owner') return fail('invalid_approval', `assignmentApproval v1 est owner pour ${id}.`);
    const receivableBy = asRoleList(raw.receivableBy);
    const assignableBy = asRoleList(raw.assignableBy);
    if (!receivableBy) return fail('empty_receivable', `receivableBy vide ou invalide pour ${id}.`);
    if (!assignableBy) return fail('empty_assignable', `assignableBy vide ou invalide pour ${id}.`);
    const cited = uniqueStrings(raw.capabilities);
    if (!cited) return fail('empty_list', `Capacités vides ou dupliquées pour ${id}.`);
    const ops: AccessCatalogEntry[] = [];
    for (const capabilityId of cited) {
      const capability = capabilities.find(item => item.id === capabilityId);
      if (!capability) return fail('unknown_capability', `Capacité inconnue sur ${id} : ${capabilityId}.`);
      for (const operationId of capability.operations) ops.push(catalog.get(operationId)!);
    }
    for (const role of receivableBy) {
      for (const entry of ops) {
        if (!entry.roles.includes(role)) {
          return fail('role_ceiling', `receivableBy ${role} dépasse le plafond de ${entry.id}.`);
        }
      }
    }
    if (raw.label !== undefined && typeof raw.label !== 'string') return fail('invalid_shape', `Libellé invalide pour ${id}.`);
    profiles.push(Object.freeze({
      id, revision: raw.revision as number,
      capabilities: Object.freeze([...cited]),
      receivableBy: Object.freeze([...receivableBy]) as readonly Role[],
      assignableBy: Object.freeze([...assignableBy]) as readonly Role[],
      assignmentApproval: 'owner',
      ...(typeof raw.label === 'string' ? { label: raw.label } : {}),
    }));
  }
  return { ok: true, value: Object.freeze({ catalogRevision, profiles: Object.freeze(profiles), capabilities: Object.freeze(capabilities) }) };
}

export function validateAccessDeclaration(declaration: unknown, catalog: readonly AccessCatalogEntry[]): AccessDeclaration {
  const index = indexCatalog(catalog);
  if (!index) throw new AccessDeclarationError('invalid_catalog', 'Catalogue d’accès invalide ou dupliqué.');
  const inspected = inspectDeclaration(declaration, index);
  if (!inspected.ok) throw new AccessDeclarationError(inspected.code, inspected.message);
  return inspected.value;
}

function decision(
  allowed: boolean,
  reason: AccessDecisionReason,
  extra: { operationId?: string; capabilityIds?: readonly AccessCapabilityId[] } = {},
): AccessDecision {
  return Object.freeze({
    allowed,
    reason,
    ...(extra.operationId !== undefined ? { operationId: extra.operationId } : {}),
    capabilityIds: Object.freeze([...(extra.capabilityIds ?? [])]),
  });
}

function deny(reason: AccessDecisionReason, extra?: { operationId?: string; capabilityIds?: readonly AccessCapabilityId[] }): AccessDecision {
  return decision(false, reason, extra);
}

function readDenials(value: unknown): AccessDenial[] | null {
  if (!Array.isArray(value)) return null;
  const out: AccessDenial[] = [];
  for (const item of value) {
    if (!plain(item) || typeof item.operationId !== 'string' || !item.operationId) return null;
    if (item.effect === 'allow' || item.effect === 'inherit') continue;
    if (item.effect !== 'deny') return null;
    out.push(Object.freeze({ operationId: item.operationId, effect: 'deny' as const }));
  }
  return out;
}

function readSnapshot(value: unknown): AccessSnapshot | null {
  if (!plain(value)) return null;
  if (value.state !== 'legacy' && value.state !== 'incomplete' && value.state !== 'adopted') return null;
  if (value.catalogRevision !== null && typeof value.catalogRevision !== 'string') return null;
  if (value.receiptRevision !== null && typeof value.receiptRevision !== 'string') return null;
  if (!Array.isArray(value.observedProfileIds) || value.observedProfileIds.some(id => typeof id !== 'string')) return null;
  return Object.freeze({
    state: value.state,
    catalogRevision: value.catalogRevision as string | null,
    receiptRevision: value.receiptRevision as string | null,
    observedProfileIds: Object.freeze([...value.observedProfileIds as string[]]),
  });
}

function readPrincipal(value: unknown): Principal | null {
  if (!plain(value)) return null;
  const userId = asString(value.userId);
  const workspaceId = asString(value.workspaceId);
  if (!userId || !workspaceId || typeof value.role !== 'string' || !ROLE_SET.has(value.role)) return null;
  if (value.credential !== 'session' && value.credential !== 'token' && value.credential !== 'oauth') return null;
  return { userId, workspaceId, role: value.role as Role, credential: value.credential };
}

function readCredential(value: unknown): CredentialContext | null {
  if (!plain(value) || typeof value.kind !== 'string') return null;
  if (value.kind === 'session') return Object.freeze({ kind: 'session' as const });
  const workspaceId = asString(value.workspaceId);
  const tokenId = asString(value.tokenId);
  if ((value.kind === 'token' || value.kind === 'oauth') && (!workspaceId || !tokenId)) return null;
  if (value.mode !== 'read' && value.mode !== 'write') return null;
  if (value.kind === 'token') return Object.freeze({ kind: 'token' as const, tokenId: tokenId!, workspaceId: workspaceId!, mode: value.mode });
  if (value.kind === 'oauth') {
    const grantId = asString(value.grantId);
    const clientId = asString(value.clientId);
    if (!grantId || !clientId) return null;
    return Object.freeze({ kind: 'oauth' as const, tokenId: tokenId!, grantId, clientId, workspaceId: workspaceId!, mode: value.mode });
  }
  return null;
}

function readReceipt(value: unknown): AccessAdoptionReceipt | null | 'invalid' {
  if (value === null) return null;
  if (!plain(value)) return 'invalid';
  const catalogRevision = asString(value.catalogRevision);
  if (!catalogRevision) return 'invalid';
  if (value.validUntil !== undefined && (typeof value.validUntil !== 'string' || !validInstant(value.validUntil))) return 'invalid';
  if (!Array.isArray(value.bindings)) return 'invalid';
  const bindings: GroupProfileBinding[] = [];
  const pairs = new Set<string>();
  for (const raw of value.bindings) {
    if (!plain(raw)) return 'invalid';
    const groupId = asString(raw.groupId);
    const profileId = asString(raw.profileId);
    if (!groupId || !profileId || !Number.isInteger(raw.profileRevision)) return 'invalid';
    const key = `${groupId}\0${profileId}`;
    if (pairs.has(key)) return 'invalid';
    pairs.add(key);
    bindings.push(Object.freeze({ groupId, profileId, profileRevision: raw.profileRevision as number }));
  }
  return Object.freeze({
    catalogRevision,
    bindings: Object.freeze(bindings),
    ...(typeof value.validUntil === 'string' ? { validUntil: value.validUntil } : {}),
  });
}

function readQuery(value: unknown): AccessQuery | null {
  if (!plain(value) || typeof value.kind !== 'string') return null;
  if (value.kind === 'operation') {
    const operationId = asString(value.operationId);
    return operationId ? { kind: 'operation', operationId } : null;
  }
  if (value.kind === 'capability') {
    const capabilityId = asString(value.capabilityId);
    return capabilityId ? { kind: 'capability', capabilityId } : null;
  }
  return null;
}

/** session / health / mcp.tools.* transport. Discovery content (modules.list, OpenAPI, …) is not an envelope. */
function isTransportEnvelope(entry: AccessCatalogEntry): boolean {
  if (entry.essential !== true) return false;
  if (entry.id === 'core.health') return true;
  if (entry.id === 'mcp.tools.available' || entry.id === 'mcp.tools.call') return true;
  return entry.moduleId === 'session';
}

function deniedByPolicy(entry: AccessCatalogEntry, denials: readonly AccessDenial[]): boolean {
  return denials.some(item => item.operationId === entry.id || item.operationId === `module:${entry.moduleId}`);
}

function deniedByCredential(entry: AccessCatalogEntry, credential: CredentialContext): boolean {
  if (credential.kind === 'session') return false;
  if (!entry.tokenAllowed) return true;
  return credential.mode === 'read' && !READ_METHODS.has(entry.method);
}

/** Observable legacy: op.roles, then essential or owner, then deny only. allow is inert. */
function legacyOperationAllowed(entry: AccessCatalogEntry, role: Role, denials: readonly AccessDenial[]): boolean {
  if (!entry.roles.includes(role)) return false;
  if (entry.essential || role === 'owner') return true;
  return !deniedByPolicy(entry, denials);
}

type BindingScan = {
  profiles: AccessProfile[];
  capabilityIds: AccessCapabilityId[];
  revisionMismatch: boolean;
  unknownProfile: boolean;
};

function scanBindings(
  declaration: AccessDeclaration,
  receipt: AccessAdoptionReceipt,
  observedProfileIds: readonly string[],
): BindingScan {
  const observed = new Set(observedProfileIds);
  const profiles: AccessProfile[] = [];
  const capabilityIds: AccessCapabilityId[] = [];
  const seen = new Set<string>();
  let revisionMismatch = false;
  let unknownProfile = false;
  for (const binding of receipt.bindings) {
    if (NATIVE_ROLE_GROUP.test(binding.groupId)) continue;
    if (!observed.has(binding.profileId)) continue;
    const profile = declaration.profiles.find(item => item.id === binding.profileId);
    if (!profile) { unknownProfile = true; continue; }
    if (binding.profileRevision !== profile.revision) { revisionMismatch = true; continue; }
    if (seen.has(profile.id)) continue;
    seen.add(profile.id);
    profiles.push(profile);
    for (const capabilityId of profile.capabilities) {
      if (!capabilityIds.includes(capabilityId)) capabilityIds.push(capabilityId);
    }
  }
  return { profiles, capabilityIds, revisionMismatch, unknownProfile };
}

function grantsOperation(profiles: readonly AccessProfile[], declaration: AccessDeclaration, operationId: string, role: Role): AccessCapabilityId[] {
  const granted: AccessCapabilityId[] = [];
  for (const profile of profiles) {
    if (!profile.receivableBy.includes(role)) continue;
    for (const capabilityId of profile.capabilities) {
      const capability = declaration.capabilities.find(item => item.id === capabilityId);
      if (!capability) continue;
      if (capability.operations.includes(operationId) && !granted.includes(capabilityId)) granted.push(capabilityId);
    }
  }
  return granted;
}

type ResolvedState = 'legacy' | 'incomplete' | 'adopted' | 'conflict';

function resolveState(
  snapshot: AccessSnapshot,
  declaration: AccessDeclaration | null,
  receipt: AccessAdoptionReceipt | null,
): ResolvedState {
  if (!declaration) {
    if (receipt) return 'conflict';
    return snapshot.state === 'legacy' ? 'legacy' : 'conflict';
  }
  if (snapshot.state === 'legacy') return 'conflict';
  const revisionsAlign =
    !!receipt
    && receipt.catalogRevision === declaration.catalogRevision
    && snapshot.catalogRevision === declaration.catalogRevision
    && snapshot.receiptRevision === receipt.catalogRevision;
  if (!revisionsAlign) return 'incomplete';
  if (snapshot.state === 'incomplete') return 'incomplete';
  return snapshot.state === 'adopted' ? 'adopted' : 'incomplete';
}

function evaluateOperation(
  operationId: string,
  input: {
    state: ResolvedState;
    declaration: AccessDeclaration | null;
    receipt: AccessAdoptionReceipt | null;
    principal: Principal;
    credential: CredentialContext;
    denials: readonly AccessDenial[];
    catalog: Map<string, AccessCatalogEntry>;
    observedProfileIds: readonly string[];
  },
  options?: { skipBinding?: boolean },
): AccessDecision {
  const extra = { operationId };
  const entry = input.catalog.get(operationId);
  if (!entry) return deny('denied_unknown', extra);
  if (deniedByCredential(entry, input.credential)) return deny('denied_credential', extra);
  if (input.state === 'legacy') {
    if (!legacyOperationAllowed(entry, input.principal.role, input.denials)) {
      return deny(entry.roles.includes(input.principal.role) ? 'denied_policy' : 'denied_role', extra);
    }
    return decision(true, 'allowed', extra);
  }
  if (!entry.roles.includes(input.principal.role)) return deny('denied_role', extra);
  const envelope = isTransportEnvelope(entry);
  const admin = ADMIN_OPS.has(entry.id);
  if (!envelope && !admin && deniedByPolicy(entry, input.denials)) return deny('denied_policy', extra);
  if (envelope || admin) return decision(true, 'allowed', extra);
  if (input.state === 'incomplete' || !input.declaration || !input.receipt) return deny('denied_incomplete', extra);
  if (options?.skipBinding) return decision(true, 'allowed', extra);

  const scan = scanBindings(input.declaration, input.receipt, input.observedProfileIds);
  const granted = grantsOperation(scan.profiles, input.declaration, operationId, input.principal.role);
  if (granted.length) return decision(true, 'allowed', { operationId, capabilityIds: granted });
  if (scan.revisionMismatch) return deny('denied_revision', extra);
  if (scan.unknownProfile) return deny('denied_unknown', extra);
  return deny('denied_unbound', extra);
}

export function evaluateAccessDecision(input: EvaluateAccessInput): AccessDecision {
  if (!plain(input)) return deny('denied_unknown');
  const snapshot = readSnapshot(input.snapshot);
  const principal = readPrincipal(input.principal);
  const credential = readCredential(input.credential);
  const denials = readDenials(input.denials);
  const catalog = indexCatalog(input.catalog);
  const query = readQuery(input.query);
  if (!snapshot || !principal || !credential || !denials || !catalog || !query) return deny('denied_unknown');
  if (principal.credential !== credential.kind) return deny('denied_conflict');
  if (credential.kind !== 'session' && credential.workspaceId !== principal.workspaceId) return deny('denied_conflict');

  let declaration: AccessDeclaration | null = null;
  if (input.declaration !== null && input.declaration !== undefined) {
    const inspected = inspectDeclaration(input.declaration, catalog);
    if (!inspected.ok) return deny('denied_unknown');
    declaration = inspected.value;
  }
  const receipt = readReceipt(input.receipt);
  if (receipt === 'invalid') return deny('denied_unknown');

  const state = resolveState(snapshot, declaration, receipt);
  if (state === 'conflict') return deny('denied_conflict');

  const ctx = {
    state, declaration, receipt, principal, credential, denials, catalog,
    observedProfileIds: snapshot.observedProfileIds,
  };

  if (query.kind === 'operation') return evaluateOperation(query.operationId, ctx);

  if (state === 'legacy') return deny('denied_unknown', { capabilityIds: [query.capabilityId] });
  if (!declaration) return deny('denied_incomplete', { capabilityIds: [query.capabilityId] });
  const capability = declaration.capabilities.find(item => item.id === query.capabilityId);
  if (!capability) return deny('denied_unknown', { capabilityIds: [query.capabilityId] });
  if (state === 'incomplete' || !receipt) return deny('denied_incomplete', { capabilityIds: [query.capabilityId] });

  const scan = scanBindings(declaration, receipt, snapshot.observedProfileIds);
  const bound = scan.profiles.some(profile => profile.receivableBy.includes(principal.role) && profile.capabilities.includes(query.capabilityId));
  const reasons: AccessDecisionReason[] = [];
  if (!bound) reasons.push(scan.revisionMismatch ? 'denied_revision' : scan.unknownProfile ? 'denied_unknown' : 'denied_unbound');
  for (const operationId of capability.operations) {
    const result = evaluateOperation(operationId, ctx, { skipBinding: true });
    if (!result.allowed) reasons.push(result.reason);
  }
  if (!reasons.length) return decision(true, 'allowed', { capabilityIds: [query.capabilityId] });
  const priority: AccessDecisionReason[] = ['denied_policy', 'denied_credential', 'denied_role', 'denied_incomplete', 'denied_revision', 'denied_unknown', 'denied_unbound', 'denied_conflict', 'denied_delegation'];
  const reason = priority.find(item => reasons.includes(item)) ?? reasons[0];
  return deny(reason, { capabilityIds: [query.capabilityId] });
}
