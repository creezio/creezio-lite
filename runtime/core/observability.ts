import type { ApiContext, Workspace } from './types.ts';
import { json, readJson } from './http.ts';
import { fail, requireRole, boundedInteger } from './validation.ts';
import { getProductivityReport } from './productivity.ts';

const CAPACITY=1000;
const safeText=(value:unknown,max=300)=>String(value??'').replace(/lite_[a-f0-9]{64}|Bearer\s+\S+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+/gi,'[masqué]').slice(0,max);
export function redactDiagnostic(value:unknown,depth=0):unknown {
  if(depth>5)return '[…]';if(value===undefined||value===null)return null;
  if(typeof value==='string')return safeText(value,400);
  if(typeof value==='number'||typeof value==='boolean')return value;
  if(Array.isArray(value))return value.slice(0,20).map(v=>redactDiagnostic(v,depth+1));
  if(typeof value==='object')return Object.fromEntries(Object.entries(value).slice(0,40).map(([k,v])=>[k,/password|passwd|secret|token|authorization|cookie|api.?key|jwt|bearer|credential/i.test(k)?'[masqué]':redactDiagnostic(v,depth+1)]));
  return null;
}
function safePath(path:unknown){try{return new URL(String(path),'https://local.invalid').pathname.slice(0,300);}catch{return '';}}
export async function persistRequestLog(request:Request,response:Response,c:ApiContext,org:Workspace,source:'api'|'mcp',started:number,detail:Record<string,unknown>={}){
  const path=new URL(request.url).pathname;
  if(/^\/api\/v1\/(admin\/(request-logs|analytics|mcp\/(metrics|status))|analytics\/events|desktop\/heartbeat|auth\/me)/.test(path))return;
  let errorCode:string|undefined,ok=response.ok;
  if(response.headers.get('content-type')?.includes('json')&&(source==='mcp'||!response.ok)){
    const result=await response.clone().json().catch(()=>({})) as any;
    ok=ok&&!result.error&&!result.result?.isError;errorCode=result.error?.code??(result.result?.isError?'tool_error':undefined);
  }
  if(path.startsWith('/api/v1/email')||/^lite_mail_/.test(String(detail.tool??'')))detail={tool:detail.tool};
  const diagnostic={...redactDiagnostic(detail) as Record<string,unknown>,ok,...(errorCode?{error:safeText(errorCode,100)}:{}),userId:c.identity!.userId};
  await c.env.DB.batch<Record<string,any>>([
    c.env.DB.prepare('INSERT INTO lite_request_logs(id,org_id,user_id,source,method,path,status,duration_ms,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),org.id,c.identity!.userId,source,request.method,safePath(path),response.status,Math.max(0,Math.round(performance.now()-started)),JSON.stringify(diagnostic),new Date().toISOString()),
    c.env.DB.prepare('DELETE FROM lite_request_logs WHERE org_id=? AND id NOT IN (SELECT id FROM lite_request_logs WHERE org_id=? ORDER BY created_at DESC,id DESC LIMIT ?)').bind(org.id,org.id,CAPACITY),
  ]);
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
    const conditions=['org_id=?'],params:unknown[]=[org.id],source=url.searchParams.get('source'),q=url.searchParams.get('q')??'';
    if(source&&source!=='all'){if(!['api','mcp'].includes(source))fail(400,'invalid_source','Source inconnue.');conditions.push('source=?');params.push(source);}
    if(url.searchParams.get('errorsOnly')==='1')conditions.push("(status>=400 OR json_extract(detail_json,'$.ok')=0)");
    if(q){if(q.length>120)fail(400,'invalid_query','Recherche trop longue.');conditions.push('(instr(lower(path),lower(?))>0 OR instr(lower(detail_json),lower(?))>0)');params.push(q,q);}
    const limit=boundedInteger(url.searchParams.get('limit'),200,1000),offset=boundedInteger(url.searchParams.get('offset'),0,100000),where=conditions.join(' AND ');
    const [logs,count]=await db.batch<Record<string,any>>([db.prepare(`SELECT id,created_at AS ts,source,method,path,status,duration_ms AS durationMs,detail_json FROM lite_request_logs WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`).bind(...params,limit,offset),db.prepare(`SELECT COUNT(*) AS n FROM lite_request_logs WHERE ${where}`).bind(...params)]);
    return json({logs:logs.results.map(({detail_json,...r})=>({...r,detail:JSON.parse(String(detail_json))})),total:count.results[0]?.n??0,capacity:CAPACITY});
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
