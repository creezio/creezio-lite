import {readFile,writeFile} from 'node:fs/promises';
import {moduleSchemas} from '../app/modules/schemas.ts';
import {defineApp} from '../runtime/core/validation.ts';
const file=new URL('../brand.json',import.meta.url),brand=JSON.parse(await readFile(file,'utf8'));
const next=defineApp({...brand,modules:moduleSchemas});
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
if(process.argv.includes('--check')){if(canonical(brand.modules)!==canonical(moduleSchemas))throw new Error('brand.json module snapshot differs: edit app/modules/<id>/schema.json and run npm run sync:module-schemas.');}
else await writeFile(file,JSON.stringify(next,null,2)+'\n');
