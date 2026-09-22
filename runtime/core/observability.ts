import type { ApiContext, Workspace } from './types.ts';
import type { Operation } from './operations.ts';
import { coreOperations, matchOperation } from './operations.ts';
import { json, readJson } from './http.ts';
import { fail, requireRole, boundedInteger } from './validation.ts';
import { getProductivityReport } from './productivity.ts';

/** Per-workspace ceiling of stored request rows and their maximum age. Both are enforced on every write and on every read. */
export const CAPACITY=1000;
export const RETENTION_DAYS=30;
/** Neutral labels: an unresolved route or tool name is never copied into the diagnostics. */
export const UNKNOWN_ROUTE='/api/v1/[route-inconnue]';
export const UNKNOWN_TOOL='[outil-inconnu]';
export const MCP_PATH='/api/mcp';
export const REQUEST_ID_HEADER='x-lite-request-id';
const JSONRPC_METHODS=new Set(['initialize','ping','tools/list','tools/call','notifications/initialized','notifications/cancelled']);
const HTTP_METHODS=new Set(['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS']);
const CREDENTIALS=new Set(['session','api_key','oauth']);
const TOOL=/^(?:lite|custom)_[a-z][a-z0-9_]{0,120}$/,UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Generic code stored whenever a response carries anything outside the closed list below. The raw value is never kept. */
export const GENERIC_ERROR_CODE='error';
/** Codes raised by `fail()` / `ApiError` in runtime/core and the native mounts. Adding a new code to the runtime requires adding it here; a test scans the sources for that. */
const RUNTIME_ERROR_CODES=[
  'access_denied','api_error','attachment_missing','attachments_limit','audio_required','authentication_required','client_not_found','command_required','conflict','conversation_busy','conversation_missing','database_unavailable',
  'empty_file','empty_response','essential_operation','executor_unavailable','file_not_found','files_unavailable','folder_invalid','forbidden','generated_tool','group_limit','group_not_found','host_runner_unavailable',
  'imap_required','imap_response','integration_missing','integration_required','internal_error','invalid_account','invalid_arguments','invalid_assignee','invalid_attachment','invalid_attachments','invalid_boolean',
  'invalid_client','invalid_client_metadata','invalid_data','invalid_date','invalid_duration','invalid_email','invalid_enabled','invalid_endpoint','invalid_event','invalid_events','invalid_field','invalid_filter','invalid_sort',
  'invalid_grant','invalid_header','invalid_host','invalid_id','invalid_inbound_token','invalid_invite','invalid_json','invalid_kind','invalid_label','invalid_members','invalid_model','invalid_name','invalid_nav_override',
  'invalid_number','invalid_option','invalid_order','invalid_origin','invalid_pagination','invalid_period','invalid_policy','invalid_port','invalid_position','invalid_priority','invalid_query','invalid_read',
  'invalid_recipients','invalid_redirect_uri','invalid_references','invalid_request','invalid_role','invalid_scope','invalid_search_settings','invalid_sender','invalid_slug','invalid_source','invalid_status',
  'invalid_target','invalid_text','invalid_tls','invalid_token','invalid_token_settings','invalid_tool','invalid_ui_result','invalid_window','invalid_window_kind','invite_not_found','invite_used','json_required',
  'mail_busy','mail_connection','mail_delivery_unknown','mail_domain','mail_gateway_required','mail_missing','mail_rejected','mail_required','mail_unconfigured','member_not_found','message_id_required','message_required',
  'method_not_allowed','model_required','module_not_found','not_draft','not_found','operation_forbidden','operation_not_exposable','owner_protected','password_required','payload_too_large','preference_owner',
  'preferences_too_large','provider_auth','provider_failure','provider_interrupted','provider_limit','provider_model','provider_quota','provider_redirect','provider_response','provider_stream','provider_timeout',
  'provider_tool','provider_unavailable','provider_unknown','provider_unreachable','query_too_long','read_only_token','record_not_found','required_field','round_limit','sender_required','service_unavailable',
  'setup_required','sites_identity','slug_exists','storage_unavailable','sync_busy','system_group','task_not_found','temporarily_unavailable','token_scope','token_workspace','too_many_terms','tool_exists',
  'tool_forbidden','tool_limit','tool_not_found','transcription_failed','trash_required','ui_action_closed','ui_forbidden','ui_run_closed','ui_target_required','unique_conflict','unknown_field','unknown_nav_entry','unknown_operation',
  'unreadable','unsupported_grant_type','unsupported_patch','unsupported_response_type','unsupported_test','vault_unavailable','version_conflict','version_required','websocket_required','websocket_unavailable',
  'account_invalid','activation_consumed','activation_invalid','auth_failed','auth_rate_limited','auth_unavailable','identifier_invalid','password_invalid','reset_consumed','reset_invalid',
  'window_inactive','workspace_limit','workspace_not_found',
] as const;
/** Codes returned as `{ok:false,error:'…'}` by the API kernel and the native mounts, and by the MCP transport before JSON-RPC. */
const KERNEL_ERROR_CODES=[
  'core_route_not_found','cross_layer_write_denied','cross_write_denied','db_unavailable','entry_id_required','invalid_body','invalid_path','meili_unavailable','module_not_mounted','not_archivable','outside_api_v1',
  'permission_denied','platform_not_mounted','plugin_not_mounted','scenario_invalide','sqlite_runtime_unavailable','unauthenticated','unsupported_notification','unsupported_protocol','use_archive','user_required',
] as const;
/** JSON-RPC 2.0 codes emitted by handleMcp, the request-log tool error marker, and the bounded HTTP fallback codes. */
const JSONRPC_ERROR_CODES=['-32700','-32600','-32601','-32602','-32603'] as const;
const LOG_ERROR_CODES=['tool_error',GENERIC_ERROR_CODE,...Array.from({length:500},(_,i)=>`http_${100+i}`)] as const;
export const KNOWN_ERROR_CODES:ReadonlySet<string>=new Set<string>([...RUNTIME_ERROR_CODES,...KERNEL_ERROR_CODES,...JSONRPC_ERROR_CODES,...LOG_ERROR_CODES]);
const SKIPPED_OPERATIONS=/^(?:logs\.|analytics\.|mcp\.(?:metrics|status)$|session\.(?:heartbeat|me)$)/;
const SKIPPED_PATHS=/^\/api\/v1\/(admin\/(request-logs|analytics|mcp\/(metrics|status))|analytics\/events|desktop\/heartbeat|auth\/me)/;

export type RequestCredential='session'|'api_key'|'oauth';
/** Mutable collector filled by the dispatcher while a request runs. Only catalogue identifiers and neutral labels enter it. */
export type RequestTrace={correlationId:string;credential:RequestCredential;operation?:string;tool?:string;jsonrpcMethod?:string;calls:{operation?:string;status:number}[]};
/** Closed diagnostic persisted in lite_request_logs.detail_json and returned by the admin listing. */
export type RequestDiagnostic={ok:boolean;error?:string;operation?:string;tool?:string;jsonrpcMethod?:string;calls?:{operation:string;status:number}[];correlationId?:string;credential?:RequestCredential;legacy?:true};

export function newRequestTrace(credential:RequestCredential='session'):RequestTrace{return {correlationId:crypto.randomUUID(),credential,calls:[]};}
export function jsonrpcLabel(value:unknown):string{return typeof value==='string'&&JSONRPC_METHODS.has(value)?value:'unknown';}
/** Membership in the closed list is the only test: a value that merely looks like an identifier (a phone number, a name, a token) is replaced by the generic code. */
export function errorCode(value:unknown):string{const text=typeof value==='number'&&Number.isInteger(value)?String(value):typeof value==='string'?value:'';return KNOWN_ERROR_CODES.has(text)?text:GENERIC_ERROR_CODE;}
/** Reads the code of a JSON error response: `{error:{code}}` (API and JSON-RPC), `{ok:false,error:'code'}` (kernel) or `{ok:false,error:message,code}` (native handler). */
function responseErrorCode(result:any):string{
  const error=result?.error;
  if(error&&typeof error==='object')return errorCode(error.code);
  if(typeof result?.code==='string')return errorCode(result.code);
  return errorCode(error);
}
const knownOperation=(catalog:Operation[],id:unknown)=>typeof id==='string'?catalog.find(o=>o.id===id):undefined;
const toolLabel=(value:unknown)=>value===UNKNOWN_TOOL||(typeof value==='string'&&TOOL.test(value))?value as string:undefined;
const knownCalls=(catalog:Operation[],value:unknown)=>Array.isArray(value)?value.slice(0,20).flatMap(step=>{const op=knownOperation(catalog,step?.operation);return op&&Number.isInteger(step.status)?[{operation:op.id,status:Number(step.status)}]:[];}):[];

/** Builds the closed diagnostic from a trace; every field is re-validated against the catalogue or a closed vocabulary. */
export function buildDiagnostic(catalog:Operation[],trace:RequestTrace,ok:boolean,error?:string):RequestDiagnostic{
  const op=knownOperation(catalog,trace.operation),tool=toolLabel(trace.tool),calls=knownCalls(catalog,trace.calls);
  return {ok,...(error?{error:errorCode(error)}:{}),...(op?{operation:op.id}:{}),...(tool?{tool}:{}),...(trace.jsonrpcMethod!==undefined?{jsonrpcMethod:jsonrpcLabel(trace.jsonrpcMethod)}:{}),...(calls.length?{calls}:{}),correlationId:UUID.test(trace.correlationId)?trace.correlationId:crypto.randomUUID(),credential:CREDENTIALS.has(trace.credential)?trace.credential:'session'};
}
export function retentionCutoff(now=Date.now()){return new Date(now-RETENTION_DAYS*86400000).toISOString();}

const safeText=(value:unknown,max=300)=>String(value??'').replace(/lite_[a-f0-9]{64}|Bearer\s+\S+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+/gi,'[masqué]').slice(0,max);
function safePath(path:unknown){try{return new URL(String(path),'https://local.invalid').pathname.slice(0,300);}catch{return '';}}
/** Kept for the assistant conversation trace; the request log no longer stores arbitrary payloads. */
export function redactDiagnostic(value:unknown,depth=0):unknown {
  if(depth>5)return '[…]';if(value===undefined||value===null)return null;
  if(typeof value==='string')return safeText(value,400);
  if(typeof value==='number'||typeof value==='boolean')return value;
  if(Array.isArray(value))return value.slice(0,20).map(v=>redactDiagnostic(v,depth+1));
  if(typeof value==='object')return Object.fromEntries(Object.entries(value).slice(0,40).map(([k,v])=>[k,/password|passwd|secret|token|authorization|cookie|api.?key|jwt|bearer|credential/i.test(k)?'[masqué]':redactDiagnostic(v,depth+1)]));
  return null;
}

export async function persistRequestLog(request:Request,response:Response,c:ApiContext,org:Workspace,source:'api'|'mcp',started:number,trace:RequestTrace){
  const pathname=new URL(request.url).pathname,catalog=c.operations??coreOperations(c.app);
  if(SKIPPED_OPERATIONS.test(trace.operation??'')||SKIPPED_PATHS.test(pathname))return;
  let ok=response.ok,error:string|undefined;
  if(response.headers.get('content-type')?.includes('json')&&(source==='mcp'||!response.ok)){
    const result=await response.clone().json().catch(()=>null) as any;
    const rpcError=result?.error,toolError=result?.result?.isError===true;
    if(rpcError||toolError){ok=false;error=toolError?'tool_error':responseErrorCode(result);}
  }
  if(!ok&&!error)error=errorCode(`http_${response.status}`);
  const diagnostic=buildDiagnostic(catalog,trace,ok,error);
  const path=source==='mcp'?MCP_PATH:knownOperation(catalog,diagnostic.operation)?.path??UNKNOWN_ROUTE;
  await c.env.DB.batch<Record<string,any>>([
    c.env.DB.prepare('INSERT INTO lite_request_logs(id,org_id,user_id,source,method,path,status,duration_ms,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),org.id,c.identity!.userId,source,HTTP_METHODS.has(request.method)?request.method:'OTHER',path,response.status,Math.max(0,Math.round(performance.now()-started)),JSON.stringify(diagnostic),new Date().toISOString()),
    c.env.DB.prepare('DELETE FROM lite_request_logs WHERE org_id=? AND created_at<?').bind(org.id,retentionCutoff()),
    c.env.DB.prepare('DELETE FROM lite_request_logs WHERE org_id=? AND id NOT IN (SELECT id FROM lite_request_logs WHERE org_id=? ORDER BY created_at DESC,id DESC LIMIT ?)').bind(org.id,org.id,CAPACITY),
  ]);
}

export type StoredRequestLog={id:string;ts:string;source:string;method:string;path:string;status:number;durationMs:number;detail_json:string};
/** Projects a stored row onto the closed vocabulary. Rows written before this minimisation carry no correlation id: only their status, error code and JSON-RPC method survive, and their path is re-resolved through the catalogue. */
export function projectRequestLog(row:StoredRequestLog,catalog:Operation[]){
  let stored:Record<string,any>={};try{const parsed=JSON.parse(String(row.detail_json));if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))stored=parsed;}catch{}
  const legacy=!UUID.test(String(stored.correlationId??'')),method=HTTP_METHODS.has(row.method)?row.method:'OTHER';
  const detail:RequestDiagnostic={ok:stored.ok===true,...(stored.error!==undefined&&stored.error!==null?{error:errorCode(stored.error)}:{}),...(stored.jsonrpcMethod!==undefined?{jsonrpcMethod:jsonrpcLabel(stored.jsonrpcMethod)}:{})};
  let path:string;
  if(legacy){detail.legacy=true;path=row.path===MCP_PATH?MCP_PATH:matchOperation(catalog,method,safePath(row.path))?.path??UNKNOWN_ROUTE;}
  else{
    const op=knownOperation(catalog,stored.operation),tool=toolLabel(stored.tool),calls=knownCalls(catalog,stored.calls);
    Object.assign(detail,op?{operation:op.id}:{},tool?{tool}:{},calls.length?{calls}:{},{correlationId:stored.correlationId as string},CREDENTIALS.has(stored.credential)?{credential:stored.credential as RequestCredential}:{});
    path=row.path===MCP_PATH||row.path===UNKNOWN_ROUTE||catalog.some(o=>o.path===row.path)?row.path:UNKNOWN_ROUTE;
  }
  return {id:row.id,ts:row.ts,source:row.source==='mcp'?'mcp':'api',method,path,status:Number(row.status),durationMs:Number(row.durationMs),detail};
}

export async function observabilityRoute(request:Request,c:ApiContext,org:Workspace):Promise<Response|null>{
  const url=new URL(request.url),path=url.pathname.replace('/api/v1/',''),db=c.env.DB;
  if(!['analytics/events','admin/request-logs'].includes(path)&&!path.startsWith('admin/analytics/'))return null;
  if(path==='analytics/events'&&request.method==='POST'){
    const body=await readJson(request);if(!Array.isArray(body.events)||body.events.length>100)fail(400,'invalid_events','Maximum 100 événements par appel.');
    const events=body.events,now=Date.now();
    const types=new Set(['session.start','session.end','session.context','page.view','page.hide','ui.click','presence.heartbeat','presence.active','presence.idle','presence.idle_start','presence.blur','presence.focus']);
    const statements=events.map(e=>{
      if(!e||typeof e!=='object'||!types.has(e.eventType)||typeof e.createdAt!=='string'||!Number.isFinite(Date.parse(e.createdAt))||Math.abs(Date.parse(e.createdAt)-now)>86400000)fail(400,'invalid_event','Événement ou date invalide.');
      const duration=e.durationMs??0;if(typeof duration!=='number'||!Number.isFinite(duration)||duration<0||duration>86400000)fail(400,'invalid_duration','Durée invalide.');
      return db.prepare('INSERT INTO lite_usage_events(org_id,user_id,username,user_kind,user_role,event_type,category,label,path,session_id,duration_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(org.id,c.identity!.userId,c.identity!.displayName,'human',org.role,e.eventType,safeText(e.category,80),safeText(e.label,160),safePath(e.path),safeText(e.sessionId,160),Math.round(duration),new Date(e.createdAt).toISOString());
    });
    if(statements.length)await db.batch(statements);return json({ok:true,accepted:statements.length});
  }
  requireRole(org.role,['owner','admin']);
  if(path==='admin/request-logs'){
    if(request.method==='DELETE'){await db.prepare('DELETE FROM lite_request_logs WHERE org_id=?').bind(org.id).run();return json({ok:true});}
    const conditions=['org_id=?','created_at>=?'],params:unknown[]=[org.id,retentionCutoff()],source=url.searchParams.get('source'),q=url.searchParams.get('q')??'';
    if(source&&source!=='all'){if(!['api','mcp'].includes(source))fail(400,'invalid_source','Source inconnue.');conditions.push('source=?');params.push(source);}
    if(url.searchParams.get('errorsOnly')==='1')conditions.push("(status>=400 OR json_extract(detail_json,'$.ok')=0)");
    if(q.length>120)fail(400,'invalid_query','Recherche trop longue.');
    const limit=boundedInteger(url.searchParams.get('limit'),200,1000),offset=boundedInteger(url.searchParams.get('offset'),0,100000),where=conditions.join(' AND ');
    const select=`SELECT id,created_at AS ts,source,method,path,status,duration_ms AS durationMs,detail_json FROM lite_request_logs WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT ?`;
    const catalog=c.operations??coreOperations(c.app),project=(row:Record<string,any>)=>projectRequestLog(row as StoredRequestLog,catalog);
    if(q){
      // Free text only ever meets the projected vocabulary: stored values that fail validation are neither shown nor searchable, and legacy rows are skipped.
      const needle=q.toLowerCase(),all=(await db.prepare(select).bind(...params,CAPACITY).all<Record<string,any>>()).results.map(project);
      const matches=all.filter(({path,detail})=>!detail.legacy&&[path,detail.operation,detail.tool,detail.error,detail.jsonrpcMethod,detail.correlationId,...(detail.calls??[]).map(call=>call.operation)].some(value=>typeof value==='string'&&value.toLowerCase().includes(needle)));
      return json({logs:matches.slice(offset,offset+limit),total:matches.length,capacity:CAPACITY,retentionDays:RETENTION_DAYS});
    }
    const [logs,count]=await db.batch<Record<string,any>>([db.prepare(`${select} OFFSET ?`).bind(...params,limit,offset),db.prepare(`SELECT COUNT(*) AS n FROM lite_request_logs WHERE ${where}`).bind(...params)]);
    return json({logs:logs.results.map(project),total:count.results[0]?.n??0,capacity:CAPACITY,retentionDays:RETENTION_DAYS});
  }
  if(path==='admin/analytics/events'&&request.method==='DELETE'){await db.prepare('DELETE FROM lite_usage_events WHERE org_id=?').bind(org.id).run();return json({ok:true});}
  const period=url.searchParams.get('period')??'week',days=({day:1,week:7,month:30,year:365} as Record<string,number>)[period];if(!days)fail(400,'invalid_period','Période inconnue.');
  const to=url.searchParams.get('to')??new Date().toISOString(),from=url.searchParams.get('from')??new Date(Date.parse(to)-days*86400000).toISOString();
  if(!Number.isFinite(Date.parse(from))||!Number.isFinite(Date.parse(to))||Date.parse(from)>Date.parse(to)||Date.parse(to)-Date.parse(from)>366*86400000)fail(400,'invalid_period','Dates invalides.');
  const conditions=['org_id=?','created_at>=?','created_at<=?'],params:unknown[]=[org.id,new Date(from).toISOString(),new Date(to).toISOString()],kind=url.searchParams.get('kind')??'all',userId=url.searchParams.get('userId')??undefined;
  if(!['all','human','ai'].includes(kind))fail(400,'invalid_kind','Type inconnu.');
  if(kind!=='all'){conditions.push('user_kind=?');params.push(kind);}if(userId){conditions.push('user_id=?');params.push(userId);}
  const where=conditions.join(' AND '),limit=boundedInteger(url.searchParams.get('limit'),80,200),offset=boundedInteger(url.searchParams.get('offset'),0,100000);
  const rows=async(sql:string,extra:unknown[]=[]) => (await db.prepare(sql).bind(...params,...extra).all()).results;
  const metrics="COUNT(*) AS events, SUM(event_type='page.view') AS pageViews, SUM(event_type='ui.click') AS clicks, COUNT(DISTINCT session_id) AS sessions, COALESCE(SUM(CASE WHEN event_type='page.hide' THEN duration_ms ELSE 0 END),0) AS timeMs";
  const action=path.split('/').at(-1);
  if(action==='overview'){
    const r=(await rows(`SELECT ${metrics}, COUNT(DISTINCT user_id) AS activeUsers,COUNT(DISTINCT CASE WHEN user_kind='human' THEN user_id END) AS activeHumans,COUNT(DISTINCT CASE WHEN user_kind='ai' THEN user_id END) AS activeAi FROM lite_usage_events WHERE ${where}`))[0];
    const byKind=await rows(`SELECT user_kind AS kind,COUNT(*) AS events,COUNT(DISTINCT user_id) AS users,COALESCE(SUM(CASE WHEN event_type='page.hide' THEN duration_ms ELSE 0 END),0) AS timeMs FROM lite_usage_events WHERE ${where} GROUP BY user_kind`);
    return json({period:{from,to},totals:{...r,pageViews:r.pageViews??0,clicks:r.clicks??0,totalTimeMs:r.timeMs,avgSessionTimeMs:Number(r.sessions)?Math.round(Number(r.timeMs)/Number(r.sessions)):0},byKind});
  }
  if(action==='timeline'){
    const format=period==='day'?'%Y-%m-%dT%H:00:00':period==='year'?'%Y-%m':'%Y-%m-%d';
    return json({points:await rows(`SELECT strftime('${format}',created_at) AS bucket,${metrics},COUNT(DISTINCT CASE WHEN user_kind='human' THEN user_id END) AS humans,COUNT(DISTINCT CASE WHEN user_kind='ai' THEN user_id END) AS ai FROM lite_usage_events WHERE ${where} GROUP BY bucket ORDER BY bucket`)});
  }
  if(action==='pages')return json({pages:await rows(`SELECT path,SUM(event_type='page.view') AS views,COUNT(DISTINCT user_id) AS uniqueUsers,COALESCE(AVG(CASE WHEN event_type='page.hide' THEN duration_ms END),0) AS avgTimeMs,COALESCE(SUM(CASE WHEN event_type='page.hide' THEN duration_ms ELSE 0 END),0) AS totalTimeMs FROM lite_usage_events WHERE ${where} AND event_type IN ('page.view','page.hide') GROUP BY path ORDER BY views DESC LIMIT ?`,[limit])});
  if(action==='clicks')return json({clicks:await rows(`SELECT label,COUNT(*) AS clicks,COUNT(DISTINCT user_id) AS uniqueUsers,COUNT(DISTINCT path) AS paths FROM lite_usage_events WHERE ${where} AND event_type='ui.click' GROUP BY label ORDER BY clicks DESC LIMIT ?`,[limit])});
  if(action==='users')return json({users:await rows(`SELECT user_id AS userId,MAX(username) AS username,user_kind AS kind,MAX(user_role) AS role,${metrics},MAX(created_at) AS lastSeen FROM lite_usage_events WHERE ${where} GROUP BY user_id,user_kind ORDER BY events DESC LIMIT ?`,[limit])});
  if(action==='events')return json({events:await rows(`SELECT id,created_at,event_type,category,label,path,username,user_kind,duration_ms FROM lite_usage_events WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`,[limit,offset]),total:(await rows(`SELECT COUNT(*) AS n FROM lite_usage_events WHERE ${where}`))[0]?.n??0});
  if(action==='productivity'){
    const events=await rows(`SELECT created_at,event_type,duration_ms,user_id,username,user_kind FROM lite_usage_events WHERE ${where} AND event_type!='session.context' ORDER BY created_at LIMIT 50001`);
    return json({...getProductivityReport(events.slice(0,50000) as any,{from,to,userId,kind}),truncated:events.length>50000});
  }
  fail(404,'not_found','Vue inconnue.');
}
