// Port des transports fournisseurs (contrat D03, docs/contracts/agent-provider-transport.md).
// Ce fichier ne contient que des types et la classe d'erreur : aucun effet à l'import.

export type AgentProviderId = 'cursor' | 'xai';

export type ProviderCredential = {
  provider: AgentProviderId;
  key: string;
  enabled: boolean;
};

export type ProviderClientOptions = {
  // Closure serveur liée à une référence de coffre ET à l'org autorisée.
  // Résolution vivante avant chaque requête ; aucun cache de secret.
  resolveCredential: () => Promise<ProviderCredential>;
  fetch?: typeof globalThis.fetch; // injection de test, fetch serveur par défaut
  timeoutMs?: number;             // défaut 15 s, bornes explicites
  maxResponseBytes?: number;      // défaut 2 Mo, bornes explicites
};

export type ProviderRequestOptions = { signal?: AbortSignal };

export type ProviderFailureCode =
  | 'invalid_request' | 'credential_unavailable' | 'provider_auth'
  | 'provider_quota' | 'provider_rejected' | 'provider_redirect'
  | 'provider_timeout' | 'provider_unreachable' | 'provider_response';

export type DeliveryKnowledge = 'not_sent' | 'unknown' | 'responded';

// Précision sûre sur l'origine d'un échec ; jamais un extrait de corps ou de secret.
export type ProviderFailureReason =
  | 'caller_abort' | 'timeout' | 'network' | 'credential_missing' | 'credential_disabled'
  | 'credential_mismatch' | 'credential_malformed' | 'not_json' | 'too_large' | 'schema' | 'unknown_field'
  | 'unknown_status' | 'identity_mismatch' | 'redirect' | 'http_status';

export type ProviderFailureInit = {
  provider: AgentProviderId;
  code: ProviderFailureCode;
  delivery: DeliveryKnowledge;
  status?: number;
  providerCode?: string;
  retryAfterMs?: number;
  reason?: ProviderFailureReason;
  field?: string;
};

export const providerFailureMessages: Readonly<Record<ProviderFailureCode, string>> = Object.freeze({
  invalid_request: 'Requête fournisseur invalide : aucun appel émis.',
  credential_unavailable: 'Identifiant fournisseur indisponible, désactivé ou incompatible.',
  provider_auth: 'Le fournisseur refuse cet identifiant.',
  provider_quota: 'Le fournisseur signale une limite de quota ou de débit.',
  provider_rejected: 'Le fournisseur a rejeté la requête.',
  provider_redirect: 'Le fournisseur a renvoyé une redirection ; l’identifiant n’a pas été transmis.',
  provider_timeout: 'L’appel au fournisseur a été interrompu avant sa réponse.',
  provider_unreachable: 'Le fournisseur est injoignable ou en erreur interne.',
  provider_response: 'Réponse du fournisseur invalide ou non reconnue.',
});

// Échec typé : code fermé, statut HTTP éventuel, connaissance de livraison,
// code fournisseur d'une liste autorisée, Retry-After borné. Jamais de corps brut ni de secret.
export class ProviderFailure extends Error {
  readonly provider: AgentProviderId;
  readonly code: ProviderFailureCode;
  readonly delivery: DeliveryKnowledge;
  readonly status?: number;
  readonly providerCode?: string;
  readonly retryAfterMs?: number;
  readonly reason?: ProviderFailureReason;
  readonly field?: string;
  constructor(init: ProviderFailureInit) {
    super(providerFailureMessages[init.code]);
    this.name = 'ProviderFailure';
    this.provider = init.provider;
    this.code = init.code;
    this.delivery = init.delivery;
    if (init.status !== undefined) this.status = init.status;
    if (init.providerCode !== undefined) this.providerCode = init.providerCode;
    if (init.retryAfterMs !== undefined) this.retryAfterMs = init.retryAfterMs;
    if (init.reason !== undefined) this.reason = init.reason;
    if (init.field !== undefined) this.field = init.field;
  }
  toJSON() {
    return {
      provider: this.provider, code: this.code, delivery: this.delivery, status: this.status,
      providerCode: this.providerCode, retryAfterMs: this.retryAfterMs, reason: this.reason, field: this.field,
    };
  }
}

// Catalogue statique : capacité documentée, disponibilité du protocole, date et source de vérification.
// `transport: 'implemented'` décrit seulement ce code ; le module Agents applicatif n'est pas installé par ce lot.
export type ProviderCapability = {
  provider: AgentProviderId;
  id: string;
  label: string;
  protocol: string;
  transport: 'implemented' | 'deferred';
  requiresApplicationModule: true;
  documentedOn: string;
  source: string;
  note?: string;
};

// ----- Cursor Cloud Agents API v1 (https://cursor.com/docs/cloud-agent/api/endpoints) -----

export type CursorAgentStatus = 'ACTIVE' | 'IDLE' | 'ARCHIVED';
export type CursorRunStatus = 'CREATING' | 'RUNNING' | 'FINISHED' | 'ERROR' | 'CANCELLED' | 'EXPIRED';

export type CursorModelParam = { id: string; value: string };
export type CursorModel = {
  id: string;
  displayName: string;
  description?: string;
  aliases?: string[];
  parameters?: { id: string; displayName?: string; values: { value: string; displayName?: string }[] }[];
  variants?: { params: CursorModelParam[]; displayName: string; description?: string; isDefault?: boolean }[];
};
export type CursorModelList = { models: CursorModel[] };

export type CursorRepo = { url: string; startingRef?: string; prUrl?: string };
export type CursorEnv = { type: 'cloud' | 'pool' | 'machine'; name?: string };

// Payload limité aux champs documentés nécessaires. Pas d'envVars, mcpServers,
// customSubagents ni images : un objet contenant ces clés est refusé avant envoi.
export type CursorCreateAgentInput = {
  agentId: string; // bc-<uuid>, fourni par l'orchestrateur durable pour réconciliation
  prompt: { text: string };
  model?: { id: string; params?: CursorModelParam[] };
  name?: string;
  repos?: CursorRepo[];
  env?: CursorEnv;
  workOnCurrentBranch?: boolean;
  autoCreatePR?: boolean;
  skipReviewerRequest?: boolean;
  mode?: 'agent' | 'plan';
};

export type CursorAgent = {
  agentId: string;
  status: CursorAgentStatus;
  name?: string;
  url?: string;
  latestRunId?: string;
  createdAt?: string;
  updatedAt?: string;
  repos?: CursorRepo[];
  workOnCurrentBranch?: boolean;
  autoCreatePR?: boolean;
};

export type CursorGitBranch = { repoUrl: string; branch?: string; prUrl?: string };
export type CursorRun = {
  runId: string;
  agentId: string;
  status: CursorRunStatus;
  createdAt?: string;
  updatedAt?: string;
  durationMs?: number;
  result?: string;
  git?: { branches: CursorGitBranch[] };
};

export type CursorCreateAgentResult = { agent: CursorAgent; run: CursorRun };
export type CursorCancelResult = { runId: string };

export type CursorProvider = {
  readonly provider: 'cursor';
  listModels(options?: ProviderRequestOptions): Promise<CursorModelList>;
  createAgent(input: CursorCreateAgentInput, options?: ProviderRequestOptions): Promise<CursorCreateAgentResult>;
  getAgent(agentId: string, options?: ProviderRequestOptions): Promise<CursorAgent>;
  getRun(agentId: string, runId: string, options?: ProviderRequestOptions): Promise<CursorRun>;
  cancelRun(agentId: string, runId: string, options?: ProviderRequestOptions): Promise<CursorCancelResult>;
};

// ----- xAI Responses API (https://docs.x.ai/developers/rest-api-reference/inference/responses) -----

export type XaiModel = { id: string; aliases?: string[]; contextLength?: number; created?: number };
export type XaiModelList = { models: XaiModel[] };

export type XaiInputContent = { type: 'input_text'; text: string };
export type XaiInputItem =
  | { role: 'system' | 'developer' | 'user' | 'assistant'; content: string | XaiInputContent[] }
  | { type: 'function_call_output'; call_id: string; output: string };

export type XaiFunctionTool = {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
};
export type XaiToolChoice = 'auto' | 'none' | 'required' | { type: 'function'; name: string };

// Synchrone : stream:false, aucun background. `store` et le budget de sortie sont explicites.
export type XaiCreateResponseInput = {
  model: string;
  input: string | XaiInputItem[];
  maxOutputTokens: number;
  store: boolean;
  instructions?: string;
  previousResponseId?: string;
  tools?: XaiFunctionTool[];
  toolChoice?: XaiToolChoice;
  parallelToolCalls?: boolean;
  temperature?: number;
  topP?: number;
  reasoningEffort?: string;
  user?: string;
};

export type XaiResponseStatus = 'completed' | 'in_progress' | 'incomplete';
export type XaiOutputItem =
  | { type: 'message'; id?: string; status?: string; content: ({ type: 'output_text'; text: string } | { type: 'refusal'; refusal: string })[] }
  | { type: 'function_call'; id?: string; callId: string; name: string; arguments: string; status?: string }
  | { type: 'reasoning'; id?: string; summary: string[] };
export type XaiUsage = { inputTokens: number; outputTokens: number; totalTokens: number; reasoningTokens?: number; cachedTokens?: number };
export type XaiResponse = {
  id: string;
  status: XaiResponseStatus;
  model: string;
  store: boolean;
  output: XaiOutputItem[];
  omittedOutputItems: number;
  usage?: XaiUsage;
  incompleteReason?: string;
  previousResponseId?: string;
  errorCode?: string;
};

export type XaiProvider = {
  readonly provider: 'xai';
  listModels(options?: ProviderRequestOptions): Promise<XaiModelList>;
  createResponse(input: XaiCreateResponseInput, options?: ProviderRequestOptions): Promise<XaiResponse>;
};
