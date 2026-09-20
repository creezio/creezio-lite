import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { app } from './helpers.mjs';
import { coreOperations, operationAllowed } from '../runtime/core/operations.ts';
import { sessionCredential, tokenCredential, oauthCredential } from '../runtime/core/scope.ts';
import { loadSchemas, validateSchema } from '../.cursor/skills/lite-orchestration/scripts/plan-missions.mjs';
import {
  AccessDeclarationError,
  evaluateAccessDecision,
  validateAccessDeclaration,
  workspaceAdminOperationIds,
  workspaceAdminProfileOperationIds,
  NATIVE_ROLE_GROUP,
} from '../runtime/core/access-profiles-engine.ts';

const ENGINE_SOURCE = readFileSync(new URL('../runtime/core/access-profiles-engine.ts', import.meta.url), 'utf8');
const WS = 'fx_ws_a';
const WS_OTHER = 'fx_ws_b';
const GROUP = 'fx_group_sales';
const GROUP_ROLE = 'role:owner';
const PROFILE_READ = 'fx_reader';
const PROFILE_WRITE = 'fx_editor';
const CAP_READ = 'fx_clients_read';
const CAP_WRITE = 'fx_clients_write';
const CAP_FILES = 'fx_files';

const catalog = [
  ...coreOperations(app).map(op => Object.freeze({
    id: op.id, roles: op.roles, method: op.method, moduleId: op.moduleId, tokenAllowed: op.tokenAllowed,
    ...(op.essential ? { essential: true } : {}),
  })),
];
const byId = Object.fromEntries(catalog.map(entry => [entry.id, entry]));
const entryOf = id => { const entry = byId[id]; assert.ok(entry, `catalogue kit sans ${id}`); return entry; };

const principal = (role, over = {}) => ({ userId: 'fx_alice', role, workspaceId: WS, credential: 'session', ...over });
const snapshot = (state, over = {}) => ({
  state, catalogRevision: state === 'legacy' ? null : 'fx_rev_1', receiptRevision: state === 'adopted' ? 'fx_rev_1' : null,
  observedProfileIds: state === 'adopted' ? [PROFILE_READ] : [], ...over,
});
const declaration = (over = {}) => ({
  catalogRevision: 'fx_rev_1',
  capabilities: [
    { id: CAP_READ, operations: ['module.clients.list', 'module.clients.get'] },
    { id: CAP_WRITE, operations: ['module.clients.create', 'module.clients.update'] },
    { id: CAP_FILES, operations: ['files.list', 'files.get'] },
  ],
  profiles: [
    { id: PROFILE_READ, revision: 1, capabilities: [CAP_READ, CAP_FILES], receivableBy: ['owner', 'admin', 'member', 'viewer'], assignableBy: ['owner', 'admin'], assignmentApproval: 'owner' },
    { id: PROFILE_WRITE, revision: 2, capabilities: [CAP_WRITE], receivableBy: ['owner', 'admin', 'member'], assignableBy: ['owner'], assignmentApproval: 'owner' },
  ],
  ...over,
});
const receipt = (over = {}) => ({
  catalogRevision: 'fx_rev_1',
  bindings: [{ groupId: GROUP, profileId: PROFILE_READ, profileRevision: 1 }],
  ...over,
});
const input = (over = {}) => ({
  snapshot: snapshot('adopted'),
  declaration: declaration(),
  receipt: receipt(),
  principal: principal('member'),
  credential: sessionCredential,
  denials: [],
  catalog,
  query: { kind: 'operation', operationId: 'module.clients.list' },
  ...over,
});

function decide(over) {
  return evaluateAccessDecision(input(over));
}

test('engine is a pure helper: no scope, DB or access route import', () => {
  assert.equal(/from '\.\/scope\.ts'/.test(ENGINE_SOURCE), false);
  assert.equal(/from '\.\/access\.ts'/.test(ENGINE_SOURCE), false);
  assert.equal(/from '\.\/access-tokens\.ts'/.test(ENGINE_SOURCE), false);
  assert.equal(/\b(prepare|D1Database|recordFilter|fileFilter|recordScope|fileScope)\b/.test(ENGINE_SOURCE), false);
  assert.match(ENGINE_SOURCE, /import type \{ CredentialContext, Principal, Role \} from '\.\/types\.ts'/);
});

test('public plan.json matches the planning schema exactly', async () => {
  const schemas = await loadSchemas();
  const plan = JSON.parse(readFileSync(new URL('../docs/planning/plan.json', import.meta.url), 'utf8'));
  const errors = [];
  assert.equal(validateSchema(schemas.plan, plan, schemas.plan, '', errors), true, JSON.stringify(errors, null, 2));
  assert.equal(plan.plan.id, 'kit-native-runtimes');
  assert.equal(plan.missions[0].id, 'ACCESS-ENGINE');
  assert.deepEqual(plan.missions[0].reserves.paths, [
    'runtime/core/access-profiles-engine.ts',
    'tests/access-profiles-engine.test.mjs',
    'docs/planning/plan.json',
  ]);
});

test('validateAccessDeclaration freezes a legal declaration against the kit catalog', () => {
  const value = validateAccessDeclaration(declaration(), catalog);
  assert.equal(value.catalogRevision, 'fx_rev_1');
  assert.equal(Object.isFrozen(value), true);
  assert.equal(value.profiles[0].assignmentApproval, 'owner');
});

test('validateAccessDeclaration refuses empty lists, duplicates, module:/essential ops and role ceilings', () => {
  const throws = (mutate, code) => {
    const body = declaration();
    mutate(body);
    assert.throws(() => validateAccessDeclaration(body, catalog), error => error instanceof AccessDeclarationError && error.code === code);
  };
  throws(body => { body.profiles = []; }, 'empty_list');
  throws(body => { body.capabilities = []; }, 'empty_list');
  throws(body => { body.catalogRevision = ''; }, 'empty_revision');
  throws(body => { body.catalogRevision = '  '; }, 'empty_revision');
  throws(body => { body.groupId = GROUP; }, 'group_in_declaration');
  throws(body => { body.profiles[0].assignableBy = []; }, 'empty_assignable');
  throws(body => { body.profiles[0].receivableBy = []; }, 'empty_receivable');
  throws(body => { body.profiles[0].assignmentApproval = 'workspace-rule'; }, 'invalid_approval');
  throws(body => { body.capabilities.push({ id: CAP_READ, operations: ['search.query'] }); }, 'duplicate_id');
  throws(body => { body.profiles.push({ ...body.profiles[0] }); }, 'duplicate_id');
  throws(body => { body.capabilities[0].operations = ['module.clients.list', 'module.clients.list']; }, 'empty_list');
  throws(body => { body.capabilities[0].operations = ['module:clients']; }, 'module_operation');
  throws(body => { body.capabilities[0].operations = ['modules.list']; }, 'essential_operation');
  throws(body => { body.capabilities[0].operations = ['session.me']; }, 'essential_operation');
  throws(body => { body.capabilities[0].operations = ['analytics.ingest']; }, 'essential_operation');
  throws(body => { body.capabilities.push({ id: 'fx_missing_op', operations: ['fx.unknown.op'] }); }, 'unknown_operation');
  throws(body => { body.profiles[0].capabilities = ['fx_absent']; }, 'unknown_capability');
  throws(body => { body.profiles[0].id = 'role:member'; }, 'role_group');
  throws(body => {
    body.capabilities.push({ id: 'fx_admin_only', operations: ['access.catalog'] });
    body.profiles[0].capabilities = ['fx_admin_only'];
    body.profiles[0].receivableBy = ['member'];
  }, 'role_ceiling');
});

test('legacy decisions match operationAllowed on real kit operations (owner deny bypass, essential, allow inert)', () => {
  const ops = ['module.clients.list', 'module.clients.create', 'files.list', 'access.catalog', 'modules.list', 'session.me', 'core.health', 'analytics.ingest', 'search.query'];
  const roles = ['owner', 'admin', 'member', 'viewer'];
  const denialSets = [
    [],
    [{ operationId: 'module.clients.list', effect: 'deny' }],
    [{ operationId: 'module:clients', effect: 'deny' }],
    [{ operationId: 'module.clients.create', effect: 'deny' }],
    [{ operationId: 'module.clients.list', effect: 'allow' }],
  ];
  for (const role of roles) for (const operationId of ops) for (const denials of denialSets) {
    const op = entryOf(operationId);
    const org = { id: WS, name: 'fx', role, operationPolicies: denials.filter(item => item.effect === 'deny') };
    const expected = operationAllowed({ ...op, essential: op.essential }, org);
    const got = evaluateAccessDecision({
      snapshot: snapshot('legacy'),
      declaration: null,
      receipt: null,
      principal: principal(role),
      credential: sessionCredential,
      denials,
      catalog,
      query: { kind: 'operation', operationId },
    });
    assert.equal(got.allowed, expected, `${role} ${operationId} denials=${JSON.stringify(denials)}`);
    if (expected) assert.equal(got.reason, 'allowed');
    else assert.equal(['denied_role', 'denied_policy'].includes(got.reason), true, got.reason);
  }
});

test('negative rights table: adopted, incomplete and legacy stay fail-closed', () => {
  const rows = [
    {
      name: 'T1 adopted binding + role in receivableBy',
      over: {},
      allowed: true, reason: 'allowed', capabilityIds: [CAP_READ],
    },
    {
      name: 'T2 observedProfileIds is not a grant for an unbound op',
      over: { query: { kind: 'operation', operationId: 'module.clients.create' } },
      allowed: false, reason: 'denied_unbound',
    },
    {
      name: 'T3 adopted deny wins including owner',
      over: { principal: principal('owner'), denials: [{ operationId: 'module.clients.list', effect: 'deny' }] },
      allowed: false, reason: 'denied_policy',
    },
    {
      name: 'T3 legacy owner still bypasses deny',
      over: {
        snapshot: snapshot('legacy'), declaration: null, receipt: null,
        principal: principal('owner'), denials: [{ operationId: 'module.clients.list', effect: 'deny' }],
      },
      allowed: true, reason: 'allowed',
    },
    {
      name: 'T3 legacy member is denied',
      over: {
        snapshot: snapshot('legacy'), declaration: null, receipt: null,
        principal: principal('member'), denials: [{ operationId: 'module.clients.list', effect: 'deny' }],
      },
      allowed: false, reason: 'denied_policy',
    },
    {
      name: 'T11 access present, receipt absent is incomplete default-deny',
      over: { snapshot: snapshot('incomplete', { receiptRevision: null, observedProfileIds: [] }), receipt: null },
      allowed: false, reason: 'denied_incomplete',
    },
    {
      name: 'T12 revision mismatch is incomplete, never legacy',
      over: {
        snapshot: snapshot('incomplete', { catalogRevision: 'fx_rev_1', receiptRevision: 'fx_old', observedProfileIds: [] }),
        receipt: receipt({ catalogRevision: 'fx_old' }),
      },
      allowed: false, reason: 'denied_incomplete',
    },
    {
      name: 'T13 first receipt with empty bindings default-denies (7)',
      over: { snapshot: snapshot('adopted', { observedProfileIds: [] }), receipt: receipt({ bindings: [] }) },
      allowed: false, reason: 'denied_unbound',
    },
    {
      name: 'allow effect is inert and never grants',
      over: {
        snapshot: snapshot('adopted', { observedProfileIds: [] }),
        receipt: receipt({ bindings: [] }),
        denials: [{ operationId: 'module.clients.list', effect: 'allow' }],
      },
      allowed: false, reason: 'denied_unbound',
    },
    {
      name: 'T16 live binding with stale profileRevision',
      over: { receipt: receipt({ bindings: [{ groupId: GROUP, profileId: PROFILE_READ, profileRevision: 9 }] }) },
      allowed: false, reason: 'denied_revision',
    },
    {
      name: 'T8 unknown operation',
      over: { query: { kind: 'operation', operationId: 'fx.unknown.op' } },
      allowed: false, reason: 'denied_unknown',
    },
    {
      name: 'unknown capability query',
      over: { query: { kind: 'capability', capabilityId: 'fx_absent' } },
      allowed: false, reason: 'denied_unknown',
    },
    {
      name: 'viewer outside write roles',
      over: {
        snapshot: snapshot('adopted', { observedProfileIds: [PROFILE_WRITE] }),
        receipt: receipt({ bindings: [{ groupId: GROUP, profileId: PROFILE_WRITE, profileRevision: 2 }] }),
        principal: principal('viewer'),
        query: { kind: 'operation', operationId: 'module.clients.create' },
      },
      allowed: false, reason: 'denied_role',
    },
    {
      name: 'T18 adopted owner without profile cannot list clients',
      over: { snapshot: snapshot('adopted', { observedProfileIds: [] }), receipt: receipt({ bindings: [] }), principal: principal('owner') },
      allowed: false, reason: 'denied_unbound',
    },
    {
      name: 'T18 adopted owner without profile cannot list modules (discovery)',
      over: {
        snapshot: snapshot('adopted', { observedProfileIds: [] }), receipt: receipt({ bindings: [] }),
        principal: principal('owner'), query: { kind: 'operation', operationId: 'modules.list' },
      },
      allowed: false, reason: 'denied_unbound',
    },
    {
      name: 'T18 adopted owner without profile cannot search',
      over: {
        snapshot: snapshot('adopted', { observedProfileIds: [] }), receipt: receipt({ bindings: [] }),
        principal: principal('owner'), query: { kind: 'operation', operationId: 'search.query' },
      },
      allowed: false, reason: 'denied_unbound',
    },
    {
      name: 'T17 owner can still call workspace admin ops without a profile',
      over: {
        snapshot: snapshot('adopted', { observedProfileIds: [] }), receipt: receipt({ bindings: [] }),
        principal: principal('owner'), query: { kind: 'operation', operationId: 'access.catalog' },
      },
      allowed: true, reason: 'allowed',
    },
    {
      name: 'incomplete recovery still allows access.receipt.update for owner',
      over: {
        snapshot: snapshot('incomplete', { observedProfileIds: [] }), receipt: null, principal: principal('owner'),
        query: { kind: 'operation', operationId: 'access.receipt.update' },
      },
      allowed: true, reason: 'allowed',
    },
    {
      name: 'session envelope remains callable without a profile after adoption',
      over: {
        snapshot: snapshot('adopted', { observedProfileIds: [] }), receipt: receipt({ bindings: [] }),
        principal: principal('member'), query: { kind: 'operation', operationId: 'session.me' },
      },
      allowed: true, reason: 'allowed',
    },
    {
      name: 'analytics ingest remains callable without an app capability after adoption',
      over: {
        snapshot: snapshot('adopted', { observedProfileIds: [] }), receipt: receipt({ bindings: [] }),
        principal: principal('member'), query: { kind: 'operation', operationId: 'analytics.ingest' },
        denials: [{ operationId: 'module:observability', effect: 'deny' }],
      },
      allowed: true, reason: 'allowed',
    },
    {
      name: 'analytics admin reads remain outside the transport envelope',
      over: {
        snapshot: snapshot('adopted', { observedProfileIds: [] }), receipt: receipt({ bindings: [] }),
        principal: principal('member'), query: { kind: 'operation', operationId: 'analytics.overview' },
      },
      allowed: false, reason: 'denied_role',
    },
    {
      name: 'legacy snapshot with a declaration present never falls back to permissive legacy',
      over: { snapshot: snapshot('legacy', { catalogRevision: null, receiptRevision: null, observedProfileIds: [] }) },
      allowed: false, reason: 'denied_conflict',
    },
    {
      name: 'adopted snapshot without declaration is not legacy',
      over: { snapshot: snapshot('adopted'), declaration: null, receipt: null },
      allowed: false, reason: 'denied_conflict',
    },
  ];
  for (const row of rows) {
    const got = decide(row.over);
    assert.equal(got.allowed, row.allowed, row.name);
    assert.equal(got.reason, row.reason, `${row.name} reason=${got.reason}`);
    if (row.capabilityIds) assert.deepEqual([...got.capabilityIds], row.capabilityIds, row.name);
    if (got.allowed) assert.equal(got.reason, 'allowed');
    else assert.notEqual(got.reason, 'allowed');
  }
});

test('multiple profiles: only the still-bound profile grants, deny stays global', () => {
  const both = [
    { groupId: GROUP, profileId: PROFILE_READ, profileRevision: 1 },
    { groupId: 'fx_group_editors', profileId: PROFILE_WRITE, profileRevision: 2 },
  ];
  const adoptedBoth = {
    snapshot: snapshot('adopted', { observedProfileIds: [PROFILE_READ, PROFILE_WRITE] }),
    receipt: receipt({ bindings: both }),
    principal: principal('member'),
  };
  const list = decide({ ...adoptedBoth, query: { kind: 'operation', operationId: 'module.clients.list' } });
  assert.equal(list.allowed, true);
  assert.deepEqual([...list.capabilityIds], [CAP_READ]);
  const create = decide({ ...adoptedBoth, query: { kind: 'operation', operationId: 'module.clients.create' } });
  assert.equal(create.allowed, true);
  assert.deepEqual([...create.capabilityIds], [CAP_WRITE]);

  const readOnly = decide({
    snapshot: snapshot('adopted', { observedProfileIds: [PROFILE_READ] }),
    receipt: receipt({ bindings: [{ groupId: GROUP, profileId: PROFILE_READ, profileRevision: 1 }] }),
    query: { kind: 'operation', operationId: 'module.clients.create' },
  });
  assert.equal(readOnly.allowed, false);
  assert.equal(readOnly.reason, 'denied_unbound');

  const denied = decide({
    ...adoptedBoth,
    denials: [{ operationId: 'module.clients.list', effect: 'deny' }],
  });
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, 'denied_policy');
});

test('module deny is applied by the helper on catalog.moduleId, including for owner, and is not a grant', () => {
  const moduleDeny = [{ operationId: 'module:clients', effect: 'deny' }];
  const adopted = decide({ denials: moduleDeny, principal: principal('owner') });
  assert.equal(adopted.allowed, false);
  assert.equal(adopted.reason, 'denied_policy');
  const files = decide({ denials: moduleDeny, query: { kind: 'operation', operationId: 'files.list' } });
  assert.equal(files.allowed, true);
  const legacyMember = decide({
    snapshot: snapshot('legacy'), declaration: null, receipt: null,
    principal: principal('member'), denials: moduleDeny,
  });
  assert.equal(legacyMember.allowed, false);
  const legacyOwner = decide({
    snapshot: snapshot('legacy'), declaration: null, receipt: null,
    principal: principal('owner'), denials: moduleDeny,
  });
  assert.equal(legacyOwner.allowed, true);
  const grantAttempt = decide({
    snapshot: snapshot('adopted', { observedProfileIds: [] }),
    receipt: receipt({ bindings: [] }),
    denials: [{ operationId: 'module:clients', effect: 'allow' }],
    principal: principal('owner'),
  });
  assert.equal(grantAttempt.allowed, false);
  assert.equal(grantAttempt.reason, 'denied_unbound');
});

test('read credential cannot write; tokenAllowed false is denied_credential; session is unaffected', () => {
  const readToken = tokenCredential({ tokenId: 'fx_token_read', workspaceId: WS, mode: 'read' });
  const writeToken = tokenCredential({ tokenId: 'fx_token_write', workspaceId: WS, mode: 'write' });
  const readOauth = oauthCredential({ tokenId: 'fx_oauth', grantId: 'fx_grant', clientId: 'fx_client', workspaceId: WS, mode: 'read' });
  const analyticsToken = decide({
    principal: principal('member', { credential: 'token' }),
    credential: writeToken,
    query: { kind: 'operation', operationId: 'analytics.ingest' },
    snapshot: snapshot('adopted', { observedProfileIds: [] }),
    receipt: receipt({ bindings: [] }),
  });
  assert.equal(analyticsToken.allowed, false);
  assert.equal(analyticsToken.reason, 'denied_credential');
  const writeList = decide({
    principal: principal('member', { credential: 'token' }),
    credential: readToken,
    query: { kind: 'operation', operationId: 'module.clients.create' },
    snapshot: snapshot('adopted', { observedProfileIds: [PROFILE_WRITE] }),
    receipt: receipt({ bindings: [{ groupId: GROUP, profileId: PROFILE_WRITE, profileRevision: 2 }] }),
  });
  assert.equal(writeList.allowed, false);
  assert.equal(writeList.reason, 'denied_credential');
  const readList = decide({
    principal: principal('member', { credential: 'token' }),
    credential: readToken,
  });
  assert.equal(readList.allowed, true);
  const oauthWrite = decide({
    principal: principal('member', { credential: 'oauth' }),
    credential: readOauth,
    query: { kind: 'operation', operationId: 'module.clients.create' },
    snapshot: snapshot('adopted', { observedProfileIds: [PROFILE_WRITE] }),
    receipt: receipt({ bindings: [{ groupId: GROUP, profileId: PROFILE_WRITE, profileRevision: 2 }] }),
  });
  assert.equal(oauthWrite.allowed, false);
  assert.equal(oauthWrite.reason, 'denied_credential');
  const adminToken = decide({
    principal: principal('owner', { credential: 'token' }),
    credential: writeToken,
    query: { kind: 'operation', operationId: 'access.catalog' },
  });
  assert.equal(adminToken.allowed, false);
  assert.equal(adminToken.reason, 'denied_credential');
  const sessionAdmin = decide({
    principal: principal('owner'),
    credential: sessionCredential,
    query: { kind: 'operation', operationId: 'access.catalog' },
  });
  assert.equal(sessionAdmin.allowed, true);
  const incompleteReadWrite = decide({
    snapshot: snapshot('incomplete', { observedProfileIds: [] }),
    receipt: null,
    principal: principal('member', { credential: 'token' }),
    credential: readToken,
    query: { kind: 'operation', operationId: 'module.clients.create' },
  });
  assert.equal(incompleteReadWrite.reason, 'denied_credential');
});

test('capability query requires every operation to pass deny, credential and binding', () => {
  const ok = decide({ query: { kind: 'capability', capabilityId: CAP_READ } });
  assert.equal(ok.allowed, true);
  assert.deepEqual([...ok.capabilityIds], [CAP_READ]);
  const moduleDeny = decide({
    query: { kind: 'capability', capabilityId: CAP_READ },
    denials: [{ operationId: 'module:clients', effect: 'deny' }],
  });
  assert.equal(moduleDeny.allowed, false);
  assert.equal(moduleDeny.reason, 'denied_policy');
  const writeCap = decide({
    query: { kind: 'capability', capabilityId: CAP_WRITE },
    snapshot: snapshot('adopted', { observedProfileIds: [PROFILE_WRITE] }),
    receipt: receipt({ bindings: [{ groupId: GROUP, profileId: PROFILE_WRITE, profileRevision: 2 }] }),
    principal: principal('member', { credential: 'token' }),
    credential: tokenCredential({ tokenId: 'fx_token_read', workspaceId: WS, mode: 'read' }),
  });
  assert.equal(writeCap.allowed, false);
  assert.equal(writeCap.reason, 'denied_credential');
  const incomplete = decide({
    snapshot: snapshot('incomplete', { observedProfileIds: [] }),
    receipt: null,
    query: { kind: 'capability', capabilityId: CAP_READ },
  });
  assert.equal(incomplete.allowed, false);
  assert.equal(incomplete.reason, 'denied_incomplete');
  const legacyCap = decide({
    snapshot: snapshot('legacy'), declaration: null, receipt: null,
    query: { kind: 'capability', capabilityId: CAP_READ },
  });
  assert.equal(legacyCap.allowed, false);
  assert.equal(legacyCap.reason, 'denied_unknown');
});

test('capability query must not borrow grants from another capability that shares operations', () => {
  entryOf('module.clients.create'); entryOf('module.clients.update'); entryOf('dashboard.get');
  const shared = declaration({
    capabilities: [
      { id: 'product.write', operations: ['module.clients.create', 'module.clients.update'] },
      { id: 'price.edit', operations: ['module.clients.create', 'module.clients.update'] },
      { id: 'read', operations: ['dashboard.get'] },
      { id: 'stock.read', operations: ['dashboard.get'] },
    ],
    profiles: [
      {
        id: 'fx_product_writer', revision: 1,
        capabilities: ['product.write', 'read'],
        receivableBy: ['owner', 'admin', 'member'], assignableBy: ['owner', 'admin'], assignmentApproval: 'owner',
      },
      {
        id: 'fx_price_editor', revision: 4,
        capabilities: ['price.edit', 'stock.read'],
        receivableBy: ['owner', 'admin', 'member'], assignableBy: ['owner'], assignmentApproval: 'owner',
      },
    ],
  });
  const boundWriter = {
    snapshot: snapshot('adopted', { observedProfileIds: ['fx_product_writer'] }),
    declaration: shared,
    receipt: receipt({ bindings: [{ groupId: GROUP, profileId: 'fx_product_writer', profileRevision: 1 }] }),
    principal: principal('member'),
  };
  const productWrite = decide({ ...boundWriter, query: { kind: 'capability', capabilityId: 'product.write' } });
  const priceEdit = decide({ ...boundWriter, query: { kind: 'capability', capabilityId: 'price.edit' } });
  const dashRead = decide({ ...boundWriter, query: { kind: 'capability', capabilityId: 'read' } });
  const stockRead = decide({ ...boundWriter, query: { kind: 'capability', capabilityId: 'stock.read' } });
  const createOp = decide({ ...boundWriter, query: { kind: 'operation', operationId: 'module.clients.create' } });
  assert.equal(productWrite.allowed, true, 'bound product.write must pass');
  assert.deepEqual([...productWrite.capabilityIds], ['product.write']);
  assert.equal(dashRead.allowed, true, 'bound read must pass');
  assert.equal(createOp.allowed, true, 'operation query may use the bound product.write');
  assert.equal(priceEdit.allowed, false, `price.edit must not borrow product.write (got ${priceEdit.reason})`);
  assert.equal(priceEdit.reason, 'denied_unbound');
  assert.equal(stockRead.allowed, false, `stock.read must not borrow read (got ${stockRead.reason})`);
  assert.equal(stockRead.reason, 'denied_unbound');

  const observedOnly = decide({
    ...boundWriter,
    snapshot: snapshot('adopted', { observedProfileIds: ['fx_product_writer', 'fx_price_editor'] }),
    query: { kind: 'capability', capabilityId: 'price.edit' },
  });
  assert.equal(observedOnly.allowed, false);
  assert.equal(observedOnly.reason, 'denied_unbound');

  const stale = decide({
    snapshot: snapshot('adopted', { observedProfileIds: ['fx_price_editor'] }),
    declaration: shared,
    receipt: receipt({ bindings: [{ groupId: GROUP, profileId: 'fx_price_editor', profileRevision: 1 }] }),
    principal: principal('member'),
    query: { kind: 'capability', capabilityId: 'price.edit' },
  });
  assert.equal(stale.allowed, false);
  assert.equal(stale.reason, 'denied_revision');

  const notReceivable = declaration({
    capabilities: shared.capabilities,
    profiles: [{
      id: 'fx_product_writer', revision: 1,
      capabilities: ['product.write', 'price.edit'],
      receivableBy: ['owner'], assignableBy: ['owner'], assignmentApproval: 'owner',
    }],
  });
  const memberBlocked = decide({
    snapshot: snapshot('adopted', { observedProfileIds: ['fx_product_writer'] }),
    declaration: notReceivable,
    receipt: receipt({ bindings: [{ groupId: GROUP, profileId: 'fx_product_writer', profileRevision: 1 }] }),
    principal: principal('member'),
    query: { kind: 'capability', capabilityId: 'price.edit' },
  });
  assert.equal(memberBlocked.allowed, false);
  assert.equal(memberBlocked.reason, 'denied_unbound');

  const denyWins = decide({
    ...boundWriter,
    denials: [{ operationId: 'module.clients.create', effect: 'deny' }],
    query: { kind: 'capability', capabilityId: 'price.edit' },
  });
  assert.equal(denyWins.allowed, false);
  assert.equal(denyWins.reason, 'denied_policy');

  const ownerBare = decide({
    snapshot: snapshot('adopted', { observedProfileIds: [] }),
    declaration: shared,
    receipt: receipt({ bindings: [] }),
    principal: principal('owner'),
    query: { kind: 'capability', capabilityId: 'product.write' },
  });
  assert.equal(ownerBare.allowed, false);
  assert.equal(ownerBare.reason, 'denied_unbound');
});

test('role:* bindings never become a profile; native role groups stay skipped', () => {
  assert.equal(NATIVE_ROLE_GROUP.test(GROUP_ROLE), true);
  assert.equal(NATIVE_ROLE_GROUP.test(GROUP), false);
  const got = decide({
    snapshot: snapshot('adopted', { observedProfileIds: [PROFILE_READ] }),
    receipt: receipt({ bindings: [{ groupId: GROUP_ROLE, profileId: PROFILE_READ, profileRevision: 1 }] }),
  });
  assert.equal(got.allowed, false);
  assert.equal(got.reason, 'denied_unbound');
});

test('owner cannot escalate data access: no profile, module deny, files and dashboard stay closed', () => {
  const bareOwner = { snapshot: snapshot('adopted', { observedProfileIds: [] }), receipt: receipt({ bindings: [] }), principal: principal('owner') };
  for (const operationId of ['module.clients.list', 'module.clients.create', 'files.list', 'files.upload', 'search.query', 'dashboard.get', 'mail.list']) {
    const got = decide({ ...bareOwner, query: { kind: 'operation', operationId } });
    assert.equal(got.allowed, false, operationId);
    assert.equal(got.reason, 'denied_unbound', operationId);
  }
  const deniedOwner = decide({
    principal: principal('owner'),
    denials: [{ operationId: 'files.list', effect: 'deny' }],
    query: { kind: 'operation', operationId: 'files.list' },
  });
  assert.equal(deniedOwner.allowed, false);
  assert.equal(deniedOwner.reason, 'denied_policy');
  for (const operationId of workspaceAdminOperationIds) {
    const op = byId[operationId];
    if (!op || !op.roles.includes('owner')) continue;
    const got = decide({ ...bareOwner, query: { kind: 'operation', operationId } });
    assert.equal(got.allowed, true, operationId);
  }
});

test('malformed snapshot, receipt, principal, catalog, query and denials fail closed without throwing', () => {
  const garbage = [
    null, undefined, 1, 'fx', [], { snapshot: null },
    input({ snapshot: { state: 'nope', catalogRevision: null, receiptRevision: null, observedProfileIds: [] } }),
    input({ principal: { ...principal('member'), role: 'superadmin' } }),
    input({ principal: { ...principal('member'), userId: '' } }),
    input({ credential: { kind: 'token', tokenId: 'fx', workspaceId: WS, mode: 'admin' } }),
    input({ catalog: [{ id: 'module.clients.list' }] }),
    input({ catalog: [...catalog, catalog[0]] }),
    input({ denials: { operationId: 'module.clients.list', effect: 'deny' } }),
    input({ denials: [{ operationId: 'module.clients.list', effect: 'maybe' }] }),
    input({ query: { kind: 'operation' } }),
    input({ query: { kind: 'row', operationId: 'module.clients.list' } }),
    input({ receipt: { catalogRevision: 'fx_rev_1', bindings: [{ groupId: GROUP, profileId: PROFILE_READ, profileRevision: '1' }] } }),
    input({ receipt: { catalogRevision: 'fx_rev_1', validUntil: 'not-a-date', bindings: [] } }),
    input({ declaration: { ...declaration(), profiles: [{ ...declaration().profiles[0], revision: 1.5 }] } }),
  ];
  for (const value of garbage) {
    const got = evaluateAccessDecision(value);
    assert.equal(got.allowed, false);
    assert.notEqual(got.reason, 'allowed');
    assert.equal(Array.isArray(got.capabilityIds), true);
  }
});

test('cross-workspace: helper verifies credential.workspaceId; snapshot/receipt have no org_id in the contract', () => {
  const keys = Object.keys(snapshot('adopted'));
  assert.equal(keys.includes('workspaceId') || keys.includes('org_id'), false);
  assert.equal(Object.keys(receipt()).includes('workspaceId'), false);
  const mismatch = decide({
    principal: principal('member', { credential: 'token' }),
    credential: tokenCredential({ tokenId: 'fx_token', workspaceId: WS_OTHER, mode: 'write' }),
  });
  assert.equal(mismatch.allowed, false);
  assert.equal(mismatch.reason, 'denied_conflict');
  const kindMismatch = decide({
    principal: principal('member', { credential: 'session' }),
    credential: tokenCredential({ tokenId: 'fx_token', workspaceId: WS, mode: 'write' }),
  });
  assert.equal(kindMismatch.allowed, false);
  assert.equal(kindMismatch.reason, 'denied_conflict');
  const aligned = decide({
    principal: principal('member', { credential: 'token', workspaceId: WS }),
    credential: tokenCredential({ tokenId: 'fx_token', workspaceId: WS, mode: 'read' }),
  });
  assert.equal(aligned.allowed, true);
});

test('kernel-marked incomplete despite matching revisions stays default-deny (validUntil / now lives outside the helper)', () => {
  const got = decide({
    snapshot: snapshot('incomplete', { catalogRevision: 'fx_rev_1', receiptRevision: 'fx_rev_1', observedProfileIds: [PROFILE_READ] }),
    receipt: receipt({ validUntil: '2020-01-01T00:00:00Z' }),
  });
  assert.equal(got.allowed, false);
  assert.equal(got.reason, 'denied_incomplete');
});

test('workspaceAdminOperationIds lists the contract recovery and admin ops', () => {
  for (const id of ['access.receipt.update', 'access.bind', 'access.unbind', 'access.catalog', 'members.update']) {
    assert.equal(workspaceAdminOperationIds.includes(id), true, id);
  }
  for (const id of workspaceAdminProfileOperationIds) {
    assert.equal(workspaceAdminOperationIds.includes(id), false, `${id} must remain denyable`);
  }
});
