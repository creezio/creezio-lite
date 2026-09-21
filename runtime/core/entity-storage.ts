import type { D1Database } from '@cloudflare/workers-types';
import type { Module, SqlFragment } from './types.ts';
import type { ModuleEntitySpec } from './module-contract.ts';
import { storedFields, validateStoredData } from './entity-write.ts';
export type EntityStorage={kind:'records'}|{kind:'relational';table:string;columns?:Record<string,string>};
const identifier=/^[a-z][a-z0-9_]{0,63}$/;
const metadata=['id','org_id','version','created_by','created_at','updated_at','deleted_at'];
const quote=(s:string)=>{if(!/^[a-z][a-z0-9_]{0,127}$/.test(s))throw new Error('Invalid D1 identifier');return '"'+s+'"';};
export function assertEntityStorage(spec:ModuleEntitySpec){
 if(!/^[a-z][a-z0-9-]{0,47}$/.test(spec.schema.id))throw new Error('Invalid entity id');
 for(const f of storedFields(spec.schema))if(!identifier.test(f.key))throw new Error('Invalid entity field');
 const storage=spec.storage;
 if(storage.kind==='records')return;
 if(storage.kind!=='relational')throw new Error('Unsupported entity storage adapter');
 if(!identifier.test(storage.table))throw new Error('Invalid entity table');
 if(storage.table.startsWith('lite_'))throw new Error('Relational entities cannot own kit tables');
 quote(storage.table);
 const fields=storedFields(spec.schema),keys=new Set(fields.map(f=>f.key)),columns=new Set(metadata);
 for(const key of Object.keys(storage.columns??{}))if(!keys.has(key))throw new Error('Column mapping must name a stored field');
 for(const f of fields){const name=storage.columns?.[f.key]??f.key;quote(name);if(columns.has(name))throw new Error('Duplicate or reserved entity column');columns.add(name);}
}
/** One envelope for both adapters; SQL scopes always see r.id, r.module_id and r.data. */
export function entityStorage(module:Module,spec?:ModuleEntitySpec){
 const storage=spec?.storage??{kind:'records' as const};
 assertEntityStorage(spec??{schema:module,storage});
 const relational=storage.kind==='relational',table=relational?storage.table:'lite_records';
 const fields=storedFields(module),column=(key:string)=>quote(relational?(storage.columns?.[key]??key):key);
 const dataExpression=(alias:string)=>{
  let expression="'{}'";
  // Keep each JSON call under SQLite/D1's argument limit, even with server snapshots.
  for(let index=0;index<fields.length;index+=30){
   const pairs=fields.slice(index,index+30).flatMap(f=>{
    const value=alias+'.'+column(f.key);
    return ["'$."+f.key+"'",f.encoding==='json'?`json(${value})`:f.type==='boolean'?`json(CASE WHEN ${value} IS NULL THEN 'null' WHEN ${value}=0 THEN 'false' ELSE 'true' END)`:value];
   });
   expression=`json_set(${expression},${pairs.join(',')})`;
  }
  // SQL NULL for an optional server field means absent, never an implicit false/default.
  const optionalServer=(module.serverFields??[]).filter(f=>!f.required);
  for(let index=0;index<optionalServer.length;index+=30){
   const paths=optionalServer.slice(index,index+30).map(f=>`CASE WHEN ${alias}.${column(f.key)} IS NULL THEN '$.${f.key}' ELSE '$.__lite_absent__' END`);
   expression=`json_remove(${expression},${paths.join(',')})`;
  }
  return expression;
 };
 const source=relational?`(SELECT id,org_id,'${module.id}' AS module_id,${dataExpression('e')} AS data,version,created_by,created_at,updated_at,deleted_at FROM ${quote(table)} e)`:'lite_records';
 const values=(data:Record<string,unknown>)=>fields.map(f=>data[f.key]==null?null:f.encoding==='json'?JSON.stringify(data[f.key]):f.type==='boolean'?(data[f.key]?1:0):data[f.key]);
 const insertStatement=(input:{id:string;orgId:string;data:Record<string,unknown>;userId:string;now:string}):SqlFragment=>{
  const {id,orgId,userId,now}=input;const data=validateStoredData(module,input.data);
  return relational?{sql:`INSERT INTO ${quote(table)}(id,org_id,version,created_by,created_at,updated_at,${fields.map(f=>column(f.key)).join(',')}) VALUES(?,?,1,?,?,?,${fields.map(()=>'?').join(',')})`,bindings:[id,orgId,userId,now,now,...values(data)]}:
   {sql:'INSERT INTO lite_records(id,org_id,module_id,data,search_text,version,created_by,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?,?)',bindings:[id,orgId,module.id,JSON.stringify(data),Object.values(data).join(' ').toLowerCase(),userId,now,now]};
 };
 const updateStatement=(input:{id:string;orgId:string;data?:Record<string,unknown>;version:number;now:string;filter:SqlFragment;archive?:boolean}):SqlFragment=>{
  const {id,orgId,version,now,filter,archive}=input;const data=archive?undefined:validateStoredData(module,input.data);
  const set=archive?'deleted_at=?,updated_at=?':relational?`${fields.map(f=>column(f.key)+'=?').join(',')},updated_at=?`:'data=?,search_text=?,updated_at=?';
  const bindings=archive?[now,now]:relational?[...values(data!),now]:[JSON.stringify(data),Object.values(data!).join(' ').toLowerCase(),now];
  return {sql:`UPDATE ${quote(table)} SET ${set},version=version+1 WHERE id=? AND org_id=? ${relational?'':'AND module_id=?'} AND version=? AND deleted_at IS NULL AND EXISTS(SELECT 1 FROM ${source} r WHERE r.id=${quote(table)}.id AND r.org_id=${quote(table)}.org_id AND ${filter.sql})`,bindings:[...bindings,id,orgId,...(relational?[]:[module.id]),version,...filter.bindings]};
 };
 return {table,source,relational,dataExpression,insertStatement,updateStatement,
  insert(db:D1Database,input:Parameters<typeof insertStatement>[0]){const statement=insertStatement(input);return db.prepare(statement.sql).bind(...statement.bindings);},
  update(db:D1Database,input:Parameters<typeof updateStatement>[0]){const statement=updateStatement(input);return db.prepare(statement.sql).bind(...statement.bindings);},
 };
}
/** Generate additive application SQL. Review/check it into the owning module's migration; never run DDL during a request. */
export function relationalEntityMigration(spec:ModuleEntitySpec):string[]{
 assertEntityStorage(spec);if(spec.storage.kind!=='relational')throw new Error('Relational storage required');
 const storage=entityStorage(spec.schema,spec),table=quote(storage.table),mod=spec.schema.id;
 const columns=storedFields(spec.schema).map(f=>`${quote(spec.storage.kind==='relational'?(spec.storage.columns?.[f.key]??f.key):f.key)} ${f.type==='number'?(f.integer?'INTEGER':'REAL'):f.type==='boolean'?'INTEGER':'TEXT'}${f.required?' NOT NULL':''}`);
 const projection=storage.dataExpression('NEW');
 const insert=`INSERT INTO lite_search_documents(org_id,module_id,record_id,data,updated_at) SELECT NEW.org_id,'${mod}',NEW.id,${projection},NEW.updated_at WHERE NEW.deleted_at IS NULL ON CONFLICT(org_id,module_id,record_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at;`;
 const remove=`DELETE FROM lite_search_documents WHERE org_id=OLD.org_id AND module_id='${mod}' AND record_id=OLD.id;`;
 return [
 `CREATE TABLE ${table}(id TEXT PRIMARY KEY NOT NULL,org_id TEXT NOT NULL REFERENCES lite_orgs(id),version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),created_by TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT,${columns.join(',')})`,
 `CREATE INDEX ${quote(storage.table+'_org')} ON ${table}(org_id,deleted_at,updated_at)`,
 `CREATE TRIGGER ${quote(storage.table+'_search_insert')} AFTER INSERT ON ${table} BEGIN ${insert} END`,
 `CREATE TRIGGER ${quote(storage.table+'_search_update')} AFTER UPDATE ON ${table} BEGIN ${remove} ${insert} END`,
 `CREATE TRIGGER ${quote(storage.table+'_search_delete')} AFTER DELETE ON ${table} BEGIN ${remove} END`,
 ];
}
export function entityRecordSource(specs:Record<string,ModuleEntitySpec>={}){
 const relational=Object.values(specs).filter(s=>s.storage.kind==='relational');
 if(!relational.length)return 'lite_records';
 return `(SELECT id,org_id,module_id,data,version,created_by,created_at,updated_at,deleted_at FROM lite_records WHERE module_id NOT IN (${relational.map(s=>"'"+s.schema.id+"'").join(',')}) UNION ALL ${relational.map(s=>'SELECT * FROM '+entityStorage(s.schema,s).source).join(' UNION ALL ')})`;
}
