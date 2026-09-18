import type { RequestAccessContext } from './access-profiles-store.ts';
import type { D1Database } from '@cloudflare/workers-types';
import type { AppDefinition, Identity, Principal, ScopeProvider, SqlFragment, Workspace } from './types.ts';
import { moduleRegistry, recordHref, visibleModules, type RegisteredModule } from './registry.ts';
import { boundedInteger, fail, requireRole } from './validation.ts';
import { json, readJson } from './http.ts';
import { canReadModule } from './operations.ts';
import { auditVisibility, fileScope, openScope, recordScope } from './scope.ts';

type SearchOptions={limit?:number;offset?:number;moduleId?:string;scope?:ScopeProvider;principal?:Principal;access?:RequestAccessContext};

const sources = ['records','tasks','files','support','members','audit','mail'];
type Override = {module_id:string;enabled:number;fields_json:string;version:number};
export type SearchPolicy = RegisteredModule & {search:{enabled:boolean;fields:string[]};version:number};
type SearchProgress = {source:string;cursor:string;complete:number};
function applySearchPolicies(app:AppDefinition,stored:Override[]):SearchPolicy[] {
  return moduleRegistry(app).map(m=>{
    const setting=stored.find(s=>s.module_id===m.id);
    return {...m,version:setting?.version??0,search:setting?{enabled:Boolean(setting.enabled),fields:(JSON.parse(setting.fields_json) as string[]).filter(key=>m.fields.some(f=>f.key===key))}:m.search};
  });
}
export async function searchPolicies(db:D1Database,app:AppDefinition,org:string):Promise<SearchPolicy[]> {
  const stored=await db.prepare('SELECT module_id,enabled,fields_json,version FROM lite_search_settings WHERE org_id=?').bind(org).all<Override>();
  return applySearchPolicies(app,stored.results);
}

/** Read current policies and index state in one trip; never cache permissions. */
async function searchContext(db:D1Database,app:AppDefinition,org:string) {
  const [settings,progress]=await db.batch([
    db.prepare('SELECT module_id,enabled,fields_json,version FROM lite_search_settings WHERE org_id=?').bind(org),
    db.prepare('SELECT source,cursor,complete FROM lite_search_progress WHERE org_id=?').bind(org),
  ]);
  return {policies:applySearchPolicies(app,settings.results as Override[]),indexing:await prepareSearchIndex(db,org,progress.results as SearchProgress[])};
}

/** Bounded, resumable backfill. A ready index needs no writes or source scans. */
export async function prepareSearchIndex(db:D1Database,org:string,progress?:SearchProgress[]) {
  const states=progress??(await db.prepare('SELECT source,cursor,complete FROM lite_search_progress WHERE org_id=?').bind(org).all<SearchProgress>()).results;
  const pending=sources.filter(source=>!states.some(state=>state.source===source&&state.complete));
  if(!pending.length)return false;
  const cursors=pending.map(source=>states.find(state=>state.source===source)?.cursor??'');
  // Fetch one extra key to distinguish a full final page from a partial backfill.
  const pages=await db.batch(pending.map((source,i)=>db.prepare(`SELECT source_key FROM lite_search_source_${source} WHERE org_id=? AND source=? AND source_key>? ORDER BY source_key LIMIT 51`).bind(org,source,cursors[i])));
  const writes=pending.flatMap((source,i)=>{
    const rows=pages[i].results as {source_key:string}[],last=rows.slice(0,50).at(-1)?.source_key??cursors[i];
    return [
      ...(rows.length?[db.prepare(`INSERT INTO lite_search_documents(org_id,module_id,record_id,data,updated_at)
        SELECT org_id,module_id,record_id,data,updated_at FROM lite_search_source_${source}
        WHERE org_id=? AND source=? AND source_key>? AND source_key<=?
        ON CONFLICT(org_id,module_id,record_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at`).bind(org,source,cursors[i],last)]:[]),
      db.prepare(`INSERT INTO lite_search_progress(org_id,source,cursor,complete) VALUES(?,?,?,?)
        ON CONFLICT(org_id,source) DO UPDATE SET cursor=excluded.cursor,complete=excluded.complete
        WHERE lite_search_progress.cursor=? AND lite_search_progress.complete=0`).bind(org,source,last,rows.length<=50?1:0,cursors[i]),
    ];
  });
  // Check the committed progress in the same transaction. Concurrent searches
  // may advance the cursor, but a stale batch must never move it backwards.
  const result=await db.batch([...writes,db.prepare(`SELECT COUNT(*) AS completed FROM lite_search_progress WHERE org_id=? AND complete=1 AND source IN (${sources.map(()=>'?').join(',')})`).bind(org,...sources)]);
  return (result.at(-1)?.results[0] as {completed:number}|undefined)?.completed!==sources.length;
}

export function searchTerms(query:string):string[] {
  if(query.length>120)fail(400,'query_too_long','Recherche limitée à 120 caractères.');
  const terms=[...new Set(query.normalize('NFKC').match(/[\p{L}\p{N}]+/gu)??[])];
  if(terms.length>8)fail(400,'too_many_terms','Utilisez au maximum huit mots.');
  return terms;
}

/** One predicate over lite_search_documents d: fileFilter for the files index, recordFilter for every other index. */
function searchScope(app:AppDefinition,org:Workspace,options:SearchOptions):SqlFragment&{ctes?:string}{
  const provided=Boolean(options.scope&&options.principal);
  const scope=provided?options.scope!:openScope,principal:Principal=provided?options.principal!:{userId:'',role:org.role,workspaceId:org.id,credential:'session'};
  const records=recordScope(scope,principal,{alias:'d',idColumn:'record_id',moduleColumn:'module_id'},'read',options.access);
  const files=fileScope(scope,principal,{alias:'d',idColumn:'record_id'},'read',options.access);
  if(!options.access)return {sql:`((d.module_id='files' AND ${files.sql}) OR (d.module_id<>'files' AND ${records.sql}))`,bindings:[...files.bindings,...records.bindings]};
  // MATERIALIZED fences keep complex application predicates out of the FTS/audit
  // expression tree. Every set is workspace-bound and filtered before ranking/counts.
  const auditRecords=recordScope(scope,principal,{alias:'r',idColumn:'id',moduleColumn:'module_id'},'read',options.access);
  const auditFiles=fileScope(scope,principal,{alias:'f',idColumn:'id'},'read',options.access);
  // Flat joins avoid D1 depth 100: nested EXISTS still expands materialized scopes.
  const audit=auditVisibility(app,org,options.access);
  const ctes=`search_visible_records AS MATERIALIZED (SELECT r.id FROM lite_records r WHERE r.org_id=? AND ${auditRecords.sql}),
    search_visible_files AS MATERIALIZED (SELECT f.id FROM lite_files f WHERE f.org_id=? AND ${auditFiles.sql}),
    search_visible_audit AS MATERIALIZED (
      SELECT a.id FROM lite_audit a WHERE a.org_id=? AND ${audit.recovery.sql}
      UNION SELECT a.id FROM lite_audit a
        JOIN lite_records r ON r.org_id=a.org_id AND r.id=a.resource_id
        JOIN search_visible_records vr ON vr.id=r.id WHERE a.org_id=? AND ${audit.records.sql}
      UNION SELECT a.id FROM lite_audit a
        JOIN lite_files f ON f.org_id=a.org_id AND f.id=a.resource_id
        JOIN search_visible_files vf ON vf.id=f.id WHERE a.org_id=? AND ${audit.files.sql}),
    search_visible_documents AS MATERIALIZED (
      SELECT d.id FROM lite_search_documents d JOIN search_visible_files vf ON vf.id=d.record_id WHERE d.org_id=? AND d.module_id='files'
      UNION ALL SELECT d.id FROM lite_search_documents d WHERE d.org_id=? AND d.module_id='audit' AND d.record_id IN (SELECT id FROM search_visible_audit)
      UNION ALL SELECT d.id FROM lite_search_documents d WHERE d.org_id=? AND d.module_id NOT IN ('files','audit') AND ${records.sql})`;
  return {ctes,sql:'d.id IN (SELECT id FROM search_visible_documents)',bindings:[org.id,...auditRecords.bindings,org.id,...auditFiles.bindings,org.id,...audit.recovery.bindings,org.id,...audit.records.bindings,org.id,...audit.files.bindings,org.id,org.id,org.id,...records.bindings]};
}

export async function searchSelection(db:D1Database,app:AppDefinition,org:Workspace,query:string,options:SearchOptions={}) {
  const terms=searchTerms(query);
  const context=await searchContext(db,app,org.id);
  const policies=context.policies.filter(m=>m.readRoles.includes(org.role)&&canReadModule(org,m.id,options.access)&&m.search.enabled&&m.search.fields.length&&(!options.moduleId||options.moduleId===m.id));
  const indexing=context.indexing;
  if(!terms.length||!policies.length)return {cte:'WITH ranked AS (SELECT id,0 AS score FROM lite_search_documents WHERE 0)',bindings:[],policies,indexing};
  // Policy filtering happens inside the query, before counts, excerpts and pagination.
  // One FTS row per field lets an administrator remove a field immediately.
  // The scope is evaluated in the same place: an out-of-scope document never becomes a match.
  // Documents of the files index obey fileFilter, exactly like the native files routes; every other index obeys recordFilter.
  const scope=searchScope(app,org,options);
  const allowed=JSON.stringify(policies.flatMap(m=>m.search.fields.map(field=>({module:m.id,field,title:field===m.titleField?1:0}))));
  const matches=`SELECT d.id,CAST(t.key AS INTEGER) AS term,CAST(json_extract(p.value,'$.title') AS INTEGER) AS title_match
    FROM json_each(?) t CROSS JOIN lite_search_fts JOIN lite_search_documents d ON d.id=lite_search_fts.document_id
    JOIN json_each(?) p ON json_extract(p.value,'$.module')=d.module_id AND json_extract(p.value,'$.field')=lite_search_fts.field_key
    WHERE lite_search_fts MATCH t.value AND d.org_id=? AND ${scope.sql}`;
  const bindings=[...(scope.ctes?scope.bindings:[]),JSON.stringify(terms.map(t=>'"'+t.replaceAll('"','""')+'"*')),allowed,org.id,...(scope.ctes?[]:scope.bindings)];
  const cte=`WITH ${scope.ctes?scope.ctes+', ':''}matches AS (${matches}), ranked AS (SELECT id,SUM(title_match) AS score FROM matches GROUP BY id HAVING COUNT(DISTINCT term)=?)`;
  return {cte,bindings:[...bindings,terms.length],policies,indexing};
}

export async function searchData(db:D1Database,app:AppDefinition,org:Workspace,query:string,options:SearchOptions={}) {
  const {cte,bindings,policies,indexing}=await searchSelection(db,app,org,query,options);
  const terms=searchTerms(query),limit=options.limit??30,offset=options.offset??0;
  const [found,count]=await db.batch([
    db.prepare(`${cte} SELECT d.module_id,d.record_id,d.data,d.updated_at,r.score FROM ranked r JOIN lite_search_documents d ON d.id=r.id ORDER BY r.score DESC,d.updated_at DESC,d.id LIMIT ? OFFSET ?`).bind(...bindings,limit,offset),
    db.prepare(`${cte} SELECT COUNT(*) AS total FROM ranked`).bind(...bindings),
  ]);
  const plain=(value:unknown)=>typeof value==='boolean'?(value?'Oui':'Non'):value==null?'':String(value);
  const normalize=(value:string)=>value.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('fr');
  const items=(found.results as {module_id:string;record_id:string;data:string;updated_at:string;score:number}[]).map(row=>{
    const module=policies.find(m=>m.id===row.module_id)!,data=JSON.parse(row.data) as Record<string,unknown>;
    const excerpts=module.search.fields.map(key=>({label:module.fields.find(f=>f.key===key)?.label??key,value:plain(data[key])}));
    const matching=excerpts.filter(f=>terms.some(term=>normalize(f.value).includes(normalize(term))));
    const snippet=(matching.length?matching:excerpts).filter(f=>f.value).slice(0,3).map(f=>`${f.label} : ${f.value}`).join(' · ').slice(0,420);
    return {index:module.id,id:row.record_id,moduleName:module.name,title:plain(data[module.titleField])||module.name,description:snippet,href:recordHref(module,row.record_id,data),updatedAt:row.updated_at};
  });
  // Only navigable modules own a page to open; collections never appear here.
  const pages=terms.length?policies.filter(m=>m.navigation&&terms.every(t=>normalize(m.name).includes(normalize(t)))).map(m=>({index:'pages',id:m.id,title:m.name,description:'Ouvrir le module',href:m.href})):[];
  return {items,pages,total:(count.results[0] as {total:number}|undefined)?.total??0,indexing,engine:'d1-fts5'};
}

export async function searchRoute(request:Request,db:D1Database,app:AppDefinition,org:Workspace,user:Identity,scoped:{scope?:ScopeProvider;principal?:Principal;access?:RequestAccessContext}={}):Promise<Response|null> {
  const url=new URL(request.url),path=url.pathname.replace(/^\/api\/v1\//,'').replace(/\/$/,'');
  if(path==='registry'&&request.method==='GET')return json({modules:visibleModules(app,org.role).filter(m=>canReadModule(org,m.id,scoped.access)),workspace:org});
  if(path==='search'&&request.method==='GET'){
    const limit=boundedInteger(url.searchParams.get('limit'),30,100);if(!limit)fail(400,'invalid_pagination','Limite positive attendue.');
    return json(await searchData(db,app,org,url.searchParams.get('q')??'',{limit,offset:boundedInteger(url.searchParams.get('offset'),0,100000),moduleId:url.searchParams.get('module')??undefined,...scoped}));
  }
  if(!path.startsWith('admin/search'))return null;
  requireRole(org.role,['owner','admin']);
  if(path==='admin/search'&&request.method==='GET'){
    const policies=await searchPolicies(db,app,org.id);
    const counts=await db.prepare('SELECT module_id,COUNT(*) AS count FROM lite_search_documents WHERE org_id=? GROUP BY module_id').bind(org.id).all<{module_id:string;count:number}>();
    return json({modules:policies.map(m=>({...m,indexed:counts.results.find(c=>c.module_id===m.id)?.count??0})),engine:'d1-fts5'});
  }
  if(path==='admin/search/reindex'&&request.method==='POST'){
    const body=await readJson(request);
    if(body.reset===true)await db.batch([
      db.prepare('DELETE FROM lite_search_documents WHERE org_id=?').bind(org.id),
      db.prepare('DELETE FROM lite_search_progress WHERE org_id=?').bind(org.id),
    ]);
    return json({indexing:await prepareSearchIndex(db,org.id)});
  }
  const match=path.match(/^admin\/search\/([a-z][a-z0-9-]*)$/);
  if(match&&request.method==='PUT'){
    const module=moduleRegistry(app).find(m=>m.id===match[1]);if(!module)fail(404,'module_not_found','Module introuvable.');
    const body=await readJson(request);
    if(typeof body.enabled!=='boolean'||!Array.isArray(body.fields)||body.fields.some(f=>typeof f!=='string'||!module.fields.some(x=>x.key===f))||new Set(body.fields).size!==body.fields.length||!Number.isInteger(body.version)||Number(body.version)<0)fail(400,'invalid_search_settings','Réglages de recherche invalides.');
    const result=await db.batch([
      db.prepare(`INSERT INTO lite_search_settings(org_id,module_id,enabled,fields_json,version)
        SELECT ?,?,?,?,1 WHERE ?=0 OR EXISTS(SELECT 1 FROM lite_search_settings WHERE org_id=? AND module_id=? AND version=?)
        ON CONFLICT(org_id,module_id) DO UPDATE SET enabled=excluded.enabled,fields_json=excluded.fields_json,version=lite_search_settings.version+1
        WHERE lite_search_settings.version=? AND ?>0`).bind(org.id,module.id,body.enabled?1:0,JSON.stringify(body.fields),body.version,org.id,module.id,body.version,body.version,body.version),
      db.prepare('INSERT INTO lite_audit(id,org_id,user_id,action,resource_id,details,created_at) SELECT ?,?,?,?,?,?,? WHERE changes()=1').bind(crypto.randomUUID(),org.id,user.userId,'search.settings',module.id,'{}',new Date().toISOString()),
    ]);
    if(!result[0].meta.changes)fail(409,'version_conflict','Ces réglages ont changé. Rechargez la page.');
    return json({ok:true,version:Number(body.version)+1});
  }
  fail(405,'method_not_allowed','Opération non prise en charge.');
}
