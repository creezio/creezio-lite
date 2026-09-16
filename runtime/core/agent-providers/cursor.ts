// Adaptateur Cursor Cloud Agents API v1 — https://cursor.com/docs/cloud-agent/api/endpoints (vérifié le 16/09/2026).
// Méthodes typées, payloads limités aux champs documentés, réponses validées. Aucun retry,
// polling, stream, webhook, création de routine ni exécution d'outil.
import type {
  CursorAgent, CursorAgentStatus, CursorCancelResult, CursorCreateAgentInput, CursorCreateAgentResult, CursorGitBranch,
  CursorModel, CursorModelList, CursorModelParam, CursorProvider, CursorRepo, CursorRun, CursorRunStatus,
  ProviderClientOptions, ProviderRequestOptions,
} from './types.ts';
import { ProviderFailure } from './types.ts';
import {
  createTransport, expectArray, expectEnum, expectRecord, expectString, failCheck, optionalBoolean,
  optionalInteger, optionalString, rejectUnknownKeys, type Check,
} from './transport.ts';

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
export const cursorAgentIdPattern = new RegExp(`^bc-${UUID}$`);
export const cursorRunIdPattern = new RegExp(`^run-${UUID}$`);
export const cursorAgentStatuses: readonly CursorAgentStatus[] = Object.freeze(['ACTIVE', 'IDLE', 'ARCHIVED']);
export const cursorRunStatuses: readonly CursorRunStatus[] = Object.freeze(['CREATING', 'RUNNING', 'FINISHED', 'ERROR', 'CANCELLED', 'EXPIRED']);

export const cursorLimits = Object.freeze({
  promptChars: 200_000, nameChars: 100, repos: 20, modelParams: 16, models: 200, resultChars: 1_000_000, branches: 100,
});
const createAgentKeys = ['agentId', 'prompt', 'model', 'name', 'repos', 'env', 'workOnCurrentBranch', 'autoCreatePR', 'skipReviewerRequest', 'mode'] as const;
// Champs documentés mais exclus par le contrat : ils sont refusés explicitement, jamais transmis.
const forbiddenCreateKeys = ['envVars', 'mcpServers', 'customSubagents'] as const;

const input: Check = { provider: 'cursor', delivery: 'not_sent', code: 'invalid_request' };
const output: Check = { provider: 'cursor', delivery: 'responded', code: 'provider_response' };

export function assertCursorAgentId(value: unknown) {
  if (typeof value !== 'string' || !cursorAgentIdPattern.test(value)) failCheck(input, 'agentId');
  return value;
}
export function assertCursorRunId(value: unknown) {
  if (typeof value !== 'string' || !cursorRunIdPattern.test(value)) failCheck(input, 'runId');
  return value;
}

function repoUrl(check: Check, value: unknown, field: string) {
  const raw = expectString(check, value, field, 500);
  let url: URL;
  try { url = new URL(raw); } catch { return failCheck(check, field); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.hostname !== 'github.com' || !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(url.pathname)) failCheck(check, field);
  return url.toString().replace(/\/$/, '');
}
function prUrl(check: Check, value: unknown, field: string) {
  const raw = expectString(check, value, field, 500);
  let url: URL;
  try { url = new URL(raw); } catch { return failCheck(check, field); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.hostname !== 'github.com' || !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+\/?$/.test(url.pathname)) failCheck(check, field);
  return url.toString().replace(/\/$/, '');
}
function refName(check: Check, value: unknown, field: string) {
  const ref = expectString(check, value, field, 250);
  if (/[\s~^:?*[\\\x00-\x1f\x7f]|\.\.|^[-/]|\/$|\.lock$|@\{/.test(ref)) failCheck(check, field);
  return ref;
}
function repoEntries(check: Check, value: unknown, field: string, strict: boolean): CursorRepo[] {
  return expectArray(check, value, field, cursorLimits.repos).map((entry, index) => {
    const record = expectRecord(check, entry, `${field}[${index}]`);
    if (strict) rejectUnknownKeys(check, record, ['url', 'startingRef', 'prUrl'], `${field}[${index}]`);
    const repo: CursorRepo = { url: repoUrl(check, record.url, `${field}[${index}].url`) };
    if (record.startingRef !== undefined) repo.startingRef = refName(check, record.startingRef, `${field}[${index}].startingRef`);
    if (record.prUrl !== undefined) repo.prUrl = prUrl(check, record.prUrl, `${field}[${index}].prUrl`);
    return repo;
  });
}
function modelParams(check: Check, value: unknown, field: string): CursorModelParam[] {
  return expectArray(check, value, field, cursorLimits.modelParams).map((entry, index) => {
    const record = expectRecord(check, entry, `${field}[${index}]`);
    return { id: expectString(check, record.id, `${field}[${index}].id`, 100), value: expectString(check, record.value, `${field}[${index}].value`, 100) };
  });
}

// Validation stricte avant envoi : uniquement les champs documentés nécessaires.
export function buildCreateAgentPayload(raw: unknown) {
  const record = expectRecord(input, raw, 'input');
  for (const key of forbiddenCreateKeys) if (key in record) failCheck(input, key);
  rejectUnknownKeys(input, record, createAgentKeys, 'input');
  const agentId = assertCursorAgentId(record.agentId);
  const prompt = expectRecord(input, record.prompt, 'prompt');
  rejectUnknownKeys(input, prompt, ['text'], 'prompt');
  const text = expectString(input, prompt.text, 'prompt.text', cursorLimits.promptChars);
  if (!text.trim()) failCheck(input, 'prompt.text');
  const payload: Record<string, unknown> = { agentId, prompt: { text } };
  if (record.model !== undefined) {
    const model = expectRecord(input, record.model, 'model');
    rejectUnknownKeys(input, model, ['id', 'params'], 'model');
    const id = expectString(input, model.id, 'model.id', 200);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)) failCheck(input, 'model.id');
    payload.model = model.params === undefined ? { id } : { id, params: modelParams(input, model.params, 'model.params') };
  }
  if (record.name !== undefined) { const name = expectString(input, record.name, 'name', cursorLimits.nameChars); if (/[\r\n\0]/.test(name)) failCheck(input, 'name'); payload.name = name; }
  if (record.repos !== undefined) payload.repos = repoEntries(input, record.repos, 'repos', true);
  if (record.env !== undefined) {
    const env = expectRecord(input, record.env, 'env');
    rejectUnknownKeys(input, env, ['type', 'name'], 'env');
    const type = expectEnum(input, env.type, 'env.type', ['cloud', 'pool', 'machine'] as const);
    const out: Record<string, unknown> = { type };
    if (env.name !== undefined) { const name = expectString(input, env.name, 'env.name', 100); if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(name)) failCheck(input, 'env.name'); out.name = name; }
    // Un environnement Cursor nommé est exclusif des repos explicites (documentation officielle).
    if (type === 'cloud' && out.name !== undefined && payload.repos !== undefined) failCheck(input, 'env');
    payload.env = out;
  }
  for (const key of ['workOnCurrentBranch', 'autoCreatePR', 'skipReviewerRequest'] as const) {
    const flag = optionalBoolean(input, record[key], key);
    if (flag !== undefined) payload[key] = flag;
  }
  if (record.mode !== undefined) payload.mode = expectEnum(input, record.mode, 'mode', ['agent', 'plan'] as const);
  return payload as { agentId: string; prompt: { text: string } } & Record<string, unknown>;
}

function agentFromResponse(check: Check, value: unknown, field: string): CursorAgent {
  const record = expectRecord(check, value, field);
  const agentId = expectString(check, record.id, `${field}.id`, 100);
  if (!cursorAgentIdPattern.test(agentId)) failCheck(check, `${field}.id`);
  const agent: CursorAgent = { agentId, status: expectEnum(check, record.status, `${field}.status`, cursorAgentStatuses) };
  const name = optionalString(check, record.name, `${field}.name`, 500); if (name !== undefined) agent.name = name;
  const url = optionalString(check, record.url, `${field}.url`, 500); if (url !== undefined) agent.url = url;
  const latestRunId = optionalString(check, record.latestRunId, `${field}.latestRunId`, 100);
  if (latestRunId !== undefined) { if (!cursorRunIdPattern.test(latestRunId)) failCheck(check, `${field}.latestRunId`); agent.latestRunId = latestRunId; }
  const createdAt = optionalString(check, record.createdAt, `${field}.createdAt`, 64); if (createdAt !== undefined) agent.createdAt = createdAt;
  const updatedAt = optionalString(check, record.updatedAt, `${field}.updatedAt`, 64); if (updatedAt !== undefined) agent.updatedAt = updatedAt;
  if (record.repos !== undefined) agent.repos = repoEntries(check, record.repos, `${field}.repos`, false);
  const workOnCurrentBranch = optionalBoolean(check, record.workOnCurrentBranch, `${field}.workOnCurrentBranch`); if (workOnCurrentBranch !== undefined) agent.workOnCurrentBranch = workOnCurrentBranch;
  const autoCreatePR = optionalBoolean(check, record.autoCreatePR, `${field}.autoCreatePR`); if (autoCreatePR !== undefined) agent.autoCreatePR = autoCreatePR;
  return agent;
}

function runFromResponse(check: Check, value: unknown, field: string): CursorRun {
  const record = expectRecord(check, value, field);
  const runId = expectString(check, record.id, `${field}.id`, 100);
  if (!cursorRunIdPattern.test(runId)) failCheck(check, `${field}.id`);
  const agentId = expectString(check, record.agentId, `${field}.agentId`, 100);
  if (!cursorAgentIdPattern.test(agentId)) failCheck(check, `${field}.agentId`);
  const run: CursorRun = { runId, agentId, status: expectEnum(check, record.status, `${field}.status`, cursorRunStatuses) };
  const createdAt = optionalString(check, record.createdAt, `${field}.createdAt`, 64); if (createdAt !== undefined) run.createdAt = createdAt;
  const updatedAt = optionalString(check, record.updatedAt, `${field}.updatedAt`, 64); if (updatedAt !== undefined) run.updatedAt = updatedAt;
  const durationMs = optionalInteger(check, record.durationMs, `${field}.durationMs`); if (durationMs !== undefined) run.durationMs = durationMs;
  const result = optionalString(check, record.result, `${field}.result`, cursorLimits.resultChars); if (result !== undefined) run.result = result;
  if (record.git !== undefined && record.git !== null) {
    const git = expectRecord(check, record.git, `${field}.git`);
    const branches: CursorGitBranch[] = expectArray(check, git.branches, `${field}.git.branches`, cursorLimits.branches).map((entry, index) => {
      const branch = expectRecord(check, entry, `${field}.git.branches[${index}]`);
      const out: CursorGitBranch = { repoUrl: expectString(check, branch.repoUrl, `${field}.git.branches[${index}].repoUrl`, 500) };
      const name = optionalString(check, branch.branch, `${field}.git.branches[${index}].branch`, 250); if (name !== undefined) out.branch = name;
      const pr = optionalString(check, branch.prUrl, `${field}.git.branches[${index}].prUrl`, 500); if (pr !== undefined) out.prUrl = pr;
      return out;
    });
    run.git = { branches };
  }
  return run;
}

function modelsFromResponse(check: Check, value: unknown): CursorModelList {
  const record = expectRecord(check, value, 'response');
  const models = expectArray(check, record.items, 'items', cursorLimits.models).map((entry, index): CursorModel => {
    const item = expectRecord(check, entry, `items[${index}]`);
    const model: CursorModel = { id: expectString(check, item.id, `items[${index}].id`, 200), displayName: expectString(check, item.displayName, `items[${index}].displayName`, 200) };
    const description = optionalString(check, item.description, `items[${index}].description`, 2000); if (description !== undefined) model.description = description;
    if (item.aliases !== undefined && item.aliases !== null) model.aliases = expectArray(check, item.aliases, `items[${index}].aliases`, 50).map((alias, i) => expectString(check, alias, `items[${index}].aliases[${i}]`, 200));
    if (item.parameters !== undefined && item.parameters !== null) model.parameters = expectArray(check, item.parameters, `items[${index}].parameters`, 50).map((entry2, i) => {
      const parameter = expectRecord(check, entry2, `items[${index}].parameters[${i}]`);
      const values = expectArray(check, parameter.values, `items[${index}].parameters[${i}].values`, 50).map((entry3, j) => {
        const option = expectRecord(check, entry3, `items[${index}].parameters[${i}].values[${j}]`);
        const outValue: { value: string; displayName?: string } = { value: expectString(check, option.value, `items[${index}].parameters[${i}].values[${j}].value`, 200) };
        const displayName = optionalString(check, option.displayName, `items[${index}].parameters[${i}].values[${j}].displayName`, 200); if (displayName !== undefined) outValue.displayName = displayName;
        return outValue;
      });
      const out: { id: string; displayName?: string; values: { value: string; displayName?: string }[] } = { id: expectString(check, parameter.id, `items[${index}].parameters[${i}].id`, 100), values };
      const displayName = optionalString(check, parameter.displayName, `items[${index}].parameters[${i}].displayName`, 200); if (displayName !== undefined) out.displayName = displayName;
      return out;
    });
    if (item.variants !== undefined && item.variants !== null) model.variants = expectArray(check, item.variants, `items[${index}].variants`, 50).map((entry2, i) => {
      const variant = expectRecord(check, entry2, `items[${index}].variants[${i}]`);
      const out: { params: CursorModelParam[]; displayName: string; description?: string; isDefault?: boolean } = {
        params: modelParams(check, variant.params, `items[${index}].variants[${i}].params`),
        displayName: expectString(check, variant.displayName, `items[${index}].variants[${i}].displayName`, 200),
      };
      const description = optionalString(check, variant.description, `items[${index}].variants[${i}].description`, 2000); if (description !== undefined) out.description = description;
      const isDefault = optionalBoolean(check, variant.isDefault, `items[${index}].variants[${i}].isDefault`); if (isDefault !== undefined) out.isDefault = isDefault;
      return out;
    });
    return model;
  });
  return { models };
}

export function createCursorProvider(options: ProviderClientOptions): CursorProvider {
  const transport = createTransport('cursor', options);
  const encode = (id: string) => encodeURIComponent(id);
  return Object.freeze({
    provider: 'cursor' as const,
    async listModels(request: ProviderRequestOptions = {}) {
      return transport.request({ method: 'GET', path: '/v1/models', signal: request.signal, validate: data => modelsFromResponse(output, data) });
    },
    // Un 409 agent_id_conflict est renvoyé comme échec explicite : aucun second envoi, aucun nouvel identifiant.
    async createAgent(rawInput: CursorCreateAgentInput, request: ProviderRequestOptions = {}): Promise<CursorCreateAgentResult> {
      const payload = buildCreateAgentPayload(rawInput);
      return transport.request({
        method: 'POST', path: '/v1/agents', body: payload, signal: request.signal,
        validate: data => {
          const record = expectRecord(output, data, 'response');
          const agent = agentFromResponse(output, record.agent, 'agent');
          const run = runFromResponse(output, record.run, 'run');
          // Réconciliation : la réponse doit désigner l'agent demandé, sinon elle est refusée.
          if (agent.agentId !== payload.agentId || run.agentId !== payload.agentId) {
            throw new ProviderFailure({ provider: 'cursor', code: 'provider_response', delivery: 'responded', reason: 'identity_mismatch', field: 'agent.id' });
          }
          return { agent, run };
        },
      });
    },
    async getAgent(agentId: string, request: ProviderRequestOptions = {}) {
      const id = assertCursorAgentId(agentId);
      return transport.request({
        method: 'GET', path: `/v1/agents/${encode(id)}`, signal: request.signal,
        validate: data => {
          const agent = agentFromResponse(output, data, 'agent');
          if (agent.agentId !== id) throw new ProviderFailure({ provider: 'cursor', code: 'provider_response', delivery: 'responded', reason: 'identity_mismatch', field: 'id' });
          return agent;
        },
      });
    },
    async getRun(agentId: string, runId: string, request: ProviderRequestOptions = {}) {
      const id = assertCursorAgentId(agentId), run = assertCursorRunId(runId);
      return transport.request({
        method: 'GET', path: `/v1/agents/${encode(id)}/runs/${encode(run)}`, signal: request.signal,
        validate: data => {
          const result = runFromResponse(output, data, 'run');
          if (result.runId !== run || result.agentId !== id) throw new ProviderFailure({ provider: 'cursor', code: 'provider_response', delivery: 'responded', reason: 'identity_mismatch', field: 'id' });
          return result;
        },
      });
    },
    // Aucune réussite inventée : un délai ou un 409 run_not_cancellable remonte comme échec typé.
    async cancelRun(agentId: string, runId: string, request: ProviderRequestOptions = {}) {
      const id = assertCursorAgentId(agentId), run = assertCursorRunId(runId);
      return transport.request({
        method: 'POST', path: `/v1/agents/${encode(id)}/runs/${encode(run)}/cancel`, signal: request.signal,
        validate: (data): CursorCancelResult => {
          const record = expectRecord(output, data, 'response');
          const returned = expectString(output, record.id, 'id', 100);
          if (returned !== run) throw new ProviderFailure({ provider: 'cursor', code: 'provider_response', delivery: 'responded', reason: 'identity_mismatch', field: 'id' });
          return { runId: returned };
        },
      });
    },
  });
}