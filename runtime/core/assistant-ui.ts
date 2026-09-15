import type { ApiContext, Workspace } from './types.ts';
import { fail } from './validation.ts';
import { json, readJson } from './http.ts';
import { objectSchema, assertOperationAllowed } from './operations.ts';
import { validateSchema } from './tools.ts';

type ActionType = 'list_targets' | 'click' | 'type' | 'scroll';
type Emit = (event: string, data: unknown) => void;
const now = () => new Date().toISOString();
const timeoutMs = 30_000;
const target = { ref: { type: 'string', maxLength: 160 }, label: { type: 'string', maxLength: 160 } };
const definitions = [
  { type: 'list_targets', description: 'Repérer les éléments visibles dans la page de l’utilisateur. À appeler avant de cliquer ou de saisir ; réutiliser la référence retournée.', schema: objectSchema({ q: { type: 'string', maxLength: 120 } }) },
  { type: 'click', description: 'Cliquer réellement sur un élément de la page avec le curseur IA visible. Utiliser une référence de ui_list_targets. Le résultat confirme le clic, pas la réussite d’une opération métier.', schema: objectSchema(target) },
  { type: 'type', description: 'Saisir du texte dans un champ avec le curseur IA. Remplace son contenu. Maximum 1000 caractères. submit envoie le formulaire seulement si demandé par l’utilisateur. Les champs de secrets sont exclus.', schema: objectSchema({ ...target, text: { type: 'string', maxLength: 1000 }, submit: { type: 'boolean' } }, ['text']) },
  { type: 'scroll', description: 'Faire défiler la page visible vers le haut ou le bas avec le curseur IA.', schema: objectSchema({ direction: { type: 'string', enum: ['up', 'down'] } }, ['direction']) },
] as const;

/** Native browser capabilities are session-only; data tools retain the shared API/MCP registry. */
export function browserTools(c: ApiContext, org: Workspace, conversationId: string, runId: string, emit: Emit, signal: AbortSignal) {
  return definitions.map(d => ({
    name: `ui_${d.type}`, description: d.description, inputSchema: d.schema,
    async execute(args: unknown) {
      validateSchema(d.schema, args);
      const params = args as Record<string, unknown>;
      if ((d.type === 'click' || d.type === 'type') && !params.ref && !params.label) fail(400, 'ui_target_required', 'Repérez d’abord la cible avec ui_list_targets.');
      return dispatchUiAction(c, org, conversationId, runId, emit, d.type, params, signal);
    },
  }));
}

/** D1 connects distinct Worker requests; a process-local promise map would lose acknowledgements. */
export async function dispatchUiAction(c: ApiContext, org: Workspace, conversationId: string, runId: string, emit: Emit, type: ActionType, params: Record<string, unknown>, signal: AbortSignal) {
  signal.throwIfAborted();
  const id = crypto.randomUUID(), expiresAt = new Date(Date.now() + timeoutMs).toISOString();
  await c.env.DB.prepare('DELETE FROM lite_assistant_ui_actions WHERE org_id=? AND user_id=? AND expires_at<?').bind(org.id, c.identity!.userId, now()).run();
  const created = await c.env.DB.prepare(`INSERT INTO lite_assistant_ui_actions(id,conversation_id,org_id,user_id,run_id,status,expires_at)
    SELECT ?,id,org_id,user_id,?,'pending',? FROM lite_assistant_conversations WHERE id=? AND org_id=? AND user_id=? AND active_run=? AND locked_until>?`)
    .bind(id, runId, expiresAt, conversationId, org.id, c.identity!.userId, runId, now()).run();
  if (!created.meta.changes) fail(409, 'ui_run_closed', 'Cette réponse est terminée.');
  try {
    signal.throwIfAborted();
    emit('ui_action', { actionId: id, type, params, expiresAt });
    while (Date.now() < Date.parse(expiresAt)) {
      signal.throwIfAborted();
      const row = await c.env.DB.prepare('SELECT status,result_json FROM lite_assistant_ui_actions WHERE id=? AND org_id=? AND user_id=? AND run_id=?')
        .bind(id, org.id, c.identity!.userId, runId).first<{ status: string; result_json: string | null }>();
      if (!row) fail(409, 'ui_run_closed', 'Action interrompue.');
      if (row.status === 'completed') return JSON.parse(row.result_json!);
      await new Promise<void>((resolve, reject) => {
        const cancel = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, 500);
        signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) cancel();
      });
    }
    return { ok: false, error: 'Le navigateur n’a pas confirmé l’action dans les 30 secondes. Ne pas la déclarer réussie ni répéter automatiquement un clic qui pourrait avoir été effectué.' };
  } finally {
    await c.env.DB.prepare('DELETE FROM lite_assistant_ui_actions WHERE id=? AND org_id=? AND user_id=? AND run_id=?').bind(id, org.id, c.identity!.userId, runId).run();
  }
}

export async function uiActionRoute(request: Request, c: ApiContext, org: Workspace): Promise<Response | null> {
  const match = /^\/api\/v1\/assistant\/ui-actions\/([^/]+)\/(claim|result)$/.exec(new URL(request.url).pathname);
  if (!match || request.method !== 'POST') return null;
  // The dispatcher also checks the callback operation, current membership and origin.
  const op = c.operations?.find(o => o.id === 'assistant.chat');
  if (!op) fail(403, 'ui_forbidden', 'Assistant indisponible.');
  assertOperationAllowed(op, org);
  const result = match[2] === 'result' ? await readJson(request) : null;
  if (result && (typeof result.ok !== 'boolean' || JSON.stringify(result).length > 48_000)) fail(400, 'invalid_ui_result', 'Résultat navigateur invalide.');
  const where = `id=? AND org_id=? AND user_id=? AND status=? AND expires_at>? AND EXISTS (
    SELECT 1 FROM lite_assistant_conversations c WHERE c.id=conversation_id AND c.org_id=lite_assistant_ui_actions.org_id
    AND c.user_id=lite_assistant_ui_actions.user_id AND c.active_run=run_id AND c.locked_until>?)`;
  const time = now(), args = [decodeURIComponent(match[1]), org.id, c.identity!.userId, result ? 'claimed' : 'pending', time, time];
  const changed = result
    ? await c.env.DB.prepare(`UPDATE lite_assistant_ui_actions SET status='completed',result_json=? WHERE ${where}`).bind(JSON.stringify(result), ...args).run()
    : await c.env.DB.prepare(`UPDATE lite_assistant_ui_actions SET status='claimed' WHERE ${where}`).bind(...args).run();
  if (!changed.meta.changes) fail(409, 'ui_action_closed', 'Action inconnue, déjà traitée, expirée ou rattachée à un autre espace.');
  return json({ ok: true });
}
