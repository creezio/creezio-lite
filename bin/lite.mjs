#!/usr/bin/env node
import {readFile,writeFile,readdir,mkdir,cp,stat,lstat,rename,rm,rmdir,mkdtemp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,join,relative,dirname,basename,sep} from 'node:path';
import {defineApp} from '../runtime/core/validation.ts';
import {scaffoldModules} from './module-scaffold.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const packageInfo=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function exists(path){try{await stat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function files(directory,prefix=''){const list=[];for(const e of await readdir(directory,{withFileTypes:true})){if(['node_modules','dist'].includes(e.name))continue;if(e.isSymbolicLink())throw new Error(`Lien symbolique non autorisé : ${join(prefix,e.name)}`);const path=join(prefix,e.name);if(e.isDirectory())list.push(...await files(join(directory,e.name),path));else list.push(path);}return list.sort();}
function within(parent,child){const path=relative(parent,child);return path===''||(!path.startsWith('..'+sep)&&path!=='..'&&!path.startsWith(sep));}
async function runtimeAt(destination){await cp(join(root,'runtime'),join(destination,'runtime'),{recursive:true,filter:path=>!/(?:^|\/)(?:node_modules|dist)(?:\/|$)/.test(path)});}
export async function runtimeHashes(app){const result={};for(const file of await files(join(app,'runtime')))result['runtime/'+file.replaceAll(sep,'/')]=digest(await readFile(join(app,'runtime',file)));return result;}
export async function writeLock(app){const lock={formatVersion:2,kitVersion:packageInfo.version,sourceRepository:packageInfo.repository.url,schemaHash:digest(await readFile(join(app,'db/schema.ts'))),runtimeFiles:await runtimeHashes(app)};await writeFile(join(app,'lite.lock.json'),JSON.stringify(lock,null,2)+'\n');return lock;}
// Standard d'orchestration : source canonique .cursor/skills/lite-orchestration du kit (toute ressource du dossier, récursivement : contrat, sélections, scripts, références, schémas, exemples) + règle du template ; copies gérées par manifest. Ajouter une ressource = ajouter un fichier dans ce dossier, sans liste manuelle.
export const orchestrationDir='.cursor/skills/lite-orchestration',orchestrationManifest=orchestrationDir+'/manifest.json',orchestrationRule='.cursor/rules/lite-orchestration.mdc';
// Découverte Codex (`.agents/skills/<nom>/SKILL.md`, aussi lue par Cursor) : fichier généré depuis le frontmatter canonique et la liste des ressources distribuées, jamais maintenu à la main, empreinte dans `manifest.generated`.
export const orchestrationDiscovery='.agents/skills/lite-orchestration/SKILL.md';
export async function orchestrationSources(){if(!await exists(join(root,orchestrationDir,'SKILL.md'))||!await exists(join(root,'template',orchestrationRule)))throw new Error(`Source d’orchestration absente du kit : ${orchestrationDir} et template/${orchestrationRule} sont requis.`);const list={};for(const file of await files(join(root,orchestrationDir))){const path=orchestrationDir+'/'+file.replaceAll(sep,'/');if(path!==orchestrationManifest)list[path]=join(root,path);}list[orchestrationRule]=join(root,'template',orchestrationRule);return list;}
// Délimiteurs `---` et fins de ligne LF ou CRLF (`core.autocrlf`) ; `name`/`description` restent une ligne, champs et clôture toujours exigés.
export function skillFrontmatter(text){const front=text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);const name=front&&/^name: (\S+)\r?$/m.exec(front[1])?.[1],description=front&&/^description: (.+)\r?$/m.exec(front[1])?.[1];if(!name||!description)throw new Error('SKILL.md : frontmatter YAML avec `name` et `description` sur une ligne attendu.');return {name,description};}
export function renderDiscovery({name,description},paths){
 const sorted=[...paths].sort(),scripts=sorted.filter(p=>/\/scripts\/[^/]+\.mjs$/.test(p)),references=sorted.filter(p=>!scripts.includes(p));
 return `---\nname: ${name}\ndescription: ${description}\n---\n\n# Orchestration Creezio Lite — point d’entrée de découverte\n\nFichier généré par le kit Creezio Lite depuis la compétence canonique \`${orchestrationDir}/SKILL.md\` et géré par \`${orchestrationManifest}\`. Ne pas le modifier ni y ajouter de contenu : corriger le kit, puis relancer \`node <checkout-kit>/bin/lite.mjs adopt --app <dossier> --apply\`.\n\nLire d’abord \`AGENTS.md\` de cette application, puis \`${orchestrationDir}/SKILL.md\` et le contrat \`${orchestrationDir}/CONTRACT.md\`. Les chemins ci-dessous partent de la racine de l’application ; chaque fichier est une copie exacte du kit.\n\n## Références distribuées\n\n${references.map(p=>`- \`${p}\``).join('\n')}\n\n## Scripts distribués\n\n${scripts.length?scripts.map(p=>`- \`${p}\` — lancer \`node ${p}\` ; usage décrit dans la compétence canonique ; aucune clé ni donnée privée dans le dépôt.`).join('\n'):'- aucun'}\n`;
}
export async function orchestrationGenerated(sources){sources??=await orchestrationSources();const front=skillFrontmatter(await readFile(sources[orchestrationDir+'/SKILL.md'],'utf8'));if(front.name!==basename(dirname(orchestrationDiscovery)))throw new Error(`Le nom de compétence ${front.name} doit égaler le dossier ${dirname(orchestrationDiscovery)} pour la découverte Codex et Cursor.`);return {[orchestrationDiscovery]:Buffer.from(renderDiscovery(front,Object.keys(sources)))};}
async function readManifest(app){if(!await exists(join(app,orchestrationManifest)))return null;let manifest;try{manifest=JSON.parse(await readFile(join(app,orchestrationManifest),'utf8'));}catch{throw new Error(`Manifeste d’orchestration illisible (${orchestrationManifest}) : JSON invalide. Aucune modification effectuée ; restaurer la copie du kit.`);}if(!manifest||manifest.formatVersion!==1||typeof manifest.files!=='object'||(manifest.generated!==undefined&&(typeof manifest.generated!=='object'||manifest.generated===null)))throw new Error('Manifeste d’orchestration inconnu : ne pas le modifier à la main.');return manifest;}
// Confinement : chaque composant existant d'un chemin géré (parents compris) doit être un vrai dossier ou fichier de l'application ; lien symbolique ou jonction ⇒ refus avant toute écriture.
async function assertConfined(app,path){let current=app;for(const part of path.split('/')){current=join(current,part);let info;try{info=await lstat(current);}catch(e){if(e.code==='ENOENT')return;throw e;}if(info.isSymbolicLink())throw new Error(`Lien symbolique ou jonction refusé : ${relative(app,current)} sort du contrôle de l’application. Aucune modification effectuée ; remplacer le lien par un vrai dossier ou fichier avant adopt.`);}}
export async function inspectOrchestration(app){
 const sources=await orchestrationSources(),generated=await orchestrationGenerated(sources);for(const path of [...Object.keys(sources),...Object.keys(generated),orchestrationManifest])await assertConfined(app,path);
 const manifest=await readManifest(app),files_={},generated_={},conflicts=[],pending=[],pendingGenerated=[];
 // Même classement pour une copie du kit et un fichier généré : l'empreinte connue du manifeste distingue une copie périmée d'une modification locale.
 const classify=async(path,want,known,statuses,queue)=>{if(!await exists(join(app,path))){statuses[path]='missing';queue.push(path);return;}const have=digest(await readFile(join(app,path)));if(have===want)statuses[path]='current';else if(known===have){statuses[path]='outdated';queue.push(path);}else{statuses[path]='conflict';conflicts.push(path);}};
 for(const [path,source] of Object.entries(sources))await classify(path,digest(await readFile(source)),manifest?.files?.[path],files_,pending);
 for(const [path,bytes] of Object.entries(generated))await classify(path,digest(bytes),manifest?.generated?.[path],generated_,pendingGenerated);
 const unmanaged=[];for(const dir of [orchestrationDir,dirname(orchestrationDiscovery)])if(await exists(join(app,dir)))unmanaged.push(...(await files(join(app,dir))).map(f=>dir+'/'+f.replaceAll(sep,'/')).filter(p=>!(p in sources)&&!(p in generated)&&p!==orchestrationManifest));
 const manifestCurrent=Boolean(manifest)&&manifest.kitVersion===packageInfo.version&&Object.keys(sources).every(p=>manifest.files[p]!==undefined)&&Object.keys(generated).every(p=>manifest.generated?.[p]!==undefined);
 const agents=await exists(join(app,'AGENTS.md'))?await readFile(join(app,'AGENTS.md'),'utf8'):'';
 const changed=pending.length>0||pendingGenerated.length>0||!manifestCurrent;
 return {installedVersion:manifest?.kitVersion??null,targetVersion:packageInfo.version,files:files_,generated:generated_,conflicts,unmanaged,changed,pending,pendingGenerated,agentsMentionsStandard:agents.includes('lite-orchestration'),status:conflicts.length?'conflict':(pending.length||pendingGenerated.length)?(manifest?'outdated':'missing'):manifestCurrent?'current':'outdated'};
}
export async function installOrchestration(app,{only}={}){
 const sources=await orchestrationSources(),generated=await orchestrationGenerated(sources),manifest={formatVersion:1,owner:'creezio-lite',kitVersion:packageInfo.version,sourceRepository:packageInfo.repository.url,files:{},generated:{}};
 const write=async(path,bytes)=>{if(!only||only.includes(path)){await mkdir(dirname(join(app,path)),{recursive:true});await writeFile(join(app,path),bytes);}};
 for(const [path,source] of Object.entries(sources)){const bytes=await readFile(source);manifest.files[path]=digest(bytes);await write(path,bytes);}
 for(const [path,bytes] of Object.entries(generated)){manifest.generated[path]=digest(bytes);await write(path,bytes);}
 await writeFile(join(app,orchestrationManifest),JSON.stringify(manifest,null,2)+'\n');return manifest;
}
export async function adopt(appPath,apply=false){
 const app=resolve(appPath);if(within(root,app)||within(app,root))throw new Error('adopt vise une application indépendante du kit.');
 for(const file of ['brand.json','AGENTS.md','lite.lock.json'])if(!await exists(join(app,file)))throw new Error(`Application Lite attendue : ${file} manquant.`);
 const report=await inspectOrchestration(app);
 if(apply&&report.conflicts.length)throw new Error(`Conflit local sur ${report.conflicts.join(', ')} : copie modifiée hors du kit. Aucune modification effectuée ; restaurer la copie du kit ou consigner le report avant --apply.`);
 if(!apply||!report.changed)return{...report,applied:false};
 await installOrchestration(app,{only:[...report.pending,...report.pendingGenerated]});
 return {...report,applied:true,written:report.pending,writtenGenerated:report.pendingGenerated,manifest:orchestrationManifest};
}
export async function createApp({out,spec}){
 if(!out||!spec)throw new Error('create exige --spec <brief.json> et --out <dossier-vide>.');
 const destination=resolve(out),app=defineApp(JSON.parse(await readFile(resolve(spec),'utf8')));
 if(within(destination,root)||within(join(root,'template'),destination)||within(join(root,'runtime'),destination))throw new Error('Choisir un dossier indépendant du kit et de son template.');
 if(await exists(destination)){if((await lstat(destination)).isSymbolicLink()||(await readdir(destination)).length)throw new Error('Le dossier cible doit être vide ; aucun écrasement automatique.');}
 await mkdir(dirname(destination),{recursive:true});const staging=await mkdtemp(join(dirname(destination),'.lite-new-'));
 try{
  const omit=new Set(['.git','node_modules','dist','.next','.wrangler','.sites-runtime','runtime','coverage','.lite-backups']);
  await cp(join(root,'template'),staging,{recursive:true,filter:async path=>{const name=basename(path);if(path===join(root,'template','app','modules')||omit.has(name)||name.endsWith('.tsbuildinfo')||(name.startsWith('.env')&&name!=='.env.example')||/\.(pem|key|sqlite|db)$/.test(name))return false;if((await lstat(path)).isSymbolicLink())throw new Error('Le template doit être autonome, sans symlink.');return true;}});
  await runtimeAt(staging);await installOrchestration(staging);await writeFile(join(staging,'brand.json'),JSON.stringify(app,null,2)+'\n');
  await writeFile(join(staging,'.openai/hosting.json'),JSON.stringify({d1:'DB',r2:'BUCKET'},null,2)+'\n');
  const pkg=JSON.parse(await readFile(join(staging,'package.json'),'utf8'));pkg.name=app.id;pkg.version='0.1.0';pkg.private=true;await writeFile(join(staging,'package.json'),JSON.stringify(pkg,null,2)+'\n');
  await scaffoldModules(staging,app.modules,{all:true});
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
 // Information seulement : l'absence du standard d'orchestration ne bloque ni doctor ni upgrade des applications existantes.
 let orchestration;try{const o=await inspectOrchestration(app);orchestration={status:o.status,installedVersion:o.installedVersion,targetVersion:o.targetVersion,conflicts:o.conflicts};}catch(e){orchestration={status:'invalid',error:e.message};}
 const bridgePath=join(app,'app/sites-pane-router.tsx');
 const bridge=await exists(bridgePath)?await readFile(bridgePath,'utf8'):'';
 const managedBridge=bridge.includes('@lite/sites-adapter/ui/pane-router');
 const chromePath=join(app,'app/brand-chrome.tsx'),buildPath=join(app,'build/lite-source.ts');
 const chrome=await exists(chromePath)?await readFile(chromePath,'utf8'):'';
 const build=await exists(buildPath)?await readFile(buildPath,'utf8'):'';
 const renderLocation=chrome.includes('<SitesWorkspaceLocation>'),slotContexts=build.includes('stabilizeVinextSlotContexts');
 const hostIntegration={paneRouter:managedBridge?'managed':bridge?'legacy':'missing',renderLocation,slotContexts,migrationRequired:!managedBridge||!renderLocation||!slotContexts};
 if(hostIntegration.migrationRequired)issues.push('HOST_INTEGRATION_REQUIRED: adopter le pont Sites géré, SitesWorkspaceLocation et la stabilisation des contextes avant validation.');
 for(const file of ['app/modules/index.ts','app/app-extensions.ts'])if(!await exists(join(app,file)))issues.push(`MODULE_CONTRACT_REQUIRED: ${file}`);
 return {ok:!issues.length,kitVersion:lock.kitVersion,registered:Boolean(host.project_id),issues,orchestration,hostIntegration};
}
export async function upgrade(appPath,apply=false){
 const app=resolve(appPath),report=await doctor(app);if(!report.ok)throw new Error(report.issues.join('\n'));
 const previous=JSON.parse(await readFile(join(app,'lite.lock.json'),'utf8'));
 if(previous.schemaHash!==digest(await readFile(join(root,'template/db/schema.ts'))))throw new Error('Le schéma a changé : migration applicative explicite requise avant upgrade. Aucune modification effectuée.');
 const staging=await mkdtemp(join(dirname(app),'.lite-upgrade-'));
 try{
  await runtimeAt(staging);const desired=await runtimeHashes(staging),changed=JSON.stringify(desired)!==JSON.stringify(previous.runtimeFiles)||previous.kitVersion!==packageInfo.version;
  if(!apply||!changed)return{currentVersion:previous.kitVersion,targetVersion:packageInfo.version,changed,applied:false,hostIntegration:report.hostIntegration};
  const backup=join(app,'.lite-backups',`${Date.now()}-${previous.kitVersion}`);await mkdir(backup,{recursive:true});await cp(join(app,'lite.lock.json'),join(backup,'lite.lock.json'));await rename(join(app,'runtime'),join(backup,'runtime'));
  try{await rename(join(staging,'runtime'),join(app,'runtime'));await writeFile(join(app,'lite.lock.json'),JSON.stringify({...previous,kitVersion:packageInfo.version,runtimeFiles:desired},null,2)+'\n');}catch(error){await rm(join(app,'runtime'),{recursive:true,force:true});await rename(join(backup,'runtime'),join(app,'runtime'));await cp(join(backup,'lite.lock.json'),join(app,'lite.lock.json'));throw error;}
  return {currentVersion:previous.kitVersion,targetVersion:packageInfo.version,changed:true,applied:true,backup,requiresBuildAndPublication:true,hostIntegration:report.hostIntegration};
 }finally{await rm(staging,{recursive:true,force:true});}
}
export async function addModule(appPath,spec){
 const app=resolve(appPath),file=join(app,'brand.json'),current=JSON.parse(await readFile(file,'utf8')),module=JSON.parse(await readFile(resolve(spec),'utf8'));
 const owned=await Promise.all(current.modules.map(async item=>{const schema=join(app,'app/modules',item.id,'schema.json');return await exists(schema)?JSON.parse(await readFile(schema,'utf8')):item;}));
 const next=defineApp({...current,modules:[...owned,module]});await scaffoldModules(app,next.modules);await writeFile(file,JSON.stringify(next,null,2)+'\n');
 return {module:module.id,registered:['navigation','search','api','mcp'],requiresBuildAndPublication:true};
}
async function main(){const [command,...args]=process.argv.slice(2),options={};for(let i=0;i<args.length;i++){if(args[i]==='--apply')options.apply=true;else if(['--out','--spec','--app'].includes(args[i])&&args[i+1])options[args[i++].slice(2)]=args[i];else throw new Error(`Argument inconnu : ${args[i]}`);}
 if(command==='create')console.log(JSON.stringify(await createApp(options),null,2));
 else if(command==='doctor'){const report=await doctor(options.app??process.cwd());console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;}
 else if(command==='upgrade'){if(!options.app)throw new Error('upgrade exige --app <application>.');console.log(JSON.stringify(await upgrade(options.app,options.apply),null,2));}
 else if(command==='module'){if(!options.app||!options.spec)throw new Error('module exige --app et --spec.');console.log(JSON.stringify(await addModule(options.app,options.spec),null,2));}
 else if(command==='adopt'){if(!options.app)throw new Error('adopt exige --app <application>.');const report=await adopt(options.app,options.apply);console.log(JSON.stringify(report,null,2));if(report.conflicts.length)process.exitCode=2;}
 else if(command==='--version')console.log(packageInfo.version);
 else if(!command||command==='--help')console.log('Lite\n  create --spec brief.json --out dossier-vide\n  module --app dossier --spec module.json\n  doctor --app dossier\n  upgrade --app dossier [--apply]\n  adopt --app dossier [--apply]   (standard d’orchestration : copies de .cursor/skills/lite-orchestration, règle Cursor et découverte .agents/skills générée, gérées par manifest.json)');
 else throw new Error('Commande inconnue. Utilisez --help.');
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().catch(e=>{console.error(e.message);process.exitCode=1;});
