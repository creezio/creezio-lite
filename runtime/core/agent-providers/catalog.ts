// Catalogue statique des capacités documentées. `transport: 'implemented'` signifie qu'une
// méthode typée existe dans ce dossier ; le module Agents applicatif (coffre, identités, UI,
// tables) n'est pas installé par ce lot et reste à des missions ultérieures.
import type { ProviderCapability } from './types.ts';

const cursorSource = 'https://cursor.com/docs/cloud-agent/api/endpoints';
const xaiResponsesSource = 'https://docs.x.ai/developers/rest-api-reference/inference/responses';
const xaiToolsSource = 'https://docs.x.ai/developers/tools/function-calling';
const documentedOn = '2026-09-16';

const capabilities: ProviderCapability[] = [
  { provider: 'cursor', id: 'cursor.models.list', label: 'Lister les modèles Cursor', protocol: 'GET /v1/models', transport: 'implemented', requiresApplicationModule: true, documentedOn, source: cursorSource },
  { provider: 'cursor', id: 'cursor.agents.create', label: 'Créer un agent Cloud et son premier run', protocol: 'POST /v1/agents', transport: 'implemented', requiresApplicationModule: true, documentedOn, source: cursorSource, note: 'agentId bc-<uuid> imposé ; envVars, mcpServers, customSubagents et images refusés ; 409 agent_id_conflict remonté sans second envoi.' },
  { provider: 'cursor', id: 'cursor.agents.get', label: 'Lire un agent', protocol: 'GET /v1/agents/{id}', transport: 'implemented', requiresApplicationModule: true, documentedOn, source: cursorSource },
  { provider: 'cursor', id: 'cursor.runs.get', label: 'Lire un run', protocol: 'GET /v1/agents/{id}/runs/{runId}', transport: 'implemented', requiresApplicationModule: true, documentedOn, source: cursorSource },
  { provider: 'cursor', id: 'cursor.runs.cancel', label: 'Annuler un run', protocol: 'POST /v1/agents/{id}/runs/{runId}/cancel', transport: 'implemented', requiresApplicationModule: true, documentedOn, source: cursorSource, note: 'Un délai ou un 409 run_not_cancellable ne devient jamais une réussite.' },
  { provider: 'cursor', id: 'cursor.runs.create', label: 'Envoyer un prompt de suivi', protocol: 'POST /v1/agents/{id}/runs', transport: 'deferred', requiresApplicationModule: true, documentedOn, source: cursorSource, note: 'Hors périmètre D03 ; dépend de l’orchestrateur durable.' },
  { provider: 'cursor', id: 'cursor.runs.stream', label: 'Flux SSE d’un run', protocol: 'GET /v1/agents/{id}/runs/{runId}/stream', transport: 'deferred', requiresApplicationModule: true, documentedOn, source: cursorSource, note: 'Aucun flux ni polling dans ce lot.' },
  { provider: 'cursor', id: 'cursor.webhooks', label: 'Webhooks Cloud Agents', protocol: 'non disponible en v1', transport: 'deferred', requiresApplicationModule: true, documentedOn, source: cursorSource, note: 'Annoncés « coming soon » en v1 ; rien n’est inventé.' },
  { provider: 'xai', id: 'xai.models.list', label: 'Lister les modèles xAI', protocol: 'GET /v1/models', transport: 'implemented', requiresApplicationModule: true, documentedOn, source: 'https://docs.x.ai/developers/rest-api-reference/inference/models' },
  { provider: 'xai', id: 'xai.responses.create', label: 'Réponse synchrone (Responses API)', protocol: 'POST /v1/responses', transport: 'implemented', requiresApplicationModule: true, documentedOn, source: xaiResponsesSource, note: 'stream:false, aucun background ; store et max_output_tokens explicites ; sortie bornée et validée.' },
  { provider: 'xai', id: 'xai.tools.function', label: 'Déclaration d’outils fonction', protocol: 'tools[type=function] transmis dans POST /v1/responses', transport: 'implemented', requiresApplicationModule: true, documentedOn, source: xaiToolsSource, note: 'Validation du schéma (racine objet) et relais des appels d’outils ; aucune exécution locale.' },
  { provider: 'xai', id: 'xai.responses.background', label: 'Réponses en arrière-plan', protocol: 'background:true', transport: 'deferred', requiresApplicationModule: true, documentedOn, source: xaiResponsesSource, note: 'Documenté comme non pris en charge par xAI.' },
  { provider: 'xai', id: 'xai.grok-bot', label: 'API Grok Bot / webhooks', protocol: 'non documenté', transport: 'deferred', requiresApplicationModule: true, documentedOn, source: xaiResponsesSource, note: 'Aucune API officielle vérifiée ; différé.' },
];

export const agentProviderCapabilities: readonly ProviderCapability[] = Object.freeze(capabilities.map(capability => Object.freeze(capability)));
