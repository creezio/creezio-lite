import { DatabaseSync } from 'node:sqlite';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { handleApi, defineApp } from '../runtime/core/index.ts';
export const root=fileURLToPath(new URL('../',import.meta.url));
export const app=defineApp(JSON.parse(await readFile(join(root,'template/brand.json'),'utf8')));
export const alice={userId:'alice',email:'alice@example.test',displayName:'Alice'};
export const bob={userId:'bob',email:'bob@example.test',displayName:'Bob'};
export const eve={userId:'eve',email:'eve@example.test',displayName:'Eve'};
export async function migrationSql(){return (await Promise.all((await readdir(join(root,'template/drizzle'))).filter(f=>f.endsWith('.sql')).sort().map(f=>readFile(join(root,'template/drizzle',f),'utf8')))).join('\n');}
export async function localDb(){const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');db.exec(await migrationSql());
  function prepared(sql,values=[]){return{bind(...args){return prepared(sql,args);},async first(column){const row=db.prepare(sql).get(...values);return row?(column?row[column]:row):null;},async all(){return{results:db.prepare(sql).all(...values),success:true};},runSync(){const statement=db.prepare(sql);if(statement.columns().length)return{success:true,results:statement.all(...values),meta:{changes:0}};const result=statement.run(...values);return{success:true,results:[],meta:{changes:Number(result.changes)}};},async run(){return this.runSync();}};}
  return{prepare:sql=>prepared(sql),async batch(statements){db.exec('BEGIN');try{const out=[];for(const s of statements)out.push(s.runSync());db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}},close:()=>db.close(),raw:db};
}
export function fakeBucket(){const store=new Map();return{async put(key,bytes){store.set(key,new Uint8Array(bytes));},async get(key){const bytes=store.get(key);return bytes?{body:new Blob([bytes]).stream()}:null;},async delete(key){store.delete(key);},store};}
export function client(DB,identity,BUCKET=fakeBucket(),definition=app,options={}){return async(path,{method='GET',body,headers={},raw=false}={})=>{const request=new Request(`https://test.example/api/v1/${path}`,{method,headers:{origin:'https://test.example',...(body!==undefined&&!(body instanceof Uint8Array)?{'content-type':'application/json'}:{}),...headers},body:body===undefined?undefined:body instanceof Uint8Array?body:JSON.stringify(body)});const response=await handleApi(request,{app:definition,env:{DB,BUCKET},identity},options);return raw?response:{status:response.status,body:await response.json(),headers:response.headers};};}
export async function boot(call){const response=await call('bootstrap',{method:'POST'});if(response.status!==200)throw new Error(JSON.stringify(response.body));return response.body.workspaceId;}
export const clientData={name:'Atelier du Port',email:'atelier@example.test',company:'Atelier',status:'Actif',notes:'Contact de suivi'};
