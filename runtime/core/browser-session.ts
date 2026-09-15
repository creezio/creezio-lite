import type { ApiContext, Workspace } from './types.ts';
import { json, readJson } from './http.ts';
import { fail } from './validation.ts';
import { assertOperationAllowed } from './operations.ts';

export const LEASE_MS = 20_000;
const now = () => new Date().toISOString();
export const windowId = (value: unknown) => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(value)) fail(400,'invalid_window','Identifiant de fenêtre invalide.');
  return value as string;
};
type Slot = { window_id:string; kind:string; lease_until:string; path:string };
export async function uiLog(c:ApiContext,org:Workspace,event:string,fields:{windowId?:string;actionId?:string;runId?:string;conversationId?:string;code?:string;status?:number;transport?:string;type?:string}={}) {
  // Only protocol metadata: never form text, DOM content, headers or credentials.
  const {windowId,actionId,runId,conversationId,...detail}=fields;
  await c.env.DB.prepare('INSERT INTO lite_browser_events(id,org_id,user_id,window_id,action_id,run_id,conversation_id,event,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(),org.id,c.identity!.userId,windowId??null,actionId??null,runId??null,conversationId??null,event,JSON.stringify(detail),now()).run();
}
export async function browserEvents(c:ApiContext,org:Workspace,conversationId?:string) {
  const rows=await c.env.DB.prepare(`SELECT id,window_id AS windowId,action_id AS actionId,run_id AS runId,conversation_id AS conversationId,event,detail_json,created_at AS createdAt FROM lite_browser_events WHERE org_id=? AND user_id=? ${conversationId?'AND conversation_id=?':''} ORDER BY created_at DESC,id DESC LIMIT 250`)
    .bind(org.id,c.identity!.userId,...(conversationId?[conversationId]:[])).all<{detail_json:string}>();
  return rows.results.map(({detail_json,...row})=>({...row,detail:JSON.parse(detail_json)}));
}
export async function activeDesktop(c:ApiContext,org:Workspace) {
  return c.env.DB.prepare("SELECT window_id,kind,lease_until,path FROM lite_browser_sessions WHERE org_id=? AND user_id=? AND kind='desktop' AND lease_until>?")
    .bind(org.id,c.identity!.userId,now()).first<Slot>();
}
export async function requireWindow(c:ApiContext,org:Workspace,id:string,desktop=false) {
  const row=await c.env.DB.prepare(`SELECT window_id,kind,lease_until,path FROM lite_browser_sessions WHERE org_id=? AND user_id=? AND window_id=? AND lease_until>? ${desktop?"AND kind='desktop'":''}`)
    .bind(org.id,c.identity!.userId,id,now()).first<Slot>();
  if(!row)fail(409,'window_inactive','Cette fenêtre n’est plus active. Reprenez la main pour continuer.');
  return row;
}
export async function sessionState(c:ApiContext,org:Workspace,id:string) {
  const rows=(await c.env.DB.prepare('SELECT window_id,kind,lease_until,path FROM lite_browser_sessions WHERE org_id=? AND user_id=? AND lease_until>?').bind(org.id,c.identity!.userId,now()).all<Slot>()).results;
  const mine=rows.find(r=>r.window_id===id),desktop=rows.find(r=>r.kind==='desktop');
  return {active:Boolean(mine),kind:mine?.kind??null,desktopConnected:Boolean(desktop),desktopPath:desktop?.path??null,leaseMs:LEASE_MS,serverTime:now(),workspaceId:org.id};
}
export async function pollWindow(c:ApiContext,org:Workspace,id:string,path?:string) {
  // Update only an existing, unexpired lease. An old window never takes over automatically.
  const cleanPath=typeof path==='string'&&path.startsWith('/')?path.split('?')[0].slice(0,300):'';
  await c.env.DB.prepare('UPDATE lite_browser_sessions SET lease_until=?,path=CASE WHEN ?=\'\' THEN path ELSE ? END WHERE org_id=? AND user_id=? AND window_id=? AND lease_until>?')
    .bind(new Date(Date.now()+LEASE_MS).toISOString(),cleanPath,cleanPath,org.id,c.identity!.userId,id,now()).run();
  const state=await sessionState(c,org,id);
  if(!state.active||state.kind!=='desktop')return {...state,actions:[]};
  const rows=await c.env.DB.prepare(`SELECT a.id,a.action_type,a.payload_json,a.expires_at FROM lite_assistant_ui_actions a JOIN lite_assistant_conversations c ON c.id=a.conversation_id
    WHERE a.org_id=? AND a.user_id=? AND a.target_window_id=? AND a.status='pending' AND a.expires_at>? AND c.active_run=a.run_id AND c.locked_until>? ORDER BY a.created_at LIMIT 8`)
    .bind(org.id,c.identity!.userId,id,now(),now()).all<{id:string;action_type:string;payload_json:string;expires_at:string}>();
  return {...state,actions:rows.results.map(a=>({actionId:a.id,type:a.action_type,params:JSON.parse(a.payload_json),expiresAt:a.expires_at,remainingMs:Math.max(0,Date.parse(a.expires_at)-Date.now())}))};
}
export async function browserSessionRoute(request:Request,c:ApiContext,org:Workspace):Promise<Response|null> {
  const path=new URL(request.url).pathname.replace('/api/v1/assistant/','');
  if(!path.startsWith('browser/'))return null;
  const op=c.operations?.find(o=>o.id==='assistant.chat');if(!op)fail(403,'ui_forbidden','Assistant indisponible.');assertOperationAllowed(op,org);
  if(path==='browser/diagnostics'&&request.method==='GET')return json({events:await browserEvents(c,org)});
  const body=await readJson(request),id=windowId(body.windowId);
  if(path==='browser/connect') {
    if(!['desktop','controller'].includes(String(body.kind)))fail(400,'invalid_window_kind','Type de fenêtre invalide.');
    const until=new Date(Date.now()+LEASE_MS).toISOString();
    const changed=await c.env.DB.prepare(`INSERT INTO lite_browser_sessions(org_id,user_id,kind,window_id,lease_until,path) VALUES(?,?,?,?,?,'')
      ON CONFLICT(org_id,user_id,kind) DO UPDATE SET window_id=excluded.window_id,lease_until=excluded.lease_until,path=''
      WHERE lite_browser_sessions.lease_until<=? OR lite_browser_sessions.window_id=excluded.window_id OR ?=1`)
      .bind(org.id,c.identity!.userId,body.kind,id,until,now(),body.takeover===true?1:0).run();
    await uiLog(c,org,changed.meta.changes?(body.takeover===true?'window.taken_over':'window.connected'):'window.blocked',{windowId:id});
    return json(await sessionState(c,org,id));
  }
  if(path==='browser/poll')return json(await pollWindow(c,org,id,typeof body.path==='string'?body.path:undefined));
  if(path==='browser/release') {
    await c.env.DB.prepare('DELETE FROM lite_browser_sessions WHERE org_id=? AND user_id=? AND window_id=?').bind(org.id,c.identity!.userId,id).run();
    await uiLog(c,org,'window.released',{windowId:id});return json({ok:true});
  }
  if(path==='browser/events') {
    await requireWindow(c,org,id);
    const allowed=['transport.fallback','transport.connected','driver.received','driver.executed','driver.error','driver.ack_failed','browser.error','browser.rejection'];
    if(!allowed.includes(String(body.event)))fail(400,'invalid_event','Événement invalide.');
    const action=typeof body.actionId==='string'?await c.env.DB.prepare('SELECT run_id,conversation_id FROM lite_assistant_ui_actions WHERE id=? AND org_id=? AND user_id=? AND target_window_id=?').bind(body.actionId,org.id,c.identity!.userId,id).first<{run_id:string;conversation_id:string}>():null;
    const code=typeof body.code==='string'&&/^[a-zA-Z0-9_.-]{1,80}$/.test(body.code)?body.code:undefined;
    await uiLog(c,org,String(body.event),{windowId:id,...(action?{actionId:String(body.actionId),runId:action.run_id,conversationId:action.conversation_id}:{}),code,status:typeof body.status==='number'?body.status:undefined,transport:body.transport==='websocket'?'websocket':'http'});
    return json({ok:true});
  }
  fail(404,'not_found','Route navigateur inconnue.');
}
