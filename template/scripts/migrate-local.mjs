import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const root=process.cwd();
const built=resolve(root,'dist/server/wrangler.json');
let config;try{config=JSON.parse(await readFile(built,'utf8'));}catch{throw new Error('Exécuter le build avant db:local.');}
if(!config.d1_databases?.some(d=>d.binding==='DB'))throw new Error('Binding local DB introuvable.');
config.d1_databases=config.d1_databases.map(d=>({...d,migrations_dir:resolve(root,'drizzle')}));
config.main=resolve(root,'dist/server/index.js');
delete config.assets;
await mkdir(resolve(root,'.sites-runtime'),{recursive:true});
const localConfig=resolve(root,'.sites-runtime/migrations.json');
await writeFile(localConfig,JSON.stringify(config,null,2)+'\n');
const result=spawnSync(process.execPath,[resolve(root,'node_modules/wrangler/bin/wrangler.js'),'d1','migrations','apply','DB','--local','--config',localConfig,'--persist-to',resolve(root,'.wrangler/state')],{stdio:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
if(result.error)throw result.error;process.exitCode=result.status??1;
