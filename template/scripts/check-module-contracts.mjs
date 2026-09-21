import {readFile} from 'node:fs/promises';
import './register-module-loader.mjs';
const declaration=await import('../app/modules/index.ts');
const moduleRegistry=declaration.moduleRegistry??declaration.createModuleRegistry?.();
if(!moduleRegistry)throw new Error('Export moduleRegistry or createModuleRegistry from app/modules/index.ts.');
const migrations=moduleRegistry.collectModuleMigrations();
for(const item of migrations)await readFile(new URL('../'+item.file,import.meta.url),'utf8');
for(const module of moduleRegistry.modules){
 if(!module.demo?.scenarios.length&&!module.demoJustification?.trim())throw new Error(`Missing demo: ${module.id}`);
 if(!module.assistantSources?.length&&!module.assistantSourcesJustification?.trim())throw new Error(`Missing assistant declaration: ${module.id}`);
 for(const file of ['PRD.md','INTERVIEW.md','TODO.md','CHANGELOG.md'])await readFile(new URL('../app/modules/'+module.id+'/'+file,import.meta.url),'utf8');
}
console.log(`${moduleRegistry.modules.length} module contracts validated; ${migrations.length} owned migrations.`);

const {moduleSchemas}=await import('../app/modules/schemas.ts');
const brand=JSON.parse(await readFile(new URL('../brand.json',import.meta.url),'utf8'));
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
if(canonical(brand.modules)!==canonical(moduleSchemas))throw new Error('Schema snapshot out of date: npm run sync:module-schemas.');
