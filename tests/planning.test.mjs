import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { evaluate, loadSchemas, main, exitCodes, pathsCollide, validateSchema, validInstant, UsageError } from '../.cursor/skills/lite-orchestration/scripts/plan-missions.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const skillDir = join(root, '.cursor/skills/lite-orchestration');
const script = join(skillDir, 'scripts/plan-missions.mjs');
const examplePlan = join(skillDir, 'examples/planning-plan.json');
const exampleState = join(skillDir, 'examples/planning-state.json');
const schemas = await loadSchemas();
const T = '2026-09-16T18:40:00Z';
const SHA = (c) => c.repeat(40);
const SELECTION = { key: 'fable', modelId: 'claude-fable-5-1', params: [{ id: 'thinking', value: 'true' }, { id: 'context', value: '300k' }, { id: 'effort', value: 'high' }], chosenAt: '2026-09-15T10:00:00Z' };
const OTHER_SELECTION = { key: 'grok', modelId: 'grok-4.6', params: [{ id: 'effort', value: 'medium' }, { id: 'fast', value: 'false' }], chosenAt: '2026-09-15T11:00:00Z' };

// Fixtures génériques : aucune mission réelle, identifiants d’agent et de run substitués (jamais des UUID).
const mission = (id, extra = {}) => ({ id, lot: 'lot-a', kind: 'dev', repo: 'kit', title: `Mission ${id}`, source: 'docs/missions/test.md', deliverable: `Livrable ${id}`, criteria: ['Critère vérifiable'], owner: 'kit-maintainer', priority: 5, dependencies: {}, reserves: {}, ...extra });
const plan = (missions, extra = {}) => ({ formatVersion: 1, plan: { id: 'test-plan', title: 'Plan de test générique', revision: 'r1' }, repos: { kit: { url: 'https://github.com/example/kit', defaultBase: 'main' }, app: { url: 'https://github.com/example/app' } }, resources: { 'kit:version': 'Version cohérente des manifestes', 'db:schema': 'Schéma' }, conditions: { 'ci-green': { check: 'CI verte', proof: 'URL du run' }, 'contract-accepted': { check: 'Contrat accepté', proof: 'URL de réception' } }, missions, ...extra });
const state = (missions = {}, extra = {}) => ({ formatVersion: 1, plan: { id: 'test-plan', revision: 'r1' }, reconciledAt: T, capacity: { scope: 'test-plan', maxActiveRuns: 3, origin: 'configured', source: 'Plafond local décidé par l’orchestrateur pour test-plan', observedAt: T, maxReviewBacklog: 3 }, pauses: [], conditions: {}, missions, ...extra });
const engaged = (id, status, extra = {}) => {
  const base = { status, selection: SELECTION, branch: `agents/${id}`, base: SHA('1'), agentId: `bc-test-${id.toLowerCase()}`, runId: `run-test-${id.toLowerCase()}-1`, runStatus: 'FINISHED', launch: 'launched', followups: 0, assignedAt: '2026-09-15T10:05:00Z' };
  if (status === 'active') Object.assign(base, { runStatus: 'RUNNING' });
  if (['delivered', 'integrated', 'published'].includes(status)) Object.assign(base, { prUrl: `https://github.com/example/kit/pull/${id.length + 10}`, headSha: SHA('2'), deliveredAt: '2026-09-16T12:00:00Z' });
  if (['integrated', 'published'].includes(status)) Object.assign(base, { integratedAt: '2026-09-16T13:00:00Z' });
  if (status === 'published') Object.assign(base, { publishedAt: '2026-09-16T14:00:00Z' });
  if (status === 'closed') Object.assign(base, { deliveredAt: '2026-09-16T12:00:00Z', closedAt: '2026-09-16T13:00:00Z' });
  return { ...base, ...extra };
};
const ready = (p, s) => evaluate('ready', { plan: p, state: s, schemas });
const validate = (p, s) => evaluate('validate', { plan: p, state: s, schemas });
const codes = (report) => report.errors.map(e => e.code);
const proposedSteps = (report) => report.proposals.map(p => `${p.mission}:${p.step}`);
function assertEveryNonProposalExplained(report) {
  for (const [id, entry] of Object.entries(report.missions)) {
    if (['waiting', 'blocked', 'active', 'unknown'].includes(entry.outcome)) assert.ok(entry.reasons.length > 0, `${id} (${entry.outcome}) sans raison`);
    if (entry.outcome === 'proposed') assert.ok(report.proposals.some(p => p.mission === id || (p.covers ?? []).includes(id)), `${id} proposé sans proposition`);
    if (entry.outcome === 'blocked') assert.ok(report.blocked.some(b => b.mission === id && b.reasons.length > 0));
    if (['waiting', 'proposed'].includes(entry.outcome)) assert.ok(report.ready.some(r => r.mission === id && r.step === entry.step), `${id} devrait figurer dans ready`);
  }
}
async function withTemp(run) { const temp = await mkdtemp(join(tmpdir(), 'planning-')); try { return await run(temp); } finally { await rm(temp, { recursive: true, force: true }); } }
const cli = (...args) => { const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH } }); return { code: result.status, stdout: result.stdout, stderr: result.stderr }; };

test('the two contract examples validate and ready reproduces the business oracle of PLANNING.md §5', async () => {
  const p = JSON.parse(await readFile(examplePlan, 'utf8')), s = JSON.parse(await readFile(exampleState, 'utf8'));
  const v = validate(p, s); assert.equal(v.code, exitCodes.ok); assert.deepEqual(v.report.errors, []); assert.deepEqual(v.report.warnings, []);
  assert.deepEqual(v.report.summary, { missions: 15, byKind: { dev: 14, review: 1 }, byStatus: { active: 1, closed: 1, delivered: 2, historical: 1, integrated: 1, pending: 9 } });
  const oracle = JSON.parse((await readFile(join(skillDir, 'PLANNING.md'), 'utf8')).match(/```json\n([\s\S]*?)\n```/)[1]);
  const { code, report } = ready(p, s); assert.equal(code, exitCodes.ok);
  // L’oracle du contrat est le rapport complet attendu sur les fichiers d’exemple : aucune retouche, aucune abréviation tolérée.
  assert.deepEqual(report, oracle);
  assert.equal(report.capacity.source, s.capacity.source, 'la provenance du plafond est celle de l’état, non abrégée');
  assert.deepEqual(report.proposals.find(x => x.mission === 'C01').holds, { paths: ['template/app/search/fixtures/'], resources: [] });
  assert.deepEqual(report.summary, v.report.summary);
  assert.deepEqual(report.proposals.map(x => `${x.mission}:${x.step}`), ['J01:integrate', 'Z00:publish', 'A01:resume', 'C01:start', 'D01:start', 'G01:start']);
  assert.deepEqual(report.blocked.map(b => b.mission), ['E01', 'F01', 'I01', 'K01']);
  assert.deepEqual(Object.entries(report.missions).filter(([, m]) => m.outcome === 'waiting').map(([id]) => id), ['H01', 'L01']);
  assertEveryNonProposalExplained(report);
});

test('independent missions are all proposed in one cycle, holds accumulate, capacity is consumed and the remainder waits', () => {
  const p = plan([mission('A', { priority: 2, reserves: { paths: ['a/'] } }), mission('B', { priority: 1, reserves: { paths: ['b/'] } }), mission('C', { priority: 2, reserves: { paths: ['c/'], resources: ['db:schema'] } }), mission('D', { priority: 9 })]);
  const { code, report } = ready(p, state());
  assert.equal(code, exitCodes.ok);
  assert.deepEqual(proposedSteps(report), ['B:start', 'A:start', 'C:start']);
  assert.deepEqual(report.proposals.map(x => x.order), [1, 2, 3]);
  assert.deepEqual(report.proposals[2].holds, { paths: ['c/'], resources: ['db:schema'] });
  assert.equal(report.proposals[0].selection, null);
  assert.deepEqual(report.capacity, { maxActiveRuns: 3, origin: 'configured', source: 'Plafond local décidé par l’orchestrateur pour test-plan', observedAt: T, providerQuotaVerified: false, active: 0, proposed: 3, free: 0, reviewBacklog: { count: 0, max: 3 } });
  assert.deepEqual(report.missions.D, { status: 'pending', outcome: 'waiting', step: 'start', reasons: [{ code: 'capacity_full' }] });
  assert.deepEqual(report.ready, [{ mission: 'B', step: 'start' }, { mission: 'A', step: 'start' }, { mission: 'C', step: 'start' }, { mission: 'D', step: 'start' }]);
  assertEveryNonProposalExplained(report);
});

test('path prefixes and semantic resources collide with held reservations; the same path in another repo does not', () => {
  const p = plan([
    mission('HOLD', { reserves: { paths: ['runtime/core/', 'docs/SEARCH.md'] } }),
    mission('APP', { repo: 'app', reserves: { paths: ['runtime/core/'], resources: ['kit:version'] } }),
    mission('FILE', { reserves: { paths: ['runtime/core/search/index.ts'] } }),
    mission('DIR', { reserves: { paths: ['runtime/'] } }),
    mission('SAME_OTHER_REPO', { repo: 'app', reserves: { paths: ['docs/SEARCH.md'] } }),
    mission('RES', { repo: 'app', reserves: { resources: ['kit:version'] } }),
    mission('FREE', { reserves: { paths: ['runtime2/'] } }),
  ]);
  const s = state({ HOLD: engaged('HOLD', 'active'), APP: engaged('APP', 'delivered', { branch: 'agents/other-branch' }) }, { capacity: { ...state().capacity, maxActiveRuns: 9 } });
  const { code, report } = ready(p, s);
  assert.equal(code, exitCodes.ok);
  assert.deepEqual(report.missions.FILE.reasons, [{ code: 'reservation_conflict', with: 'HOLD', path: 'runtime/core/', holderStatus: 'active' }]);
  assert.deepEqual(report.missions.DIR.reasons, [{ code: 'reservation_conflict', with: 'HOLD', path: 'runtime/core/', holderStatus: 'active' }], 'runtime/ englobe runtime/core/ mais pas docs/SEARCH.md');
  assert.deepEqual(report.missions.RES.reasons, [{ code: 'reservation_conflict', with: 'APP', resource: 'kit:version', holderStatus: 'delivered' }]);
  assert.equal(report.missions.SAME_OTHER_REPO.outcome, 'proposed');
  assert.deepEqual(proposedSteps(report), ['APP:integrate', 'FREE:start', 'SAME_OTHER_REPO:start']);
  assert.equal(pathsCollide('a/b', 'a/b/'), true); assert.equal(pathsCollide('a/bc', 'a/b'), false); assert.equal(pathsCollide('a', 'a/b/c'), true);
  assertEveryNonProposalExplained(report);
});

test('a same-repo reservation held globally across repos blocks, and a proposal of the cycle blocks the next candidate with holderStatus proposed', () => {
  const p = plan([mission('A', { priority: 1, reserves: { paths: ['shared/'], resources: ['kit:version'] } }), mission('B', { priority: 2, repo: 'app', reserves: { resources: ['kit:version'] } }), mission('C', { priority: 3, reserves: { paths: ['shared/x.ts'] } }), mission('D', { priority: 4, repo: 'app', reserves: { paths: ['shared/x.ts'] } })]);
  const { report } = ready(p, state({}, { capacity: { ...state().capacity, maxActiveRuns: 9 } }));
  assert.deepEqual(proposedSteps(report), ['A:start', 'D:start']);
  assert.deepEqual(report.missions.B.reasons, [{ code: 'reservation_conflict', with: 'A', resource: 'kit:version', holderStatus: 'proposed' }]);
  assert.deepEqual(report.missions.C.reasons, [{ code: 'reservation_conflict', with: 'A', path: 'shared/', holderStatus: 'proposed' }]);
  assert.equal(report.missions.B.outcome, 'waiting'); assert.equal(report.missions.C.outcome, 'waiting');
  assertEveryNonProposalExplained(report);
});

test('three-step dependencies unlock progressively; integrate and publish dependencies never block start', () => {
  const p = plan([
    mission('A', { reserves: { paths: ['a/'] } }),
    mission('B', { dependencies: { start: [{ mission: 'A', step: 'delivered' }] } }),
    mission('C', { dependencies: { start: [{ mission: 'B', step: 'delivered' }] } }),
    mission('D', { dependencies: { integrate: [{ mission: 'A', step: 'integrated' }], publish: [{ mission: 'A', step: 'published' }] } }),
    mission('E', { dependencies: { publish: [{ condition: 'ci-green' }] } }),
    mission('F', { dependencies: { publish: [{ condition: 'contract-accepted' }] } }),
  ]);
  const s0 = state({}, { capacity: { ...state().capacity, maxActiveRuns: 9 } });
  let r = ready(p, s0).report;
  assert.deepEqual(r.missions.B.reasons, [{ code: 'dependency_unmet', on: { mission: 'A', step: 'delivered' } }]);
  assert.deepEqual(r.missions.C.reasons, [{ code: 'dependency_unmet', on: { mission: 'B', step: 'delivered' } }]);
  assert.equal(r.missions.D.outcome, 'proposed');
  const s1 = state({ A: engaged('A', 'delivered'), D: engaged('D', 'delivered'), E: engaged('E', 'integrated'), F: engaged('F', 'integrated'), B: engaged('B', 'active') }, { capacity: { ...state().capacity, maxActiveRuns: 9 }, conditions: { 'ci-green': { satisfied: false, evidence: 'run rouge', at: T }, 'contract-accepted': { satisfied: true, evidence: 'https://github.com/example/kit/pull/9#reception', at: T } } });
  r = ready(p, s1).report;
  assert.equal(r.missions.B.outcome, 'active');
  assert.deepEqual(r.missions.C.reasons, [{ code: 'dependency_unmet', on: { mission: 'B', step: 'delivered' } }]);
  assert.deepEqual(r.missions.D, { status: 'delivered', outcome: 'blocked', step: 'integrate', reasons: [{ code: 'dependency_unmet', on: { mission: 'A', step: 'integrated' } }] });
  assert.deepEqual(r.missions.E.reasons, [{ code: 'condition_failed', condition: 'ci-green' }]);
  assert.deepEqual(r.missions.F, { status: 'integrated', outcome: 'proposed', step: 'publish', reasons: [] });
  assert.deepEqual(proposedSteps(r), ['A:integrate', 'F:publish']);
  assert.equal(r.proposals[0].prUrl, s1.missions.A.prUrl); assert.equal(r.proposals[0].headSha, SHA('2')); assert.equal(r.proposals[0].consumesCapacity, false);
  assert.deepEqual(r.proposals[1].covers, ['F']);
  const s2 = state({ A: engaged('A', 'published'), B: engaged('B', 'delivered'), D: engaged('D', 'delivered') }, { capacity: { ...state().capacity, maxActiveRuns: 9 } });
  r = ready(p, s2).report;
  assert.equal(r.missions.C.outcome, 'proposed'); assert.equal(r.missions.A.outcome, 'done');
  assert.deepEqual(r.missions.B.outcome, 'proposed'); assert.deepEqual(r.missions.D.outcome, 'waiting'); assert.deepEqual(r.missions.D.reasons, [{ code: 'integration_serialized', after: 'B' }]);
  assertEveryNonProposalExplained(r);
});

test('real cycles are rejected with their nodes; cross review is not a cycle; self dependency and unknown references are contract errors', () => {
  const cycle = validate(plan([mission('A', { dependencies: { start: [{ mission: 'B', step: 'delivered' }] } }), mission('B', { dependencies: { start: [{ mission: 'A', step: 'delivered' }] } })]), state());
  assert.equal(cycle.code, exitCodes.invalid); assert.deepEqual(codes(cycle.report), ['dependency_cycle']);
  assert.deepEqual(cycle.report.errors[0].nodes, ['A.start', 'A.delivered', 'B.start', 'B.delivered']);
  const publishCycle = validate(plan([mission('A', { dependencies: { start: [{ mission: 'B', step: 'published' }] } }), mission('B', { dependencies: { publish: [{ mission: 'A', step: 'delivered' }] } })]), state());
  assert.equal(publishCycle.code, exitCodes.invalid); assert.equal(publishCycle.report.errors[0].code, 'dependency_cycle');
  const cross = validate(plan([mission('A', { dependencies: { integrate: [{ mission: 'R', step: 'delivered' }] } }), mission('R', { kind: 'review', dependencies: { start: [{ mission: 'A', step: 'delivered' }] } })]), state());
  assert.equal(cross.code, exitCodes.ok); assert.equal(cross.report.valid, true);
  const self = validate(plan([mission('A', { dependencies: { integrate: [{ mission: 'A', step: 'delivered' }] } })]), state());
  assert.equal(self.code, exitCodes.invalid); assert.deepEqual(codes(self.report), ['self_dependency']); assert.equal(self.report.errors[0].path, '/missions/0/dependencies/integrate/0/mission');
  const unknown = validate(plan([mission('A', { repo: 'nope', reserves: { resources: ['db:none'] }, dependencies: { start: [{ mission: 'ZZ', step: 'delivered' }, { condition: 'never' }] } })]), state());
  assert.equal(unknown.code, exitCodes.invalid); assert.deepEqual(codes(unknown.report), ['unknown_reference', 'unknown_reference', 'unknown_reference', 'unknown_reference']);
  assert.deepEqual(unknown.report.errors.map(e => e.path), ['/missions/0/repo', '/missions/0/reserves/resources/0', '/missions/0/dependencies/start/0/mission', '/missions/0/dependencies/start/1/condition']);
  const duplicate = validate(plan([mission('A'), mission('A')]), state());
  assert.deepEqual(codes(duplicate.report), ['duplicate_mission']);
  const steps = validate(plan([mission('A', { dependencies: { start: [{ mission: 'R', step: 'integrated' }] } }), mission('R', { kind: 'investigation', dependencies: { integrate: [{ mission: 'A', step: 'delivered' }] } })]), state());
  assert.equal(steps.code, exitCodes.invalid); assert.deepEqual(codes(steps.report), ['step_not_applicable', 'step_not_applicable']);
  const mismatch = validate(plan([mission('A')]), state({}, { plan: { id: 'other-plan' } }));
  assert.deepEqual(codes(mismatch.report), ['plan_mismatch']);
  const foreign = validate(plan([mission('A')]), state({ B: { status: 'pending' } }));
  assert.deepEqual(codes(foreign.report), ['state_mission_unknown']);
  const pauseTarget = validate(plan([mission('A')]), state({}, { pauses: [{ scope: 'lot', target: 'nope', reason: 'x', since: T }], conditions: { 'not-declared': { satisfied: true, evidence: 'e', at: T } } }));
  assert.deepEqual(codes(pauseTarget.report), ['unknown_reference', 'unknown_reference']);
  const revision = validate(plan([mission('A')]), state({}, { plan: { id: 'test-plan', revision: 'r2' } }));
  assert.equal(revision.code, exitCodes.ok); assert.deepEqual(revision.report.warnings.map(w => w.code), ['revision_mismatch']);
});

test('structure is enforced by the shipped schemas: format version, ambiguous paths, forbidden keys, ready reports nothing on invalid input', () => {
  for (const bad of ['./a', '/a', 'a/../b', 'a//b', 'a/./b', '.', '..', 'a b', 'a\\b']) {
    const r = validate(plan([mission('A', { reserves: { paths: [bad] } })]), state());
    assert.equal(r.code, exitCodes.invalid, bad); assert.equal(r.report.errors[0].code, 'schema_invalid'); assert.equal(r.report.errors[0].path, '/missions/0/reserves/paths/0');
  }
  const version = validate({ ...plan([mission('A')]), formatVersion: 2 }, state());
  assert.equal(version.code, exitCodes.invalid); assert.equal(version.report.errors[0].path, '/formatVersion');
  const stateVersion = validate(plan([mission('A')]), { ...state(), formatVersion: '1' });
  assert.equal(stateVersion.code, exitCodes.invalid); assert.equal(stateVersion.report.errors[0].file, 'state');
  const secretInPlan = validate(plan([mission('A', { branch: 'agents/A' })]), state());
  assert.equal(secretInPlan.report.errors[0].message, 'propriété non permise : branch');
  const r = ready(plan([mission('A')]), state({ A: { status: 'pending', launch: 'uncertain' } }));
  assert.equal(r.code, exitCodes.invalid); assert.equal(r.report.reliable, false); assert.deepEqual(r.report.proposals, []); assert.deepEqual(r.report.missions, {}); assert.equal(r.report.capacity, null);
  assert.throws(() => validateSchema({ $ref: '#/$defs/none' }, 1), UsageError);
});

test('reservations are held from active through delivered until integrated or closed, and released holds are recomputed after a merge', () => {
  const p = plan([mission('Z', { priority: 1, reserves: { paths: ['scripts/publish.mjs'], resources: ['kit:version'] } }), mission('G', { priority: 3, reserves: { paths: ['CHANGELOG.md'], resources: ['kit:version'] } }), mission('R', { kind: 'review', reserves: { paths: ['CHANGELOG.md'] } })]);
  const delivered = ready(p, state({ Z: engaged('Z', 'delivered') })).report;
  assert.deepEqual(delivered.missions.G, { status: 'pending', outcome: 'blocked', step: 'start', reasons: [{ code: 'reservation_conflict', with: 'Z', resource: 'kit:version', holderStatus: 'delivered' }] });
  assert.deepEqual(proposedSteps(delivered), ['Z:integrate', 'R:start']);
  const integrated = ready(p, state({ Z: engaged('Z', 'integrated'), R: engaged('R', 'delivered') })).report;
  assert.deepEqual(proposedSteps(integrated), ['Z:publish']);
  assert.deepEqual(integrated.missions.G.reasons, [{ code: 'reservation_conflict', with: 'R', path: 'CHANGELOG.md', holderStatus: 'delivered' }]);
  assert.deepEqual(integrated.missions.R, { status: 'delivered', outcome: 'done', step: null, reasons: [] });
  const closed = ready(p, state({ Z: engaged('Z', 'published'), R: engaged('R', 'closed') })).report;
  assert.deepEqual(proposedSteps(closed), ['G:start']);
  assert.deepEqual(closed.proposals[0].holds, { paths: ['CHANGELOG.md'], resources: ['kit:version'] });
  const cancelled = ready(p, state({ Z: { status: 'cancelled' }, R: { status: 'cancelled' } })).report;
  assert.deepEqual(proposedSteps(cancelled), ['G:start']); assert.equal(cancelled.missions.Z.outcome, 'cancelled');
});

test('a requested correction proposes resume on the same agent and selection, holds integration, and reopens integration once cleared', () => {
  const p = plan([mission('A', { priority: 1, reserves: { paths: ['a/'] } }), mission('B', { priority: 2, dependencies: { start: [{ mission: 'A', step: 'delivered' }] } }), mission('K', { priority: 2, dependencies: { start: [{ mission: 'A', step: 'delivered' }, { condition: 'contract-accepted' }] } })]);
  const correction = { requested: true, reason: 'Revue : test négatif manquant', at: T };
  const inCorrection = ready(p, state({ A: engaged('A', 'delivered', { correction, followups: 1 }) })).report;
  assert.deepEqual(inCorrection.missions.A, { status: 'delivered', outcome: 'proposed', step: 'resume', reasons: [{ code: 'correction_pending', step: 'integrate' }] });
  assert.deepEqual(inCorrection.proposals[0], { order: 1, mission: 'A', step: 'resume', repo: 'kit', priority: 1, agentId: 'bc-test-a', selection: SELECTION, reason: correction.reason, consumesCapacity: true, holds: { paths: ['a/'], resources: [] } });
  assert.equal(inCorrection.missions.B.outcome, 'proposed', 'un consommateur réalignable démarre sur delivered même en correction');
  assert.deepEqual(inCorrection.missions.K.reasons, [{ code: 'condition_unverified', condition: 'contract-accepted' }]);
  assert.equal(inCorrection.capacity.proposed, 2); assert.equal(inCorrection.capacity.reviewBacklog.count, 1);
  const cleared = ready(p, state({ A: engaged('A', 'delivered', { correction: { ...correction, requested: false }, followups: 2 }) }, { conditions: { 'contract-accepted': { satisfied: true, evidence: 'https://github.com/example/kit/pull/11#reception', at: T, by: 'orchestrator' } } })).report;
  assert.deepEqual(cleared.missions.A, { status: 'delivered', outcome: 'proposed', step: 'integrate', reasons: [] });
  assert.equal(cleared.missions.K.outcome, 'proposed');
  const reopened = validate(p, state({ A: engaged('A', 'integrated', { correction }) }));
  assert.equal(reopened.code, exitCodes.invalid, 'une mission intégrée ne rouvre pas une correction : mission corrective distincte');
  const otherSelection = ready(p, state({ A: engaged('A', 'delivered', { correction, selection: OTHER_SELECTION }) })).report;
  assert.deepEqual(otherSelection.proposals[0].selection, OTHER_SELECTION, 'la sélection proposée est toujours celle de l’état, jamais une autre');
  const pausedResume = ready(p, state({ A: engaged('A', 'delivered', { correction }) }, { pauses: [{ scope: 'lot', target: 'lot-a', reason: 'Arbitrage', since: T }] })).report;
  assert.deepEqual(pausedResume.missions.A.outcome, 'blocked'); assert.deepEqual(pausedResume.missions.A.reasons.map(r => r.code), ['correction_pending', 'paused']);
});

test('historical missions prove their milestone without any selection, agent, run, place, hold or proposal', () => {
  const p = plan([mission('X', { reserves: { paths: ['runtime/core/'] } }), mission('E', { dependencies: { start: [{ mission: 'X', step: 'integrated' }] }, reserves: { paths: ['runtime/core/search/'] } }), mission('P', { dependencies: { start: [{ mission: 'X', step: 'published' }] } }), mission('RV', { kind: 'review' }), mission('Q', { dependencies: { start: [{ mission: 'RV', step: 'delivered' }] } })]);
  const historical = (step, extra = {}) => ({ status: 'historical', historical: { step, evidence: 'https://github.com/example/kit/pull/30 fusionnée', at: '2026-09-10T12:00:00Z' }, ...extra });
  const r = ready(p, state({ X: historical('integrated'), RV: historical('closed') }, { capacity: { ...state().capacity, maxActiveRuns: 9 } })).report;
  assert.deepEqual(r.missions.X, { status: 'historical', outcome: 'done', step: null, reasons: [] });
  assert.equal(r.capacity.active, 0); assert.deepEqual(r.active, []);
  assert.equal(r.missions.E.outcome, 'proposed', 'runtime/core/ n’est pas tenu par une mission historique');
  assert.deepEqual(r.missions.P.reasons, [{ code: 'dependency_unmet', on: { mission: 'X', step: 'published' } }]);
  assert.equal(r.missions.Q.outcome, 'proposed');
  assert.equal(ready(p, state({ X: historical('published') })).report.missions.P.outcome, 'proposed');
  const wrongDev = validate(p, state({ X: historical('closed') }));
  assert.equal(wrongDev.code, exitCodes.invalid); assert.deepEqual(wrongDev.report.errors[0], { code: 'historical_step_not_applicable', path: '/missions/X/historical/step', message: 'jalon historique closed inapplicable à une mission dev', mission: 'X', step: 'closed', kind: 'dev', file: 'state' });
  const wrongReview = validate(p, state({ RV: historical('published') }));
  assert.deepEqual(codes(wrongReview.report), ['historical_step_not_applicable']);
  for (const forbidden of [{ selection: SELECTION }, { agentId: 'bc-test-x' }, { launch: 'launched' }, { runStatus: 'FINISHED' }, { assignedAt: T }, { correction: { requested: false, reason: 'r', at: T } }]) {
    const bad = validate(p, state({ X: historical('integrated', forbidden) }));
    assert.equal(bad.code, exitCodes.invalid, JSON.stringify(forbidden)); assert.equal(bad.report.errors[0].code, 'schema_invalid');
  }
  const withoutHistorical = validate(p, state({ X: { status: 'historical' } })); assert.equal(withoutHistorical.code, exitCodes.invalid);
  const historicalOnDelivered = validate(p, state({ X: engaged('X', 'delivered', { historical: { step: 'integrated', evidence: 'e', at: T } }) })); assert.equal(historicalOnDelivered.code, exitCodes.invalid);
});

test('state invariants: pending never carries an uncertain, launched or historical run; released statuses never carry uncertainty; nothing is normalized', () => {
  const p = plan([mission('A'), mission('B')]);
  const expectInconsistent = (entry, field, extra = {}) => {
    const r = ready(p, state({ A: entry }));
    assert.equal(r.code, exitCodes.invalid, JSON.stringify(entry));
    const error = r.report.errors.find(e => e.code === 'state_inconsistent' && e.field === field);
    assert.ok(error, `state_inconsistent ${field} attendu : ${JSON.stringify(r.report.errors)}`);
    assert.equal(error.mission, 'A'); assert.equal(error.path, `/missions/A/${field}`);
    for (const [k, v] of Object.entries(extra)) assert.equal(error[k], v);
    assert.deepEqual(r.report.proposals, []); assert.deepEqual(r.report.missions, {});
  };
  // Précision de réception : pending + launched/reconciled avec agent ou run déjà attribué ne déclenche jamais un nouveau start.
  expectInconsistent({ status: 'pending', launch: 'launched', agentId: 'bc-test-a' }, 'launch', { nextAction: 'reconcile' });
  expectInconsistent({ status: 'pending', launch: 'reconciled', runId: 'run-test-a-1' }, 'launch', { nextAction: 'reconcile' });
  expectInconsistent({ status: 'pending', launch: 'reconciled', runId: 'run-test-a-1' }, 'runId');
  expectInconsistent({ status: 'pending', agentId: 'bc-test-a' }, 'agentId', { nextAction: 'reconcile' });
  expectInconsistent({ status: 'pending', runStatus: 'FINISHED' }, 'runStatus', { nextAction: 'reconcile' });
  expectInconsistent({ status: 'pending', runStatus: 'ERROR', launch: 'failed' }, 'runStatus');
  expectInconsistent({ status: 'pending', deliveredAt: T }, 'deliveredAt');
  expectInconsistent({ status: 'pending', assignedAt: T }, 'assignedAt');
  expectInconsistent({ status: 'pending', prUrl: 'https://github.com/example/kit/pull/7' }, 'prUrl', { nextAction: 'reconcile' });
  expectInconsistent({ status: 'pending', headSha: SHA('3') }, 'headSha', { nextAction: 'reconcile' });
  expectInconsistent({ status: 'pending', followups: 1 }, 'followups', { nextAction: 'reconcile' });
  const zeroFollowups = ready(p, state({ A: { status: 'pending', followups: 0 } }));
  assert.equal(zeroFollowups.code, exitCodes.ok); assert.equal(zeroFollowups.report.missions.A.outcome, 'proposed');
  expectInconsistent(engaged('A', 'active', { launch: 'not_created', runStatus: 'FINISHED' }), 'launch');
  expectInconsistent(engaged('A', 'active', { launch: 'failed', runStatus: 'ERROR' }), 'launch');
  expectInconsistent(engaged('A', 'closed'), 'status');
  const reviewIntegrated = validate(plan([mission('R', { kind: 'review' })]), state({ R: engaged('R', 'integrated') }));
  assert.ok(reviewIntegrated.report.errors.some(e => e.code === 'state_inconsistent' && e.field === 'status'));
  // Une tentative échouée reconnue reste pending : launch failed/not_created et agent déterministe admis, aucun run.
  const failedAttempt = ready(p, state({ A: { status: 'pending', launch: 'failed', agentId: 'bc-test-a' } }));
  assert.equal(failedAttempt.code, exitCodes.ok); assert.equal(failedAttempt.report.missions.A.outcome, 'proposed');
  // Les mêmes régressions vues par le schéma : pending + launch pending/uncertain ou run non terminal, statut libéré incertain, delivered non terminal.
  for (const entry of [
    { status: 'pending', launch: 'pending' }, { status: 'pending', launch: 'uncertain' }, { status: 'pending', runStatus: 'RUNNING' }, { status: 'pending', runStatus: 'UNKNOWN' },
    engaged('A', 'integrated', { launch: 'uncertain' }), engaged('A', 'published', { runStatus: 'RUNNING' }), engaged('A', 'closed', { correction: { requested: true, reason: 'r', at: T } }),
    engaged('A', 'delivered', { launch: 'uncertain' }), engaged('A', 'delivered', { runStatus: 'RUNNING' }), engaged('A', 'delivered', { launch: 'pending' }),
    { status: 'active', selection: SELECTION, branch: 'agents/a', base: SHA('1'), launch: 'pending', assignedAt: T },
  ]) {
    const r = ready(p, state({ A: entry }));
    assert.equal(r.code, exitCodes.invalid, JSON.stringify(entry)); assert.equal(r.report.errors[0].code, 'schema_invalid'); assert.equal(r.report.errors[0].file, 'state'); assert.match(r.report.errors[0].path, /^\/missions\/A/);
    assert.deepEqual(r.report.proposals, []);
  }
  const cancelledClean = ready(p, state({ A: { status: 'cancelled', launch: 'failed', runStatus: 'ERROR' } }));
  assert.equal(cancelledClean.code, exitCodes.ok); assert.equal(cancelledClean.report.missions.A.outcome, 'cancelled');
});

test('legacySelection (model omitted) documents a delivered lot without inventing a model: integrate and publish proposed, holds and backlog kept, no place, never resume', () => {
  const LEGACY = { reason: 'model_omitted', requestedAt: '2026-09-14T09:00:00Z', evidence: 'https://github.com/example/kit/pull/12#reception : création sans champ model avant le standard' };
  const legacy = (id, status, extra = {}) => { const entry = engaged(id, status, { legacySelection: LEGACY, ...extra }); delete entry.selection; return entry; };
  const p = plan([mission('L', { priority: 1, reserves: { paths: ['legacy/'], resources: ['kit:version'] } }), mission('N', { priority: 2, reserves: { paths: ['legacy/x.ts'] } }), mission('K', { priority: 3, reserves: { resources: ['kit:version'] } }), mission('F', { priority: 4 }), mission('RV', { kind: 'review' })]);
  // delivered sans correction : intégration proposée, réservations tenues, backlog compté, aucune place, cycle fiable, aucun modelId dans le rapport.
  const delivered = ready(p, state({ L: legacy('L', 'delivered') }, { capacity: { ...state().capacity, maxActiveRuns: 1, maxReviewBacklog: 1 } }));
  assert.equal(delivered.code, exitCodes.ok); assert.deepEqual(delivered.report.errors, []); assert.equal(delivered.report.reliable, true);
  assert.deepEqual(proposedSteps(delivered.report), ['L:integrate', 'RV:start']);
  assert.deepEqual(delivered.report.missions.L, { status: 'delivered', outcome: 'proposed', step: 'integrate', reasons: [] });
  assert.deepEqual(delivered.report.missions.N.reasons, [{ code: 'reservation_conflict', with: 'L', path: 'legacy/', holderStatus: 'delivered' }]);
  assert.deepEqual(delivered.report.missions.K.reasons, [{ code: 'reservation_conflict', with: 'L', resource: 'kit:version', holderStatus: 'delivered' }]);
  assert.deepEqual(delivered.report.missions.F.reasons, [{ code: 'review_backlog_full' }], 'le lot legacy compte dans le backlog de revue jusqu’à sa fusion');
  assert.deepEqual(delivered.report.capacity.reviewBacklog, { count: 1, max: 1 }); assert.equal(delivered.report.capacity.active, 0); assert.deepEqual(delivered.report.active, []);
  assert.equal(JSON.stringify(delivered.report).includes('modelId'), false, 'aucun modèle reconstitué');
  assert.equal(JSON.stringify(delivered.report).includes('claude-fable-5-1'), false);
  assertEveryNonProposalExplained(delivered.report);
  // Correction demandée : resume refusé localement (selection_unknown), sans pause, aucune sélection proposée ; l’intégration reste retenue.
  const correction = { requested: true, reason: 'Revue : écart à corriger', at: T };
  const corrected = ready(p, state({ L: legacy('L', 'delivered', { correction }) }, { capacity: { ...state().capacity, maxActiveRuns: 9 } }));
  assert.equal(corrected.code, exitCodes.ok);
  assert.deepEqual(corrected.report.missions.L, { status: 'delivered', outcome: 'blocked', step: 'resume', reasons: [{ code: 'correction_pending', step: 'integrate' }, { code: 'selection_unknown', provenance: 'model_omitted', nextAction: 'corrective_mission' }] });
  assert.ok(!corrected.report.proposals.some(x => x.mission === 'L')); assert.deepEqual(corrected.report.blocked.find(b => b.mission === 'L').reasons.map(r => r.code), ['selection_unknown']);
  assert.deepEqual(corrected.report.missions.N.reasons[0].code, 'reservation_conflict', 'réservations toujours tenues pendant la correction');
  assertEveryNonProposalExplained(corrected.report);
  // Progression terminale légitime : integrated ⇒ publish proposé sans sélection ; published / closed ⇒ done.
  const integrated = ready(p, state({ L: legacy('L', 'integrated') })).report;
  assert.deepEqual(integrated.missions.L, { status: 'integrated', outcome: 'proposed', step: 'publish', reasons: [] }); assert.deepEqual(integrated.proposals[0], { order: 1, mission: 'L', step: 'publish', repo: 'kit', covers: ['L'], consumesCapacity: false });
  assert.equal(integrated.missions.N.outcome, 'proposed', 'réservations libérées à l’intégration');
  assert.equal(ready(p, state({ L: legacy('L', 'published') })).report.missions.L.outcome, 'done');
  const closedReview = legacy('RV', 'closed'); const closed = ready(p, state({ RV: closedReview }));
  assert.equal(closed.code, exitCodes.ok); assert.equal(closed.report.missions.RV.outcome, 'done');
  // Schéma : exclusivité, aucune provenance ⇒ invalide (jamais un modelId par défaut), statuts non terminaux refusés, reason fermée, champs requis.
  const invalid = (entry, label) => { const r = ready(p, state({ L: entry })); assert.equal(r.code, exitCodes.invalid, label); assert.equal(r.report.errors[0].code, 'schema_invalid', label); assert.equal(r.report.errors[0].file, 'state'); assert.deepEqual(r.report.proposals, []); return r.report.errors; };
  invalid(engaged('L', 'delivered', { legacySelection: LEGACY }), 'selection et legacySelection ensemble');
  const none = engaged('L', 'delivered'); delete none.selection; invalid(none, 'delivered sans aucune provenance');
  const noneIntegrated = engaged('L', 'integrated'); delete noneIntegrated.selection; invalid(noneIntegrated, 'integrated sans aucune provenance');
  const legacyActive = engaged('L', 'active', { legacySelection: LEGACY }); delete legacyActive.selection; invalid(legacyActive, 'active avec legacySelection');
  invalid(engaged('L', 'active', { legacySelection: LEGACY }), 'active avec les deux');
  invalid({ status: 'pending', legacySelection: LEGACY }, 'pending avec legacySelection');
  invalid({ status: 'historical', historical: { step: 'integrated', evidence: 'e', at: T }, legacySelection: LEGACY }, 'historical avec legacySelection');
  invalid(legacy('L', 'delivered', { legacySelection: { ...LEGACY, reason: 'unknown' } }), 'reason hors model_omitted');
  invalid(legacy('L', 'delivered', { legacySelection: { reason: 'model_omitted', requestedAt: LEGACY.requestedAt } }), 'evidence requise');
  invalid(legacy('L', 'delivered', { legacySelection: { ...LEGACY, modelId: 'claude-fable-5-1' } }), 'aucun modelId dans la provenance legacy');
  invalid(legacy('L', 'delivered', { launch: 'uncertain' }), 'delivered legacy exige un lancement réconcilié');
  invalid(legacy('L', 'delivered', { runStatus: 'RUNNING' }), 'delivered legacy exige un run terminal');
  const legacyReview = ready(plan([mission('R', { kind: 'review' })]), state({ R: legacy('R', 'integrated') }));
  assert.ok(legacyReview.report.errors.some(e => e.code === 'state_inconsistent' && e.field === 'status'), 'selon kind : integrated sur review reste incohérent avec une provenance legacy');
});

test('an active mission whose last run is already terminal stays counted and held but is labelled run_terminal_unreconciled, never run_active', () => {
  const p = plan([mission('A', { reserves: { paths: ['a/'] } }), mission('B', { reserves: { paths: ['a/b.ts'] } })]);
  for (const runStatus of ['FINISHED', 'ERROR', 'CANCELLED', 'EXPIRED']) {
    const r = ready(p, state({ A: engaged('A', 'active', { runStatus }) }));
    assert.equal(r.code, exitCodes.ok, runStatus);
    assert.deepEqual(r.report.missions.A, { status: 'active', outcome: 'active', step: null, reasons: [{ code: 'run_terminal_unreconciled', runStatus, nextAction: 'reconcile' }] });
    assert.deepEqual(r.report.active, [{ mission: 'A', kind: 'dev', runStatus, launch: 'launched', counted: true }]); assert.equal(r.report.capacity.active, 1);
    assert.deepEqual(r.report.missions.B.reasons, [{ code: 'reservation_conflict', with: 'A', path: 'a/', holderStatus: 'active' }]);
  }
  for (const runStatus of ['CREATING', 'RUNNING']) assert.deepEqual(ready(p, state({ A: engaged('A', 'active', { runStatus }) })).report.missions.A.reasons, [{ code: 'run_active', runStatus }]);
  const uncertainTerminal = ready(p, state({ A: engaged('A', 'active', { runStatus: 'FINISHED', launch: 'uncertain', runId: null }) })).report;
  assert.deepEqual(uncertainTerminal.missions.A.reasons, [{ code: 'launch_uncertain', nextAction: 'reconcile' }], 'l’incertitude du POST prime sur le statut du run lu');
});

test('active missions count, hold and are never relaunched; an uncertain POST asks for reconcile; observed runs raise the count to the maximum', () => {
  const p = plan([mission('A', { priority: 1, reserves: { paths: ['a/'] } }), mission('B', { priority: 2, reserves: { paths: ['a/x.ts'] } }), mission('C', { priority: 3 }), mission('D', { priority: 4 })]);
  const uncertain = { status: 'active', selection: SELECTION, branch: 'agents/a', base: SHA('1'), agentId: 'bc-test-a', runId: null, runStatus: 'UNKNOWN', launch: 'uncertain', assignedAt: T };
  const pendingPost = { ...uncertain, launch: 'pending', runStatus: undefined }; delete pendingPost.runStatus;
  let r = ready(p, state({ A: uncertain })).report;
  assert.deepEqual(r.active, [{ mission: 'A', kind: 'dev', runStatus: 'UNKNOWN', launch: 'uncertain', counted: true }]);
  assert.deepEqual(r.missions.A, { status: 'active', outcome: 'active', step: null, reasons: [{ code: 'launch_uncertain', nextAction: 'reconcile' }] });
  assert.deepEqual(r.missions.B.reasons, [{ code: 'reservation_conflict', with: 'A', path: 'a/', holderStatus: 'active' }]);
  assert.deepEqual(proposedSteps(r), ['C:start', 'D:start']); assert.equal(r.capacity.active, 1); assert.equal(r.capacity.free, 0);
  r = ready(p, state({ A: pendingPost })).report;
  assert.deepEqual(r.active, [{ mission: 'A', kind: 'dev', runStatus: null, launch: 'pending', counted: true }]); assert.equal(r.missions.A.reasons[0].code, 'launch_uncertain');
  r = ready(p, state({ A: engaged('A', 'active') })).report;
  assert.deepEqual(r.missions.A.reasons, [{ code: 'run_active', runStatus: 'RUNNING' }]);
  r = ready(p, state({ A: engaged('A', 'active') }, { capacity: { ...state().capacity, observedActiveRuns: { value: 2, source: 'Agents du périmètre test-plan lus par cursor-agents status', at: T } } })).report;
  assert.equal(r.capacity.active, 2, 'le maximum du comptage et du relevé est retenu'); assert.deepEqual(proposedSteps(r), ['C:start']); assert.deepEqual(r.missions.D.reasons, [{ code: 'capacity_full' }]);
  r = ready(p, state({ A: engaged('A', 'active') }, { capacity: { ...state().capacity, observedActiveRuns: { value: 0, source: 'relevé plus ancien', at: T } } })).report;
  assert.equal(r.capacity.active, 1, 'un relevé inférieur ne réduit jamais le comptage des missions');
  assertEveryNonProposalExplained(r);
});

test('capacity: null is undecidable (code 3, no proposal, causes listed), 0 is valid with every start waiting, a local ceiling decides without any provider quota', () => {
  const p = plan([mission('A', { priority: 1 }), mission('B', { priority: 2 }), mission('J'), mission('Z'), mission('R', { kind: 'review' })]);
  const engagedState = { J: engaged('J', 'delivered'), Z: engaged('Z', 'integrated') };
  const nul = ready(p, state(engagedState, { capacity: { ...state().capacity, maxActiveRuns: null, source: 'Quota fournisseur non exposé et aucun plafond local décidé' } }));
  assert.equal(nul.code, exitCodes.unreliable); assert.equal(nul.report.valid, true); assert.equal(nul.report.reliable, false); assert.deepEqual(nul.report.proposals, []);
  assert.deepEqual(nul.report.warnings.map(w => w.code), ['capacity_unknown']);
  assert.equal(nul.report.capacity.maxActiveRuns, null); assert.equal(nul.report.capacity.free, 0); assert.equal(nul.report.capacity.proposed, 0);
  assert.deepEqual(nul.report.missions.A, { status: 'pending', outcome: 'waiting', step: 'start', reasons: [{ code: 'capacity_full', maxActiveRuns: null }] });
  assert.deepEqual(nul.report.missions.J.outcome, 'waiting'); assert.deepEqual(nul.report.ready.map(x => x.mission), ['J', 'Z', 'A', 'B', 'R']);
  assertEveryNonProposalExplained(nul.report);
  const zero = ready(p, state(engagedState, { capacity: { ...state().capacity, maxActiveRuns: 0, source: 'Plafond local 0 : gel des lancements' } }));
  assert.equal(zero.code, exitCodes.ok); assert.equal(zero.report.reliable, true);
  assert.deepEqual(proposedSteps(zero.report), ['J:integrate', 'Z:publish']);
  for (const id of ['A', 'B', 'R']) assert.deepEqual(zero.report.missions[id], { status: 'pending', outcome: 'waiting', step: 'start', reasons: [{ code: 'capacity_full' }] });
  assert.deepEqual(zero.report.capacity, { maxActiveRuns: 0, origin: 'configured', source: 'Plafond local 0 : gel des lancements', observedAt: T, providerQuotaVerified: false, active: 0, proposed: 0, free: 0, reviewBacklog: { count: 1, max: 3 } });
  const local = ready(p, state(engagedState, { capacity: { ...state().capacity, maxActiveRuns: 2, note: 'Quota du fournisseur inconnu : non exposé par l’API' } }));
  assert.equal(local.code, exitCodes.ok); assert.equal(local.report.capacity.providerQuotaVerified, false); assert.deepEqual(proposedSteps(local.report), ['J:integrate', 'Z:publish', 'A:start', 'B:start']);
  const observed = ready(p, state(engagedState, { capacity: { ...state().capacity, maxActiveRuns: 2, origin: 'observed', source: 'Réponse 429 datée du fournisseur sur le périmètre test-plan' } }));
  assert.equal(observed.report.capacity.providerQuotaVerified, true);
});

test('an unknown status makes the cycle undecidable and its consumers report dependency_unknown; a cancelled producer reports dependency_cancelled', () => {
  const p = plan([mission('U'), mission('C', { dependencies: { start: [{ mission: 'U', step: 'delivered' }] } }), mission('X'), mission('K', { dependencies: { start: [{ mission: 'X', step: 'delivered' }] } }), mission('F')]);
  const r = ready(p, state({ U: { status: 'unknown' }, X: { status: 'cancelled' } }));
  assert.equal(r.code, exitCodes.unreliable); assert.equal(r.report.reliable, false); assert.deepEqual(r.report.proposals, []);
  assert.deepEqual(r.report.warnings.map(w => w.code), ['status_unknown']);
  assert.deepEqual(r.report.missions.U, { status: 'unknown', outcome: 'unknown', step: null, reasons: [{ code: 'status_unknown' }] });
  assert.deepEqual(r.report.missions.C.reasons, [{ code: 'dependency_unknown', on: { mission: 'U', step: 'delivered' } }]);
  assert.deepEqual(r.report.missions.K, { status: 'pending', outcome: 'blocked', step: 'start', reasons: [{ code: 'dependency_cancelled', on: { mission: 'X', step: 'delivered' } }] });
  assert.deepEqual(r.report.missions.F, { status: 'pending', outcome: 'waiting', step: 'start', reasons: [{ code: 'status_unknown', mission: 'U' }] });
  assertEveryNonProposalExplained(r.report);
  const withNull = ready(p, state({ U: { status: 'unknown' } }, { capacity: { ...state().capacity, maxActiveRuns: null } }));
  assert.equal(withNull.code, exitCodes.unreliable); assert.deepEqual(withNull.report.warnings.map(w => w.code), ['capacity_unknown', 'status_unknown']);
  assert.deepEqual(withNull.report.missions.F.reasons, [{ code: 'capacity_full', maxActiveRuns: null }, { code: 'status_unknown', mission: 'U' }]);
});

test('proposals are ordered integrate then publish per repo, then resume/start by priority then id; serialization is explained', () => {
  const p = plan([
    mission('I2', { priority: 2, repo: 'kit' }), mission('I1', { priority: 1, repo: 'kit' }), mission('IA', { priority: 3, repo: 'app' }),
    mission('P1', { priority: 1 }), mission('P2', { priority: 2 }), mission('PA', { repo: 'app' }), mission('PX', { priority: 1, dependencies: { publish: [{ condition: 'ci-green' }] } }),
    mission('S3', { priority: 3 }), mission('S1b', { priority: 1 }), mission('S1a', { priority: 1 }), mission('RES', { priority: 2 }),
  ]);
  const s = state({ I2: engaged('I2', 'delivered'), I1: engaged('I1', 'delivered'), IA: engaged('IA', 'delivered'), P1: engaged('P1', 'integrated'), P2: engaged('P2', 'integrated'), PA: engaged('PA', 'integrated'), PX: engaged('PX', 'integrated'), RES: engaged('RES', 'delivered', { correction: { requested: true, reason: 'Correction', at: T } }) }, { capacity: { ...state().capacity, maxActiveRuns: 9, maxReviewBacklog: 9 } });
  const { code, report } = ready(p, s);
  assert.equal(code, exitCodes.ok);
  assert.deepEqual(proposedSteps(report), ['I1:integrate', 'IA:integrate', 'P1:publish', 'PA:publish', 'S1a:start', 'S1b:start', 'RES:resume', 'S3:start']);
  assert.deepEqual(report.missions.I2, { status: 'delivered', outcome: 'waiting', step: 'integrate', reasons: [{ code: 'integration_serialized', after: 'I1' }] });
  assert.deepEqual(report.proposals[2].covers, ['P1', 'P2']); assert.deepEqual(report.proposals[3].covers, ['PA']); assert.equal(report.missions.P2.outcome, 'proposed');
  assert.deepEqual(report.missions.PX, { status: 'integrated', outcome: 'blocked', step: 'publish', reasons: [{ code: 'condition_unverified', condition: 'ci-green' }] });
  assert.deepEqual(report.ready.map(x => x.mission), ['I1', 'I2', 'IA', 'P1', 'P2', 'PA', 'S1a', 'S1b', 'RES', 'S3']);
  assert.deepEqual(Object.keys(report.missions), [...Object.keys(report.missions)].sort());
  assertEveryNonProposalExplained(report);
  const again = ready(structuredClone(p), structuredClone(s));
  assert.equal(JSON.stringify(again.report), JSON.stringify(report), 'même entrée ⇒ même rapport');
});

test('review backlog bounds new dev starts only: reviews, corrections, integrations and publications stay proposable', () => {
  const p = plan([mission('D1', { priority: 1 }), mission('D2', { priority: 2 }), mission('N', { priority: 3 }), mission('R', { kind: 'review', priority: 4, dependencies: { start: [{ mission: 'D1', step: 'delivered' }] } }), mission('INV', { kind: 'investigation', priority: 5 }), mission('Z')]);
  const s = state({ D1: engaged('D1', 'delivered'), D2: engaged('D2', 'delivered', { correction: { requested: true, reason: 'Écart de revue', at: T } }), Z: engaged('Z', 'integrated') }, { capacity: { ...state().capacity, maxActiveRuns: 9, maxReviewBacklog: 2 } });
  const { report } = ready(p, s);
  assert.deepEqual(report.capacity.reviewBacklog, { count: 2, max: 2 });
  assert.deepEqual(proposedSteps(report), ['D1:integrate', 'Z:publish', 'D2:resume', 'R:start', 'INV:start']);
  assert.deepEqual(report.missions.N, { status: 'pending', outcome: 'waiting', step: 'start', reasons: [{ code: 'review_backlog_full' }] });
  assertEveryNonProposalExplained(report);
  const both = ready(p, state(s.missions, { capacity: { ...s.capacity, maxActiveRuns: 0 } })).report;
  assert.deepEqual(both.missions.N.reasons, [{ code: 'capacity_full' }, { code: 'review_backlog_full' }]);
});

test('pauses target a mission, a lot, a repo or everything; running missions, integrations and publications are untouched', () => {
  const p = plan([mission('M', { priority: 1 }), mission('L', { priority: 2, lot: 'lot-b' }), mission('RP', { priority: 3, repo: 'app' }), mission('OK', { priority: 4 }), mission('A'), mission('J'), mission('Z')]);
  const s = state({ A: engaged('A', 'active'), J: engaged('J', 'delivered'), Z: engaged('Z', 'integrated') }, { capacity: { ...state().capacity, maxActiveRuns: 9 } });
  const pause = (scope, target, reason) => ({ scope, ...(target ? { target } : {}), reason, since: T });
  let r = ready(p, { ...s, pauses: [pause('mission', 'M', 'Arbitrage'), pause('lot', 'lot-b', 'Lot en pause'), pause('repo', 'app', 'Dépôt gelé')] }).report;
  assert.deepEqual(r.missions.M.reasons, [{ code: 'paused', scope: 'mission', target: 'M', since: T, reason: 'Arbitrage' }]);
  assert.deepEqual(r.missions.L.reasons, [{ code: 'paused', scope: 'lot', target: 'lot-b', since: T, reason: 'Lot en pause' }]);
  assert.deepEqual(r.missions.RP.reasons, [{ code: 'paused', scope: 'repo', target: 'app', since: T, reason: 'Dépôt gelé' }]);
  assert.deepEqual(proposedSteps(r), ['J:integrate', 'Z:publish', 'OK:start']);
  assert.deepEqual(r.blocked.map(b => b.mission), ['L', 'M', 'RP']);
  r = ready(p, { ...s, pauses: [pause('all', undefined, 'Gel général')] }).report;
  assert.deepEqual(proposedSteps(r), ['J:integrate', 'Z:publish']);
  assert.deepEqual(r.missions.OK.reasons, [{ code: 'paused', scope: 'all', since: T, reason: 'Gel général' }]);
  assert.equal(r.missions.A.outcome, 'active'); assert.equal(r.capacity.active, 1);
  assertEveryNonProposalExplained(r);
});

test('the CLI writes one JSON line on stdout, uses codes 0/2/3/4, leaves its inputs untouched and never reaches the network or the clock', async () => {
  await withTemp(async (temp) => {
    const planFile = join(temp, 'plan.json'), stateFile = join(temp, 'state.json');
    const planBytes = await readFile(examplePlan), stateBytes = await readFile(exampleState);
    await writeFile(planFile, planBytes); await writeFile(stateFile, stateBytes);
    const first = cli('ready', '--plan', planFile, '--state', stateFile);
    assert.equal(first.code, 0); assert.equal(first.stderr, ''); assert.equal(first.stdout.trim().split('\n').length, 1);
    const report = JSON.parse(first.stdout); assert.equal(report.command, 'ready'); assert.equal(report.reliable, true); assert.equal(report.proposals.length, 6);
    const second = cli('ready', '--plan', planFile, '--state', stateFile);
    assert.equal(second.stdout, first.stdout, 'deux exécutions identiques');
    const validateRun = cli('validate', '--plan', planFile, '--state', stateFile);
    assert.equal(validateRun.code, 0); assert.equal(JSON.parse(validateRun.stdout).command, 'validate'); assert.equal('proposals' in JSON.parse(validateRun.stdout), false);
    assert.deepEqual(await readFile(planFile), planBytes); assert.deepEqual(await readFile(stateFile), stateBytes);
    const missing = cli('validate', '--plan', planFile, '--state', join(temp, 'absent.json'));
    assert.equal(missing.code, 2); assert.deepEqual(JSON.parse(missing.stdout).errors.map(e => e.code), ['file_unreadable']); assert.equal(JSON.parse(missing.stdout).valid, false);
    await writeFile(join(temp, 'broken.json'), '{ not json');
    const broken = cli('ready', '--plan', join(temp, 'broken.json'), '--state', stateFile);
    assert.equal(broken.code, 2); const brokenReport = JSON.parse(broken.stdout); assert.equal(brokenReport.errors[0].code, 'json_invalid'); assert.deepEqual(brokenReport.proposals, []); assert.equal(brokenReport.reliable, false);
    await writeFile(join(temp, 'null.json'), JSON.stringify({ ...JSON.parse(stateBytes), capacity: { ...JSON.parse(stateBytes).capacity, maxActiveRuns: null } }));
    const unreliable = cli('ready', '--plan', planFile, '--state', join(temp, 'null.json'));
    assert.equal(unreliable.code, 3); assert.equal(JSON.parse(unreliable.stdout).reliable, false); assert.deepEqual(JSON.parse(unreliable.stdout).proposals, []);
    const invalid = cli('validate', '--plan', planFile, '--state', join(temp, 'null.json')); assert.equal(invalid.code, 0, 'validate ne juge pas la capacité');
    for (const args of [['launch'], ['ready', '--plan', planFile], ['ready', '--plan', planFile, '--state', stateFile, '--now'], ['validate', '--bogus']]) {
      const usage = cli(...args); assert.equal(usage.code, 4, args.join(' ')); assert.equal(usage.stdout, ''); assert.ok(usage.stderr.trim().length > 0);
    }
    const helpRun = cli('--help'); assert.equal(helpRun.code, 0); assert.match(helpRun.stdout, /validate --plan/);
  });
  const source = await readFile(script, 'utf8');
  for (const forbidden of ['fetch', 'Date', 'setTimeout', 'setInterval', 'child_process', 'node:http', 'node:net', 'writeFile', 'mkdir', 'process.env', 'Math.random']) assert.equal(source.includes(forbidden), false, `${forbidden} interdit dans l’outil`);
  const originalFetch = globalThis.fetch; globalThis.fetch = () => { throw new Error('réseau interdit'); };
  try { const lines = []; const code = await main(['ready', '--plan', examplePlan, '--state', exampleState], { log: line => lines.push(line) }); assert.equal(code, 0); assert.equal(lines.length, 1); assert.equal(JSON.parse(lines[0]).proposals.length, 6); }
  finally { globalThis.fetch = originalFetch; }
});

test('JSON data is only read through own properties: prototype names are ordinary keys, never inherited values', () => {
  // Mission « toString » sans entrée d’état : pending ⇒ start, jamais publish hérité d’Object.prototype.
  const proto = ready(plan([mission('toString', { priority: 1 }), mission('constructor', { priority: 2, dependencies: { start: [{ mission: 'toString', step: 'delivered' }] } })]), state());
  assert.equal(proto.code, exitCodes.ok);
  assert.deepEqual(proto.report.missions.toString, { status: 'pending', outcome: 'proposed', step: 'start', reasons: [] });
  assert.deepEqual(proto.report.missions.constructor, { status: 'pending', outcome: 'blocked', step: 'start', reasons: [{ code: 'dependency_unmet', on: { mission: 'toString', step: 'delivered' } }] });
  assert.deepEqual(proto.report.summary.byStatus, { pending: 2 });
  // Références non déclarées portant des noms du prototype ⇒ unknown_reference, pas une résolution silencieuse.
  const undeclared = validate(plan([mission('A', { repo: 'constructor', dependencies: { start: [{ mission: 'hasOwnProperty', step: 'delivered' }, { condition: 'valueof' }] } })]), state({}, { pauses: [{ scope: 'repo', target: 'toString', reason: 'x', since: T }], conditions: { constructor: { satisfied: true, evidence: 'e', at: T } } }));
  assert.equal(undeclared.code, exitCodes.invalid);
  assert.deepEqual(undeclared.report.errors.map(e => [e.code, e.path]), [['unknown_reference', '/missions/0/repo'], ['unknown_reference', '/missions/0/dependencies/start/0/mission'], ['unknown_reference', '/missions/0/dependencies/start/1/condition']]);
  const resource = validate(plan([mission('A', { reserves: { resources: ['to:string'] } })]), state());
  assert.deepEqual(codes(resource.report), ['unknown_reference']);
  const pauseAndProof = validate(plan([mission('A')]), state({}, { pauses: [{ scope: 'repo', target: 'toString', reason: 'x', since: T }], conditions: { constructor: { satisfied: true, evidence: 'e', at: T } } }));
  assert.deepEqual(pauseAndProof.report.errors.map(e => e.path), ['/pauses/0/target', '/conditions/constructor']);
  // Schéma : propriété racine inconnue « hasOwnProperty » refusée par additionalProperties:false ; required « toString » absent sur un objet vide.
  const rootKey = validate({ ...plan([mission('A')]), hasOwnProperty: true }, state());
  assert.equal(rootKey.code, exitCodes.invalid); assert.deepEqual(rootKey.report.errors[0], { code: 'schema_invalid', path: '/', message: 'propriété non permise : hasOwnProperty', file: 'plan' });
  assert.equal(validateSchema({ type: 'object', required: ['toString'] }, {}), false);
  assert.equal(validateSchema({ type: 'object', required: ['toString'] }, { toString: 1 }), true);
  assert.equal(validateSchema({ type: 'object', properties: { constructor: { type: 'string' } }, additionalProperties: false }, { constructor: 'x' }), true);
  assert.equal(validateSchema({ type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false }, { constructor: 'x' }), false);
  assert.throws(() => validateSchema({ $ref: '#/$defs/constructor' }, 1), UsageError, 'une référence de schéma ne résout pas Object.prototype');
  // Les vraies clés propres portant ces noms restent pleinement utilisables : dépôt, condition, mission, pause, preuve.
  const p = plan([mission('toString', { repo: 'constructor', priority: 1, dependencies: { start: [{ condition: 'constructor' }] } }), mission('valueOf', { repo: 'constructor', priority: 2, dependencies: { start: [{ mission: 'toString', step: 'delivered' }] }, reserves: { resources: ['to:string'] } }), mission('hasOwnProperty', { priority: 3, reserves: { resources: ['to:string'] } })],
    { repos: { constructor: { url: 'https://github.com/example/proto' }, kit: { url: 'https://github.com/example/kit' } }, resources: { 'to:string': 'Ressource nommée comme une méthode' }, conditions: { constructor: { check: 'c', proof: 'p' } } });
  const s = state({ toString: engaged('toString', 'delivered', { prUrl: 'https://github.com/example/proto/pull/1' }) }, { pauses: [{ scope: 'mission', target: 'hasOwnProperty', reason: 'Nom réservé ailleurs, pas ici', since: T }], conditions: { constructor: { satisfied: true, evidence: 'https://github.com/example/proto/pull/1#reception', at: T } } });
  const own = ready(p, s);
  assert.equal(own.code, exitCodes.ok); assert.deepEqual(own.report.errors, []);
  assert.deepEqual(proposedSteps(own.report), ['toString:integrate', 'valueOf:start']);
  assert.deepEqual(own.report.missions.hasOwnProperty.reasons, [{ code: 'paused', scope: 'mission', target: 'hasOwnProperty', since: T, reason: 'Nom réservé ailleurs, pas ici' }]);
  assert.deepEqual(own.report.summary, { missions: 3, byKind: { dev: 3 }, byStatus: { delivered: 1, pending: 2 } });
  assertEveryNonProposalExplained(own.report);
});

test('date-time values are checked as real UTC instants without any clock: calendar, time and offset ranges', () => {
  for (const good of ['2026-02-28T23:59:59Z', '2024-02-29T00:00:00.123+02:00', '2000-02-29T12:00:00Z', '2026-12-31T00:00:00-23:59', '2026-01-01T00:00:00.1Z', T]) assert.equal(validInstant(good), true, good);
  for (const bad of ['2026-13-45T25:61:61Z', '2026-02-30T00:00:00Z', '2023-02-29T00:00:00Z', '1900-02-29T00:00:00Z', '2026-04-31T00:00:00Z', '2026-00-10T00:00:00Z', '2026-01-00T00:00:00Z', '2026-01-01T24:00:00Z', '2026-01-01T00:60:00Z', '2026-01-01T00:00:60Z', '2026-01-01T00:00:00+24:00', '2026-01-01T00:00:00+02:60', '2026-01-01T00:00:00', '2026-01-01 00:00:00Z', '2026-01-01T00:00:00.1234Z', 20260101, null]) assert.equal(validInstant(bad), false, String(bad));
  const p = plan([mission('A')]);
  const root = validate(p, { ...state(), reconciledAt: '2026-13-45T25:61:61Z' });
  assert.equal(root.code, exitCodes.invalid); assert.deepEqual(root.report.errors.map(e => [e.code, e.path]), [['schema_invalid', '/reconciledAt']]); assert.match(root.report.errors[0].message, /^date-time/);
  const nested = validate(p, state({ A: engaged('A', 'active', { assignedAt: '2026-02-30T10:00:00Z' }) }, { capacity: { ...state().capacity, observedAt: '2026-06-31T00:00:00Z' }, pauses: [{ scope: 'all', reason: 'x', since: '2026-01-01T00:00:00+24:00' }], conditions: { 'ci-green': { satisfied: true, evidence: 'e', at: '2026-01-01T23:59:60Z' } } }));
  assert.equal(nested.code, exitCodes.invalid);
  assert.deepEqual(nested.report.errors.map(e => e.path), ['/capacity/observedAt', '/pauses/0/since', '/conditions/ci-green/at', '/missions/A/assignedAt']);
  assert.ok(nested.report.errors.every(e => e.code === 'schema_invalid' && e.file === 'state'));
  const leap = validate(p, { ...state(), reconciledAt: '2024-02-29T00:00:00+05:30' });
  assert.equal(leap.code, exitCodes.ok);
});
