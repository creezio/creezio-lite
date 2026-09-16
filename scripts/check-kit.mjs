import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {defineApp} from '../runtime/core/validation.ts';
import {orchestrationSources,orchestrationDir} from '../bin/lite.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
// Standard d'orchestration : une seule source, frontmatter de compétence valide, aucune donnée privée.
const orchestration=await orchestrationSources();
if(!/^---\nname: lite-orchestration\ndescription: .{40,1024}\n---\n/.test(await readFile(join(root,orchestrationDir,'SKILL.md'),'utf8')))throw new Error('SKILL.md : frontmatter name/description attendu.');
for(const [path,source] of Object.entries(orchestration)){const content=await readFile(source,'utf8');if(!content.trim())throw new Error(`Fichier d’orchestration vide : ${path}`);if(/bc-[0-9a-f]{8}-[0-9a-f]{4}-|run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-|\/home\/|\/Users\/|[A-Z]:\\/.test(content))throw new Error(`Donnée privée ou identifiant de tâche dans ${path}`);}
const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const hosting=JSON.parse(await readFile(join(root,'template/.openai/hosting.json'),'utf8'));
if(hosting.project_id||hosting.d1!=='DB'||hosting.r2!=='BUCKET')throw new Error('Le template doit être indépendant de tout Site existant.');
for(const file of ['README.md','AGENTS.md','START-HERE.md','docs/MODULES.md','docs/API.md','docs/SEARCH.md','docs/UPDATES.md','template/AGENTS.md','template/README.md'])if(!(await readFile(join(root,file),'utf8')).trim())throw new Error(`Document vide : ${file}`);
for(const file of await readdir(join(root,'examples')))if(file.endsWith('.json'))defineApp(JSON.parse(await readFile(join(root,'examples',file),'utf8')));
async function scan(dir){for(const entry of await readdir(dir,{withFileTypes:true})){if(['node_modules','dist','.sites-runtime','.wrangler','.next'].includes(entry.name))continue;const path=join(dir,entry.name);if(entry.isDirectory())await scan(path);else if(/\.(?:[cm]?[jt]sx?|json|css|md)$/.test(entry.name)){const content=await readFile(path,'utf8');if(/from ['"]@lite\//.test(content) && content.includes('registry.npmjs.org/@lite/'))throw new Error(`Un module interne doit être local : ${path}`);}}}
await scan(join(root,'runtime'));await scan(join(root,'template'));
console.log(JSON.stringify({ok:true,version:pkg.version,examples:2,templateHasSiteIdentity:false,orchestrationFiles:Object.keys(orchestration).length},null,2));
