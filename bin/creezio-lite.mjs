#!/usr/bin/env node
import { readFile, writeFile, readdir, mkdir, cp, stat, lstat, rename, rm, rmdir, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, join, relative, dirname, basename, sep } from 'node:path';
import { defineApp } from '../packages/core/src/validation.ts';
const root=fileURLToPath(new URL('../',import.meta.url));
const packageInfo=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const source=JSON.parse(await readFile(join(root,'UPSTREAM.json'),'utf8'));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function exists(path){try{await stat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function files(directory,prefix=''){const list=[];for(const e of await readdir(directory,{withFileTypes:true})){if(['node_modules','dist','dist-cjs'].includes(e.name))continue;if(e.isSymbolicLink())throw new Error(`Lien symbolique non autorisé : ${join(prefix,e.name)}`);const path=join(prefix,e.name);if(e.isDirectory())list.push(...await files(join(directory,e.name),path));else list.push(path);}return list.sort();}
function within(parent,child){const path=relative(parent,child);return path===''||(!path.startsWith('..'+sep)&&path!=='..'&&!path.startsWith(sep));}
async function runtimeAt(destination){
  for(const name of ['core','ui'])await cp(join(root,'packages',name,'src'),join(destination,'creezio',name),{recursive:true});
  for(const entry of await readdir(join(root,'packages'),{withFileTypes:true})){
    if(!entry.isDirectory()||['core','ui'].includes(entry.name))continue;
    await cp(join(root,'packages',entry.name),join(destination,'creezio/packages',entry.name),{recursive:true,filter:path=>!/(?:^|\/)(?:node_modules|dist|dist-cjs)(?:\/|$)/.test(path)});
  }
  await cp(join(root,'tsconfig.base.json'),join(destination,'creezio/tsconfig.base.json'));
}
async function runtimeHashes(app){const result={};for(const file of await files(join(app,'creezio')))result['creezio/'+file.replaceAll(sep,'/')]=digest(await readFile(join(app,'creezio',file)));return result;}
async function writeLock(app){const lock={formatVersion:1,kitVersion:packageInfo.version,sourceRepository:packageInfo.repository.url,upstreamCommit:source.commit,schemaHash:digest(await readFile(join(app,'db/schema.ts'))),runtimeFiles:await runtimeHashes(app)};await writeFile(join(app,'creezio-lite.lock.json'),JSON.stringify(lock,null,2)+'\n');return lock;}
export async function createApp({out,spec}) {
  if(!out||!spec)throw new Error('create exige --spec <brief.json> et --out <dossier-vide>.');
  const destination=resolve(out),specPath=resolve(spec),app=defineApp(JSON.parse(await readFile(specPath,'utf8')));
  if(within(destination,root)||within(join(root,'template'),destination)||within(join(root,'packages'),destination))throw new Error('Choisir un dossier indépendant du kit et de son template.');
  if(await exists(destination)){if((await lstat(destination)).isSymbolicLink()||(await readdir(destination)).length)throw new Error('Le dossier cible doit être vide ; aucun écrasement automatique.');}
  await mkdir(dirname(destination),{recursive:true});
  const staging=await mkdtemp(join(dirname(destination),'.creezio-new-'));
  try {
    const omit=new Set(['.git','node_modules','dist','.next','.wrangler','.sites-runtime','creezio','coverage','.creezio-backups']);
    await cp(join(root,'template'),staging,{recursive:true,filter:async path=>{const name=basename(path);if(omit.has(name)||name.endsWith('.tsbuildinfo')||(name.startsWith('.env')&&name!=='.env.example')||/\.(pem|key|sqlite|db)$/.test(name))return false;if((await lstat(path)).isSymbolicLink())throw new Error('Le template doit être autonome, sans symlink.');return true;}});
    await runtimeAt(staging);
    await writeFile(join(staging,'brand.json'),JSON.stringify(app,null,2)+'\n');
    // Never inherit an existing Site, a credential, a runtime profile or another application's data.
    await writeFile(join(staging,'.openai/hosting.json'),JSON.stringify({d1:'DB',r2:'BUCKET'},null,2)+'\n');
    const pkg=JSON.parse(await readFile(join(staging,'package.json'),'utf8'));pkg.name=app.id;pkg.version='0.1.0';pkg.private=true;
    await writeFile(join(staging,'package.json'),JSON.stringify(pkg,null,2)+'\n');
    if(await exists(join(staging,'package-lock.json'))){const lock=JSON.parse(await readFile(join(staging,'package-lock.json'),'utf8'));lock.name=app.id;if(lock.packages?.[''])lock.packages[''].name=app.id;await writeFile(join(staging,'package-lock.json'),JSON.stringify(lock,null,2)+'\n');}
    await writeLock(staging);
    if(await exists(destination))await rmdir(destination);
    await rename(staging,destination);
  }catch(error){await rm(staging,{recursive:true,force:true});throw error;}
  return {app:app.name,path:destination,kitVersion:packageInfo.version,registered:false,instructions:'Lire AGENTS.md puis utiliser Sites pour installer, construire et publier cette application.'};
}
export async function doctor(appPath){
  const app=resolve(appPath),issues=[];
  for(const file of ['brand.json','package.json','pnpm-lock.yaml','.openai/hosting.json','creezio-lite.lock.json','app/chatgpt-auth.ts','app/api/v1/[...path]/route.ts','db/schema.ts','AGENTS.md'])if(!await exists(join(app,file)))issues.push(`Fichier manquant : ${file}`);
  if(issues.length)return{ok:false,issues};
  try{defineApp(JSON.parse(await readFile(join(app,'brand.json'),'utf8')));}catch(e){issues.push(e.message);}
  const host=JSON.parse(await readFile(join(app,'.openai/hosting.json'),'utf8'));
  if(host.d1!=='DB'||host.r2!=='BUCKET'||host.static)issues.push('Ce socle exige les bindings DB et BUCKET et un backend Worker.');
  if(Object.keys(host).some(k=>!['project_id','d1','r2','capabilities'].includes(k)))issues.push('Champ non supporté dans hosting.json.');
  const lock=JSON.parse(await readFile(join(app,'creezio-lite.lock.json'),'utf8'));
  if(lock.formatVersion!==1)issues.push('Format de verrouillage inconnu.');
  const actual=await runtimeHashes(app);
  for(const [file,hash]of Object.entries(lock.runtimeFiles??{}))if(actual[file]!==hash)issues.push(`Socle modifié ou manquant : ${file}`);
  for(const file of Object.keys(actual))if(!(file in (lock.runtimeFiles??{})))issues.push(`Fichier ajouté au socle : ${file}`);
  for(const file of Object.keys(actual)){if(file.startsWith('creezio/packages/'))continue;if(!/\.[cm]?[jt]sx?$/.test(file))continue;const code=await readFile(join(app,file),'utf8');if(/(?:from\s*|import\s*\(|require\s*\()['"](?:node:|electron|better-sqlite3|@creezio\/(?:app-runtime|host-runtime|search))/.test(code))issues.push(`Dépendance système interdite : ${file}`);}
  const migrations=(await readdir(join(app,'drizzle'))).filter(f=>f.endsWith('.sql'));
  if(!migrations.length)issues.push('Migration D1 manquante.');
  return{ok:!issues.length,kitVersion:lock.kitVersion,registered:Boolean(host.project_id),issues};
}
export async function upgrade(appPath,apply=false){
  const app=resolve(appPath),report=await doctor(app);if(!report.ok)throw new Error(report.issues.join('\n'));
  const previous=JSON.parse(await readFile(join(app,'creezio-lite.lock.json'),'utf8'));
  const desiredSchema=digest(await readFile(join(root,'template/db/schema.ts')));
  if(previous.schemaHash!==desiredSchema)throw new Error('Cette version modifie le schéma commun : migration applicative explicite requise avant upgrade. Aucune modification effectuée.');
  const tmp=await mkdtemp(join(dirname(app),'.creezio-upgrade-'));
  try{await runtimeAt(tmp);const desired=await runtimeHashes(tmp);const changed=JSON.stringify(desired)!==JSON.stringify(previous.runtimeFiles)||previous.kitVersion!==packageInfo.version;
    if(!apply||!changed)return{currentVersion:previous.kitVersion,targetVersion:packageInfo.version,changed,applied:false};
    const backup=join(app,'.creezio-backups',`${Date.now()}-${previous.kitVersion}`);await mkdir(backup,{recursive:true});await cp(join(app,'creezio-lite.lock.json'),join(backup,'creezio-lite.lock.json'));await rename(join(app,'creezio'),join(backup,'creezio'));
    try{await rename(join(tmp,'creezio'),join(app,'creezio'));const next={...previous,kitVersion:packageInfo.version,upstreamCommit:source.commit,runtimeFiles:desired};await writeFile(join(app,'creezio-lite.lock.json'),JSON.stringify(next,null,2)+'\n');}catch(error){await rm(join(app,'creezio'),{recursive:true,force:true});await rename(join(backup,'creezio'),join(app,'creezio'));await cp(join(backup,'creezio-lite.lock.json'),join(app,'creezio-lite.lock.json'));throw error;}
    return{currentVersion:previous.kitVersion,targetVersion:packageInfo.version,changed:true,applied:true,backup,requiresBuildAndPublication:true};
  }finally{await rm(tmp,{recursive:true,force:true});}
}
async function main(){const [command,...args]=process.argv.slice(2),options={};for(let i=0;i<args.length;i++){if(args[i]==='--apply')options.apply=true;else if(['--out','--spec','--app'].includes(args[i])&&args[i+1])options[args[i++].slice(2)]=args[i];else throw new Error(`Argument inconnu : ${args[i]}`);}
  if(command==='create')console.log(JSON.stringify(await createApp(options),null,2));
  else if(command==='doctor'){const report=await doctor(options.app??process.cwd());console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;}
  else if(command==='upgrade'){if(!options.app)throw new Error('upgrade exige --app <application>.');console.log(JSON.stringify(await upgrade(options.app,options.apply),null,2));}
  else if(command==='--version')console.log(packageInfo.version);
  else if(!command||command==='--help')console.log('Creezio Lite\n  create --spec brief.json --out dossier-vide\n  doctor --app dossier\n  upgrade --app dossier [--apply]\nNe crée ni dépôt GitHub ni Site sans le workflow de publication Sites.');
  else throw new Error('Commande inconnue. Utilisez --help.');
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().catch(e=>{console.error(e.message);process.exitCode=1;});
