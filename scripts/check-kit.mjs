import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {defineApp} from '../runtime/core/validation.ts';
import {orchestrationSources,orchestrationGenerated,skillFrontmatter,orchestrationDir,orchestrationManifest,orchestrationRule,orchestrationDiscovery} from '../bin/lite.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const exists=async path=>{try{await readFile(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const privateData=/bc-[0-9a-f]{8}-[0-9a-f]{4}-|run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-|\/home\/|\/Users\/|[A-Z]:\\/;
// Standard d'orchestration : une seule source, frontmatter de compétence valide, aucune donnée privée.
const orchestration=await orchestrationSources();
if(!/^---\nname: lite-orchestration\ndescription: .{40,1024}\n---\n/.test(await readFile(join(root,orchestrationDir,'SKILL.md'),'utf8')))throw new Error('SKILL.md : frontmatter name/description attendu.');
for(const [path,source] of Object.entries(orchestration)){if(!path.startsWith('.cursor/'))throw new Error(`Source d’orchestration hors de .cursor : ${path}`);const content=await readFile(source,'utf8');if(!content.trim())throw new Error(`Fichier d’orchestration vide : ${path}`);if(privateData.test(content))throw new Error(`Donnée privée ou identifiant de tâche dans ${path}`);}
if(await exists(join(root,orchestrationManifest)))throw new Error(`${orchestrationManifest} appartient aux copies générées, pas à la source canonique du kit.`);
if(!/^---\n(?:.*\n)*?alwaysApply: true\n(?:.*\n)*?---\n/.test(await readFile(orchestration[orchestrationRule],'utf8')))throw new Error('La règle Cursor distribuée doit porter alwaysApply: true.');
// Découverte Codex/Cursor : fichier .agents/skills généré depuis la source canonique (même nom et description), référençant chaque ressource distribuée ; jamais une copie manuelle divergente dans le kit.
const generated=await orchestrationGenerated(orchestration);
const canonical=skillFrontmatter(await readFile(orchestration[orchestrationDir+'/SKILL.md'],'utf8'));
for(const [path,bytes] of Object.entries(generated)){const content=bytes.toString();const front=skillFrontmatter(content);if(front.name!==canonical.name||front.description!==canonical.description)throw new Error(`Découverte ${path} : frontmatter différent de la source canonique.`);for(const source of Object.keys(orchestration))if(!content.includes('`'+source+'`'))throw new Error(`Découverte ${path} : ressource distribuée non référencée : ${source}`);if(privateData.test(content))throw new Error(`Donnée privée dans ${path}`);if(await exists(join(root,path))&&!(await readFile(join(root,path))).equals(bytes))throw new Error(`${path} présent dans le kit mais différent du fichier généré : ne pas maintenir de copie manuelle.`);}
if(Object.keys(generated).some(p=>!p.startsWith('.agents/skills/'))||!(orchestrationDiscovery in generated))throw new Error('La découverte générée doit vivre sous .agents/skills.');
// Scripts distribués : autonomes (imports node: seulement), exécutables depuis une copie sans le kit.
for(const path of Object.keys(orchestration).filter(p=>/\/scripts\/[^/]+\.mjs$/.test(p))){const imports=[...(await readFile(orchestration[path],'utf8')).matchAll(/^import .* from ['"]([^'"]+)['"]/gm)].map(m=>m[1]);if(!imports.length||imports.some(i=>!i.startsWith('node:')))throw new Error(`${path} doit rester autonome : imports node: seulement (${imports.join(', ')}).`);}
// Contrat de planification : les deux exemples valident, ready est fiable et reproduit exactement le rapport attendu de PLANNING.md §5.
const planning=await import('../.cursor/skills/lite-orchestration/scripts/plan-missions.mjs');
const planningDir=join(root,orchestrationDir),planningSchemas=await planning.loadSchemas();
const examplePlan=JSON.parse(await readFile(join(planningDir,'examples/planning-plan.json'),'utf8')),exampleState=JSON.parse(await readFile(join(planningDir,'examples/planning-state.json'),'utf8'));
const validation=planning.evaluate('validate',{plan:examplePlan,state:exampleState,schemas:planningSchemas});
if(validation.code!==planning.exitCodes.ok||!validation.report.valid||validation.report.warnings.length)throw new Error(`Exemples du contrat de planification invalides : ${JSON.stringify(validation.report.errors.concat(validation.report.warnings))}`);
const decision=planning.evaluate('ready',{plan:examplePlan,state:exampleState,schemas:planningSchemas});
const oracle=(await readFile(join(planningDir,'PLANNING.md'),'utf8')).match(/```json\n([\s\S]*?)\n```/);
if(!oracle)throw new Error('PLANNING.md doit porter le rapport attendu de ready (§5) dans un bloc json.');
if(decision.code!==planning.exitCodes.ok||!decision.report.reliable||JSON.stringify(sortKeys(decision.report))!==JSON.stringify(sortKeys(JSON.parse(oracle[1]))))throw new Error('PLANNING.md §5 : le rapport attendu diffère de la sortie réelle de plan-missions ready sur les exemples.');
function sortKeys(value){return Array.isArray(value)?value.map(sortKeys):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,sortKeys(value[k])])):value;}
// Points d'entrée documentés : AGENTS.md (Codex et Cursor) et la règle Cursor renvoient vers la compétence canonique distribuée.
for(const file of ['AGENTS.md','template/AGENTS.md','template/'+orchestrationRule])if(!(await readFile(join(root,file),'utf8')).includes(orchestrationDir+'/SKILL.md'))throw new Error(`${file} doit renvoyer vers ${orchestrationDir}/SKILL.md.`);
if(!(await readFile(join(root,'template/AGENTS.md'),'utf8')).includes(orchestrationDiscovery))throw new Error(`template/AGENTS.md doit mentionner le fichier de découverte ${orchestrationDiscovery}.`);
const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const hosting=JSON.parse(await readFile(join(root,'template/.openai/hosting.json'),'utf8'));
if(hosting.project_id||hosting.d1!=='DB'||hosting.r2!=='BUCKET')throw new Error('Le template doit être indépendant de tout Site existant.');
for(const file of ['README.md','AGENTS.md','START-HERE.md','docs/MODULES.md','docs/API.md','docs/SEARCH.md','docs/UPDATES.md','template/AGENTS.md','template/README.md'])if(!(await readFile(join(root,file),'utf8')).trim())throw new Error(`Document vide : ${file}`);
for(const file of await readdir(join(root,'examples')))if(file.endsWith('.json'))defineApp(JSON.parse(await readFile(join(root,'examples',file),'utf8')));
async function scan(dir){for(const entry of await readdir(dir,{withFileTypes:true})){if(['node_modules','dist','.sites-runtime','.wrangler','.next'].includes(entry.name))continue;const path=join(dir,entry.name);if(entry.isDirectory())await scan(path);else if(/\.(?:[cm]?[jt]sx?|json|css|md)$/.test(entry.name)){const content=await readFile(path,'utf8');if(/from ['"]@lite\//.test(content) && content.includes('registry.npmjs.org/@lite/'))throw new Error(`Un module interne doit être local : ${path}`);}}}
await scan(join(root,'runtime'));await scan(join(root,'template'));
console.log(JSON.stringify({ok:true,version:pkg.version,examples:2,templateHasSiteIdentity:false,orchestrationFiles:Object.keys(orchestration).length,orchestrationGenerated:Object.keys(generated).length,planningExamples:{valid:true,missions:validation.report.summary.missions,proposals:decision.report.proposals.length}},null,2));
