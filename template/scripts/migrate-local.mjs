import {readFile,readdir,realpath,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function localDatabase({id,persist=false}={}) {
  // Resolve the already-pinned Wrangler dependency, including pnpm symlinks.
  const require=createRequire(await realpath(resolve(root,'node_modules/wrangler/package.json')));
  const {Miniflare}=require('miniflare');
  const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("local migrations");}}',compatibilityDate:'2026-05-15',d1Databases:{DB:id??'lite-migration-test'},d1Persist:persist});
  return {db:await mf.getD1Database('DB'),dispose:()=>mf.dispose()};
}
export async function migrate(db,directory){
  await db.prepare('CREATE TABLE IF NOT EXISTS d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)').run();
  const applied=new Set((await db.prepare('SELECT name FROM d1_migrations').all()).results.map(r=>r.name));
  const names=(await readdir(directory)).filter(n=>/^\d{4}_[a-zA-Z0-9_]+\.sql$/.test(n)).sort();
  let count=0;
  for(const name of names){
    if(applied.has(name))continue;
    // Drizzle owns statement boundaries. Splitting at semicolons corrupts triggers.
    const sql=await readFile(resolve(directory,name),'utf8');
    const statements=sql.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean);
    if(!statements.length)throw Error('Empty migration: '+name);
    await db.batch([...statements.map(s=>db.prepare(s)),db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').bind(name)]);
    count++;
  }
  return count;
}
async function main(){
  let config;try{config=JSON.parse(await readFile(resolve(root,'dist/server/wrangler.json'),'utf8'));}catch{throw Error('Exécuter le build avant db:local.');}
  const binding=config.d1_databases?.find(d=>d.binding==='DB');
  if(!binding?.database_id)throw Error('Binding local DB introuvable.');
  const persist=resolve(root,'.wrangler/state/v3/d1');await mkdir(persist,{recursive:true});
  const local=await localDatabase({id:binding.database_id,persist});
  try{console.log(`${await migrate(local.db,resolve(root,'drizzle'))} migration(s) locale(s) appliquée(s).`);}finally{await local.dispose();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
