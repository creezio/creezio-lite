#!/usr/bin/env node
import {readFile,writeFile,readdir,mkdir,cp,stat,lstat,rename,rm,rmdir,mkdtemp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,join,relative,dirname,basename,sep} from 'node:path';
import {defineApp} from '../runtime/core/validation.ts';
const root=fileURLToPath(new URL('../',import.meta.url));
const packageInfo=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function exists(path){try{await stat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function files(directory,prefix=''){const list=[];for(const e of await readdir(directory,{withFileTypes:true})){if(['node_modules','dist'].includes(e.name))continue;if(e.isSymbolicLink())throw new Error(`Lien symbolique non autorisé : ${join(prefix,e.name)}`);const path=join(prefix,e.name);if(e.isDirectory())list.push(...await files(join(directory,e.name),path));else list.push(path);}return list.sort();}
function within(parent,child){const path=relative(parent,child);return path===''||(!path.startsWith('..'+sep)&&path!=='..'&&!path.startsWith(sep));}
async function runtimeAt(destination){await cp(join(root,'runtime'),join(destination,'runtime'),{recursive:true,filter:path=>!/(?:^|\/)(?:node_modules|dist)(?:\/|$)/.test(path)});}
export async function runtimeHashes(app){const result={};for(const file of await files(join(app,'runtime')))result['runtime/'+file.replaceAll(sep,'/')]=digest(await readFile(join(app,'runtime',file)));return result;}
export async function writeLock(app){const lock={formatVersion:2,kitVersion:packageInfo.version,sourceRepository:packageInfo.repository.url,schemaHash:digest(await readFile(join(app,'db/schema.ts'))),runtimeFiles:await runtimeHashes(app)};await writeFile(join(app,'lite.lock.json'),JSON.stringify(lock,null,2)+'\n');return lock;}
export async function createApp({out,spec}){
 if(!out||!spec)throw new Error('create exige --spec <brief.json> et --out <dossier-vide>.');
 const destination=resolve(out),app=defineApp(JSON.parse(await readFile(resolve(spec),'utf8')));
 if(within(destination,root)||within(join(root,'template'),destination)||within(join(root,'runtime'),destination))throw new Error('Choisir un dossier indépendant du kit et de son template.');
 if(await exists(destination)){if((await lstat(destination)).isSymbolicLink()||(await readdir(destination)).length)throw new Error('Le dossier cible doit être vide ; aucun écrasement automatique.');}
 await mkdir(dirname(destination),{recursive:true});const staging=await mkdtemp(join(dirname(destination),'.lite-new-'));
 try{
  const omit=new Set(['.git','node_modules','dist','.next','.wrangler','.sites-runtime','runtime','coverage','.lite-backups']);
  await cp(join(root,'template'),staging,{recursive:true,filter:async path=>{const name=basename(path);if(omit.has(name)||name.endsWith('.tsbuildinfo')||(name.startsWith('.env')&&name!=='.env.example')||/\.(pem|key|sqlite|db)$/.test(name))return false;if((await lstat(path)).isSymbolicLink())throw new Error('Le template doit être autonome, sans symlink.');return true;}});
  await runtimeAt(staging);await writeFile(join(staging,'brand.json'),JSON.stringify(app,null,2)+'\n');
  await writeFile(join(staging,'.openai/hosting.json'),JSON.stringify({d1:'DB',r2:'BUCKET'},null,2)+'\n');
  const pkg=JSON.parse(await readFile(join(staging,'package.json'),'utf8'));pkg.name=app.id;pkg.version='0.1.0';pkg.private=true;await writeFile(join(staging,'package.json'),JSON.stringify(pkg,null,2)+'\n');
  await writeLock(staging);if(await exists(destination))await rmdir(destination);await rename(staging,destination);
 }catch(error){await rm(staging,{recursive:true,force:true});throw error;}
 return {app:app.name,path:destination,kitVersion:packageInfo.version,registered:false,instructions:'Lire AGENTS.md puis utiliser Sites pour construire et publier cette application.'};
}
export async function doctor(appPath){
 const app=resolve(appPath),issues=[];
 for(const file of ['brand.json','package.json','pnpm-lock.yaml','.openai/hosting.json','lite.lock.json','app/chatgpt-auth.ts','app/api/v1/[...path]/route.ts','app/api/mcp/route.ts','db/schema.ts','AGENTS.md'])if(!await exists(join(app,file)))issues.push(`Fichier manquant : ${file}`);
 if(issues.length)return{ok:false,issues};
 try{defineApp(JSON.parse(await readFile(join(app,'brand.json'),'utf8')));}catch(e){issues.push(e.message);}
 const host=JSON.parse(await readFile(join(app,'.openai/hosting.json'),'utf8'));
 if(host.d1!=='DB'||host.r2!=='BUCKET'||host.static)issues.push('Ce socle exige les bindings DB et BUCKET et un backend Worker.');
 if(Object.keys(host).some(k=>!['project_id','d1','r2','capabilities'].includes(k)))issues.push('Champ non supporté dans hosting.json.');
 const lock=JSON.parse(await readFile(join(app,'lite.lock.json'),'utf8'));
 if(lock.formatVersion!==2)issues.push('Format de verrouillage inconnu.');
 const actual=await runtimeHashes(app);
 for(const [file,hash] of Object.entries(lock.runtimeFiles??{}))if(actual[file]!==hash)issues.push(`Socle modifié ou manquant : ${file}`);
 for(const file of Object.keys(actual))if(!(file in (lock.runtimeFiles??{})))issues.push(`Fichier ajouté au socle : ${file}`);
 if(!(await readdir(join(app,'drizzle'))).some(f=>f.endsWith('.sql')))issues.push('Migration D1 manquante.');
 return {ok:!issues.length,kitVersion:lock.kitVersion,registered:Boolean(host.project_id),issues};
}
export async function upgrade(appPath,apply=false){
 const app=resolve(appPath),report=await doctor(app);if(!report.ok)throw new Error(report.issues.join('\n'));
 const previous=JSON.parse(await readFile(join(app,'lite.lock.json'),'utf8'));
 if(previous.schemaHash!==digest(await readFile(join(root,'template/db/schema.ts'))))throw new Error('Le schéma a changé : migration applicative explicite requise avant upgrade. Aucune modification effectuée.');
 const staging=await mkdtemp(join(dirname(app),'.lite-upgrade-'));
 try{
  await runtimeAt(staging);const desired=await runtimeHashes(staging),changed=JSON.stringify(desired)!==JSON.stringify(previous.runtimeFiles)||previous.kitVersion!==packageInfo.version;
  if(!apply||!changed)return{currentVersion:previous.kitVersion,targetVersion:packageInfo.version,changed,applied:false};
  const backup=join(app,'.lite-backups',`${Date.now()}-${previous.kitVersion}`);await mkdir(backup,{recursive:true});await cp(join(app,'lite.lock.json'),join(backup,'lite.lock.json'));await rename(join(app,'runtime'),join(backup,'runtime'));
  try{await rename(join(staging,'runtime'),join(app,'runtime'));await writeFile(join(app,'lite.lock.json'),JSON.stringify({...previous,kitVersion:packageInfo.version,runtimeFiles:desired},null,2)+'\n');}catch(error){await rm(join(app,'runtime'),{recursive:true,force:true});await rename(join(backup,'runtime'),join(app,'runtime'));await cp(join(backup,'lite.lock.json'),join(app,'lite.lock.json'));throw error;}
  return {currentVersion:previous.kitVersion,targetVersion:packageInfo.version,changed:true,applied:true,backup,requiresBuildAndPublication:true};
 }finally{await rm(staging,{recursive:true,force:true});}
}
export async function addModule(appPath,spec){
 const app=resolve(appPath),file=join(app,'brand.json'),current=JSON.parse(await readFile(file,'utf8')),module=JSON.parse(await readFile(resolve(spec),'utf8'));
 const next=defineApp({...current,modules:[...current.modules,module]});await writeFile(file,JSON.stringify(next,null,2)+'\n');
 return {module:module.id,registered:['navigation','search','api','mcp'],requiresBuildAndPublication:true};
}
async function main(){const [command,...args]=process.argv.slice(2),options={};for(let i=0;i<args.length;i++){if(args[i]==='--apply')options.apply=true;else if(['--out','--spec','--app'].includes(args[i])&&args[i+1])options[args[i++].slice(2)]=args[i];else throw new Error(`Argument inconnu : ${args[i]}`);}
 if(command==='create')console.log(JSON.stringify(await createApp(options),null,2));
 else if(command==='doctor'){const report=await doctor(options.app??process.cwd());console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;}
 else if(command==='upgrade'){if(!options.app)throw new Error('upgrade exige --app <application>.');console.log(JSON.stringify(await upgrade(options.app,options.apply),null,2));}
 else if(command==='module'){if(!options.app||!options.spec)throw new Error('module exige --app et --spec.');console.log(JSON.stringify(await addModule(options.app,options.spec),null,2));}
 else if(command==='--version')console.log(packageInfo.version);
 else if(!command||command==='--help')console.log('Lite\n  create --spec brief.json --out dossier-vide\n  module --app dossier --spec module.json\n  doctor --app dossier\n  upgrade --app dossier [--apply]');
 else throw new Error('Commande inconnue. Utilisez --help.');
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().catch(e=>{console.error(e.message);process.exitCode=1;});
