import type { ApiContext, Workspace } from './types.ts';
import { fail } from './validation.ts';
import { json, readJson } from './http.ts';
import { objectSchema, assertOperationAllowed } from './operations.ts';
import { validateSchema } from './tools.ts';
import { activeDesktop, requireWindow, uiLog, windowId } from './browser-session.ts';

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
export function browserTools(c: ApiContext, org: Workspace, conversationId: string, runId: string, emit: Emit, signal: AbortSignal, sourceWindow?:string) {
  let pinnedWindow:string|undefined;
  return definitions.map(d => ({
    name: `ui_${d.type}`, description: d.description, inputSchema: d.schema,
    async execute(args: unknown) {
      validateSchema(d.schema, args);
      const params = args as Record<string, unknown>;
      if ((d.type === 'click' || d.type === 'type') && !params.ref && !params.label) fail(400, 'ui_target_required', 'Repérez d’abord la cible avec ui_list_targets.');
      if(sourceWindow)await requireWindow(c,org,sourceWindow);
      if(!pinnedWindow){const desktop=await activeDesktop(c,org);if(!desktop)return {ok:false,code:'desktop_offline',error:'Aucune fenêtre d’ordinateur connectée. Ouvrez l’application sur votre ordinateur pour la piloter.'};pinnedWindow=desktop.window_id;}
      return dispatchUiAction(c, org, conversationId, runId, emit, d.type, params, signal,pinnedWindow);
    },
  }));
}

/** D1 connects distinct Worker requests; a process-local promise map would lose acknowledgements. */
export async function dispatchUiAction(c: ApiContext, org: Workspace, conversationId: string, runId: string, emit: Emit, type: ActionType, params: Record<string, unknown>, signal: AbortSignal, pinnedWindow?:string) {
  signal.throwIfAborted();
  const desktop=await activeDesktop(c,org);
  if(!desktop)return {ok:false,code:'desktop_offline',error:'Aucune fenêtre d’ordinateur connectée. Ouvrez l’application sur votre ordinateur pour la piloter.'};
  if(pinnedWindow&&desktop.window_id!==pinnedWindow)return {ok:false,code:'window_changed',error:'La fenêtre pilotée a changé. Relancez votre demande dans la fenêtre active.'};
  const targetWindow=desktop.window_id,id=crypto.randomUUID(),expiresAt=new Date(Date.now()+timeoutMs).toISOString();
  const fields={actionId:id,runId,conversationId,windowId:targetWindow,type};
  const created=await c.env.DB.prepare(`INSERT INTO lite_assistant_ui_actions(id,conversation_id,org_id,user_id,run_id,status,expires_at,target_window_id,action_type,payload_json,created_at)
    SELECT ?,id,org_id,user_id,?,'pending',?,?,?,?,? FROM lite_assistant_conversations WHERE id=? AND org_id=? AND user_id=? AND active_run=? AND locked_until>?`)
    .bind(id,runId,expiresAt,targetWindow,type,JSON.stringify(params),now(),conversationId,org.id,c.identity!.userId,runId,now()).run();
  if(!created.meta.changes)fail(409,'ui_run_closed','Cette réponse est terminée.');
  await uiLog(c,org,'action.queued',fields);
  let result:Record<string,unknown>={ok:false,code:'cancelled',error:'Action interrompue. Un clic déjà exécuté ne doit pas être répété automatiquement.'};
  try {
    // Notification only. Delivery comes from the durable per-window queue, even if SSE is buffered.
    emit('ui_action',{actionId:id,type,expiresAt});
    while(Date.now()<Date.parse(expiresAt)) {
      signal.throwIfAborted();
      const row=await c.env.DB.prepare('SELECT status,result_json FROM lite_assistant_ui_actions WHERE id=? AND org_id=? AND user_id=? AND run_id=?').bind(id,org.id,c.identity!.userId,runId).first<{status:string;result_json:string|null}>();
      if(!row)fail(409,'ui_run_closed','Action interrompue.');
      if(row.status==='completed'){result=JSON.parse(row.result_json!);return {...result,actionId:id};}
      const live=await activeDesktop(c,org);
      if(live?.window_id!==targetWindow){result={ok:false,code:'desktop_disconnected',error:'La fenêtre pilotée est déconnectée ou a été remplacée. Ne pas répéter un clic sans vérifier son résultat.'};break;}
      await new Promise<void>((resolve,reject)=>{const cancel=()=>{clearTimeout(timer);reject(signal.reason);};const timer=setTimeout(()=>{signal.removeEventListener('abort',cancel);resolve();},500);signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();});
      result={ok:false,code:row.status==='claimed'?'ack_timeout':'delivery_timeout',error:row.status==='claimed'?'Le navigateur a reçu la commande mais n’a pas confirmé son résultat. Ne répétez pas automatiquement un clic.':'Le navigateur n’a pas reçu la commande dans le délai prévu. Consultez les diagnostics de connexion.'};
    }
    return {...result,actionId:id};
  } finally {
    await c.env.DB.prepare("UPDATE lite_assistant_ui_actions SET status='completed',result_json=COALESCE(result_json,?),payload_json=NULL,completed_at=COALESCE(completed_at,?) WHERE id=? AND org_id=? AND user_id=? AND run_id=?")
      .bind(JSON.stringify(result),now(),id,org.id,c.identity!.userId,runId).run();
    await uiLog(c,org,result.ok?'action.completed':'action.failed',{...fields,code:typeof result.code==='string'?result.code:result.ok?undefined:'browser_error'});
  }
}

export async function uiActionRoute(request:Request,c:ApiContext,org:Workspace):Promise<Response|null> {
  const match=/^\/api\/v1\/assistant\/ui-actions\/([^/]+)\/(claim|check|result)$/.exec(new URL(request.url).pathname);
  if(!match||request.method!=='POST')return null;
  const op=c.operations?.find(o=>o.id==='assistant.chat');if(!op)fail(403,'ui_forbidden','Assistant indisponible.');assertOperationAllowed(op,org);
  const id=decodeURIComponent(match[1]),clientId=windowId(request.headers.get('x-lite-window'));
  const action=await c.env.DB.prepare('SELECT run_id,conversation_id FROM lite_assistant_ui_actions WHERE id=? AND org_id=? AND user_id=? AND target_window_id=?')
    .bind(id,org.id,c.identity!.userId,clientId).first<{run_id:string;conversation_id:string}>();
  const fields={actionId:id,windowId:clientId,runId:action?.run_id,conversationId:action?.conversation_id};
  try {
    await requireWindow(c,org,clientId,true);
    const result=match[2]==='result'?await readJson(request):null;
    if(result&&(typeof result.ok!=='boolean'||JSON.stringify(result).length>48000))fail(400,'invalid_ui_result','Résultat navigateur invalide.');
    const where=`id=? AND org_id=? AND user_id=? AND target_window_id=? AND status=? AND expires_at>? AND EXISTS (
      SELECT 1 FROM lite_assistant_conversations c WHERE c.id=conversation_id AND c.org_id=lite_assistant_ui_actions.org_id AND c.user_id=lite_assistant_ui_actions.user_id AND c.active_run=run_id AND c.locked_until>?)
      AND EXISTS (SELECT 1 FROM lite_browser_sessions s WHERE s.org_id=lite_assistant_ui_actions.org_id AND s.user_id=lite_assistant_ui_actions.user_id AND s.window_id=target_window_id AND s.kind='desktop' AND s.lease_until>?)`;
    const isCheck=match[2]==='check';
    const time=now(),args=[id,org.id,c.identity!.userId,clientId,result||isCheck?'claimed':'pending',time,time,time];
    if(isCheck){const current=await c.env.DB.prepare(`SELECT id FROM lite_assistant_ui_actions WHERE ${where}`).bind(...args).first();if(!current)fail(409,'ui_action_closed','Action interrompue ou fenêtre remplacée.');return json({ok:true});}
    const changed=result
      ?await c.env.DB.prepare(`UPDATE lite_assistant_ui_actions SET status='completed',result_json=?,payload_json=NULL,completed_at=? WHERE ${where}`).bind(JSON.stringify(result),time,...args).run()
      :await c.env.DB.prepare(`UPDATE lite_assistant_ui_actions SET status='claimed',claimed_at=? WHERE ${where}`).bind(time,...args).run();
    if(!changed.meta.changes)fail(409,'ui_action_closed','Action inconnue, déjà traitée, expirée ou rattachée à une autre fenêtre.');
    await uiLog(c,org,result?'action.acknowledged':'action.claimed',fields);
    return json({ok:true});
  }catch(e){await uiLog(c,org,'action.rejected',{...fields,code:e instanceof Error&&'code' in e?String(e.code):'unexpected'});throw e;}
}
