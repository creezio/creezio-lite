// Adaptateur xAI Responses API — https://docs.x.ai/developers/rest-api-reference/inference/responses et
// https://docs.x.ai/developers/tools/function-calling (vérifiés le 16/09/2026).
// Appel synchrone uniquement (stream:false, aucun background). Les outils et previous_response_id
// sont des champs validés transmis au fournisseur : l'adaptateur n'exécute aucun outil et ne
// transforme pas `completed` en validation métier. Aucun webhook ni API Grok Bot.
import type {
  ProviderClientOptions, ProviderRequestOptions, XaiCreateResponseInput, XaiFunctionTool, XaiInputItem, XaiModel, XaiModelList,
  XaiOutputItem, XaiProvider, XaiResponse, XaiResponseStatus, XaiUsage,
} from './types.ts';
import {
  createTransport, expectArray, expectEnum, expectRecord, expectString, failCheck, isRecord, optionalBoolean, optionalInteger,
  optionalString, rejectUnknownKeys, type Check,
} from './transport.ts';

export const xaiResponseStatuses: readonly XaiResponseStatus[] = Object.freeze(['completed', 'in_progress', 'incomplete']);
export const xaiLimits = Object.freeze({
  maxOutputTokens: 131_072, inputItems: 500, inputChars: 2_000_000, tools: 350, toolNameChars: 64, toolDescriptionChars: 4_000,
  toolSchemaChars: 100_000, models: 500, outputItems: 1_000, outputTextChars: 4_000_000,
});
const createResponseKeys = ['model', 'input', 'maxOutputTokens', 'store', 'instructions', 'previousResponseId', 'tools', 'toolChoice', 'parallelToolCalls', 'temperature', 'topP', 'reasoningEffort', 'user'] as const;
const inputRoles = ['system', 'developer', 'user', 'assistant'] as const;

const input: Check = { provider: 'xai', delivery: 'not_sent', code: 'invalid_request' };
const output: Check = { provider: 'xai', delivery: 'responded', code: 'provider_response' };

function modelId(check: Check, value: unknown, field: string) {
  const id = expectString(check, value, field, 200);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)) failCheck(check, field);
  return id;
}
function responseId(check: Check, value: unknown, field: string) {
  const id = expectString(check, value, field, 200);
  if (!/^[A-Za-z0-9_.:-]+$/.test(id)) failCheck(check, field);
  return id;
}
function callId(check: Check, value: unknown, field: string) {
  const id = expectString(check, value, field, 200);
  if (/[\s\x00-\x1f\x7f]/.test(id)) failCheck(check, field);
  return id;
}
function finiteNumber(check: Check, value: unknown, field: string, min: number, max: number) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) failCheck(check, field);
  return value;
}

function inputItems(raw: unknown): string | XaiInputItem[] {
  if (typeof raw === 'string') { if (!raw.trim() || raw.length > xaiLimits.inputChars) failCheck(input, 'input'); return raw; }
  let total = 0;
  const count = (text: string) => { total += text.length; if (total > xaiLimits.inputChars) failCheck(input, 'input'); return text; };
  const items = expectArray(input, raw, 'input', xaiLimits.inputItems).map((entry, index): XaiInputItem => {
    const field = `input[${index}]`;
    const record = expectRecord(input, entry, field);
    if (record.type === 'function_call_output') {
      rejectUnknownKeys(input, record, ['type', 'call_id', 'output'], field);
      return { type: 'function_call_output', call_id: callId(input, record.call_id, `${field}.call_id`), output: count(expectString(input, record.output, `${field}.output`, xaiLimits.inputChars, 0)) };
    }
    rejectUnknownKeys(input, record, ['role', 'content', 'type'], field);
    if (record.type !== undefined && record.type !== 'message') failCheck(input, `${field}.type`);
    const role = expectEnum(input, record.role, `${field}.role`, inputRoles);
    if (typeof record.content === 'string') return { role, content: count(expectString(input, record.content, `${field}.content`, xaiLimits.inputChars)) };
    const content = expectArray(input, record.content, `${field}.content`, 100).map((part, i) => {
      const partRecord = expectRecord(input, part, `${field}.content[${i}]`);
      if (partRecord.type !== 'input_text') failCheck(input, `${field}.content[${i}].type`);
      rejectUnknownKeys(input, partRecord, ['type', 'text'], `${field}.content[${i}]`);
      return { type: 'input_text' as const, text: count(expectString(input, partRecord.text, `${field}.content[${i}].text`, xaiLimits.inputChars)) };
    });
    if (!content.length) failCheck(input, `${field}.content`);
    return { role, content };
  });
  if (!items.length) failCheck(input, 'input');
  return items;
}

function isObjectSchema(schema: unknown): boolean {
  if (!isRecord(schema)) return false;
  if (schema.type === 'object') return true;
  for (const key of ['oneOf', 'anyOf'] as const) {
    if (Array.isArray(schema[key]) && (schema[key] as unknown[]).length > 0) return (schema[key] as unknown[]).every(branch => isRecord(branch) && branch.type === 'object');
  }
  return false;
}

function tools(raw: unknown): XaiFunctionTool[] {
  const names = new Set<string>();
  return expectArray(input, raw, 'tools', xaiLimits.tools).map((entry, index) => {
    const field = `tools[${index}]`;
    const record = expectRecord(input, entry, field);
    rejectUnknownKeys(input, record, ['type', 'name', 'description', 'parameters', 'strict'], field);
    if (record.type !== 'function') failCheck(input, `${field}.type`);
    const name = expectString(input, record.name, `${field}.name`, xaiLimits.toolNameChars);
    if (!/^[A-Za-z0-9_-]+$/.test(name) || names.has(name)) failCheck(input, `${field}.name`);
    names.add(name);
    const description = expectString(input, record.description, `${field}.description`, xaiLimits.toolDescriptionChars);
    // La racine du schéma doit être un objet ou une union d'objets (documentation officielle).
    if (!isObjectSchema(record.parameters)) failCheck(input, `${field}.parameters`);
    let serialized: string;
    try { serialized = JSON.stringify(record.parameters); } catch { return failCheck(input, `${field}.parameters`); }
    if (serialized.length > xaiLimits.toolSchemaChars) failCheck(input, `${field}.parameters`);
    const tool: XaiFunctionTool = { type: 'function', name, description, parameters: JSON.parse(serialized) as Record<string, unknown> };
    const strict = optionalBoolean(input, record.strict, `${field}.strict`); if (strict !== undefined) tool.strict = strict;
    return tool;
  });
}

// Validation stricte avant envoi : `store` explicite, budget de sortie borné, stream:false imposé.
export function buildCreateResponsePayload(raw: unknown) {
  const record = expectRecord(input, raw, 'input');
  rejectUnknownKeys(input, record, createResponseKeys, 'input');
  const model = modelId(input, record.model, 'model');
  if (typeof record.store !== 'boolean') failCheck(input, 'store');
  if (typeof record.maxOutputTokens !== 'number' || !Number.isInteger(record.maxOutputTokens) || record.maxOutputTokens < 1 || record.maxOutputTokens > xaiLimits.maxOutputTokens) failCheck(input, 'maxOutputTokens');
  const payload: Record<string, unknown> = { model, input: inputItems(record.input), max_output_tokens: record.maxOutputTokens, store: record.store, stream: false };
  if (record.previousResponseId !== undefined) payload.previous_response_id = responseId(input, record.previousResponseId, 'previousResponseId');
  if (record.instructions !== undefined) {
    // Incompatible avec previous_response_id selon la documentation : refus avant envoi.
    if (payload.previous_response_id !== undefined) failCheck(input, 'instructions');
    payload.instructions = expectString(input, record.instructions, 'instructions', xaiLimits.inputChars);
  }
  if (record.tools !== undefined) payload.tools = tools(record.tools);
  if (record.toolChoice !== undefined) {
    if (typeof record.toolChoice === 'string') payload.tool_choice = expectEnum(input, record.toolChoice, 'toolChoice', ['auto', 'none', 'required'] as const);
    else {
      const choice = expectRecord(input, record.toolChoice, 'toolChoice');
      rejectUnknownKeys(input, choice, ['type', 'name'], 'toolChoice');
      if (choice.type !== 'function') failCheck(input, 'toolChoice.type');
      const name = expectString(input, choice.name, 'toolChoice.name', xaiLimits.toolNameChars);
      if (!Array.isArray(payload.tools) || !(payload.tools as XaiFunctionTool[]).some(tool => tool.name === name)) failCheck(input, 'toolChoice.name');
      payload.tool_choice = { type: 'function', name };
    }
  }
  const parallel = optionalBoolean(input, record.parallelToolCalls, 'parallelToolCalls'); if (parallel !== undefined) payload.parallel_tool_calls = parallel;
  const temperature = finiteNumber(input, record.temperature, 'temperature', 0, 2); if (temperature !== undefined) payload.temperature = temperature;
  const topP = finiteNumber(input, record.topP, 'topP', 0, 1); if (topP !== undefined) payload.top_p = topP;
  if (record.reasoningEffort !== undefined) { const effort = expectString(input, record.reasoningEffort, 'reasoningEffort', 32); if (!/^[a-z][a-z0-9_-]*$/.test(effort)) failCheck(input, 'reasoningEffort'); payload.reasoning = { effort }; }
  if (record.user !== undefined) { const user = expectString(input, record.user, 'user', 256); if (/[\s\x00-\x1f\x7f]/.test(user)) failCheck(input, 'user'); payload.user = user; }
  return payload;
}

function usageFromResponse(check: Check, value: unknown): XaiUsage | undefined {
  if (value === undefined || value === null) return undefined;
  const record = expectRecord(check, value, 'usage');
  const inputTokens = optionalInteger(check, record.input_tokens, 'usage.input_tokens');
  const outputTokens = optionalInteger(check, record.output_tokens, 'usage.output_tokens');
  const totalTokens = optionalInteger(check, record.total_tokens, 'usage.total_tokens');
  if (inputTokens === undefined || outputTokens === undefined || totalTokens === undefined) failCheck(check, 'usage');
  const usage: XaiUsage = { inputTokens, outputTokens, totalTokens };
  if (isRecord(record.output_tokens_details)) { const reasoning = optionalInteger(check, record.output_tokens_details.reasoning_tokens, 'usage.output_tokens_details.reasoning_tokens'); if (reasoning !== undefined) usage.reasoningTokens = reasoning; }
  if (isRecord(record.input_tokens_details)) { const cached = optionalInteger(check, record.input_tokens_details.cached_tokens, 'usage.input_tokens_details.cached_tokens'); if (cached !== undefined) usage.cachedTokens = cached; }
  return usage;
}

function outputItem(check: Check, value: unknown, field: string): XaiOutputItem | null {
  const record = expectRecord(check, value, field);
  const id = optionalString(check, record.id, `${field}.id`, 200);
  const status = optionalString(check, record.status, `${field}.status`, 64);
  if (record.type === 'message') {
    if (record.role !== 'assistant') failCheck(check, `${field}.role`);
    const content = expectArray(check, record.content, `${field}.content`, 100).map((part, i) => {
      const partRecord = expectRecord(check, part, `${field}.content[${i}]`);
      if (partRecord.type === 'output_text') return { type: 'output_text' as const, text: expectString(check, partRecord.text, `${field}.content[${i}].text`, xaiLimits.outputTextChars, 0) };
      if (partRecord.type === 'refusal') return { type: 'refusal' as const, refusal: expectString(check, partRecord.refusal, `${field}.content[${i}].refusal`, xaiLimits.outputTextChars, 0) };
      return failCheck(check, `${field}.content[${i}].type`);
    });
    const item: XaiOutputItem = { type: 'message', content };
    if (id !== undefined) item.id = id; if (status !== undefined) item.status = status;
    return item;
  }
  if (record.type === 'function_call') {
    const item: XaiOutputItem = {
      type: 'function_call', callId: callId(check, record.call_id, `${field}.call_id`),
      name: expectString(check, record.name, `${field}.name`, xaiLimits.toolNameChars),
      arguments: expectString(check, record.arguments, `${field}.arguments`, xaiLimits.outputTextChars, 0),
    };
    if (id !== undefined) item.id = id; if (status !== undefined) item.status = status;
    return item;
  }
  if (record.type === 'reasoning') {
    const summary = record.summary === undefined || record.summary === null ? [] : expectArray(check, record.summary, `${field}.summary`, 100).map((part, i) => {
      const partRecord = expectRecord(check, part, `${field}.summary[${i}]`);
      return expectString(check, partRecord.text, `${field}.summary[${i}].text`, xaiLimits.outputTextChars, 0);
    });
    const item: XaiOutputItem = { type: 'reasoning', summary };
    if (id !== undefined) item.id = id;
    return item;
  }
  // Autres éléments (recherche web, etc.) : type connu du fournisseur mais non relayé par ce lot.
  if (typeof record.type !== 'string') failCheck(check, `${field}.type`);
  return null;
}

export function responseFromProvider(value: unknown): XaiResponse {
  const check = output;
  const record = expectRecord(check, value, 'response');
  if (record.object !== 'response') failCheck(check, 'object');
  const response: XaiResponse = {
    id: responseId(check, record.id, 'id'),
    status: expectEnum(check, record.status, 'status', xaiResponseStatuses),
    model: expectString(check, record.model, 'model', 200),
    store: typeof record.store === 'boolean' ? record.store : failCheck(check, 'store'),
    output: [],
    omittedOutputItems: 0,
  };
  for (const [index, entry] of expectArray(check, record.output, 'output', xaiLimits.outputItems).entries()) {
    const item = outputItem(check, entry, `output[${index}]`);
    if (item) response.output.push(item); else response.omittedOutputItems += 1;
  }
  const usage = usageFromResponse(check, record.usage); if (usage !== undefined) response.usage = usage;
  if (isRecord(record.incomplete_details)) { const reason = optionalString(check, record.incomplete_details.reason, 'incomplete_details.reason', 64); if (reason !== undefined) response.incompleteReason = reason; }
  const previous = optionalString(check, record.previous_response_id, 'previous_response_id', 200); if (previous) response.previousResponseId = previous;
  if (isRecord(record.error)) { const code = record.error.code; if (typeof code === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(code)) response.errorCode = code; else response.errorCode = 'unknown'; }
  return response;
}

function modelsFromResponse(value: unknown): XaiModelList {
  const check = output;
  const record = expectRecord(check, value, 'response');
  if (record.object !== 'list') failCheck(check, 'object');
  const models = expectArray(check, record.data, 'data', xaiLimits.models).map((entry, index): XaiModel => {
    const item = expectRecord(check, entry, `data[${index}]`);
    const model: XaiModel = { id: expectString(check, item.id, `data[${index}].id`, 200) };
    if (Array.isArray(item.aliases)) model.aliases = expectArray(check, item.aliases, `data[${index}].aliases`, 50).map((alias, i) => expectString(check, alias, `data[${index}].aliases[${i}]`, 200));
    const contextLength = optionalInteger(check, item.context_length, `data[${index}].context_length`); if (contextLength !== undefined) model.contextLength = contextLength;
    const created = optionalInteger(check, item.created, `data[${index}].created`); if (created !== undefined) model.created = created;
    return model;
  });
  return { models };
}

export function createXaiProvider(options: ProviderClientOptions): XaiProvider {
  const transport = createTransport('xai', options);
  return Object.freeze({
    provider: 'xai' as const,
    async listModels(request: ProviderRequestOptions = {}) {
      return transport.request({ method: 'GET', path: '/v1/models', signal: request.signal, validate: modelsFromResponse });
    },
    async createResponse(rawInput: XaiCreateResponseInput, request: ProviderRequestOptions = {}): Promise<XaiResponse> {
      const payload = buildCreateResponsePayload(rawInput);
      return transport.request({ method: 'POST', path: '/v1/responses', body: payload, signal: request.signal, validate: responseFromProvider });
    },
  });
}
