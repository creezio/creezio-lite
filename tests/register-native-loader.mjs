import { registerHooks, createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const deps=createRequire(join(root,'template/package.json'));
function source(path){const normalized=path.replaceAll('\\','/').replace(/\/dist\//g,'/src/');return [normalized,normalized.replace(/\.js$/,'.ts'),`${normalized}.ts`,`${normalized}.tsx`,join(normalized,'index.ts')].find(p=>existsSync(p)&&!p.endsWith('/src'));}
registerHooks({resolve(spec,context,next){
  let file;
  if(spec==='@lite/core'||spec.startsWith('@lite/core/'))file=source(resolve(root,'runtime/core',spec.slice('@lite/core/'.length)||'index.ts'));
  else if(spec.startsWith('@lite/')){const [name,...parts]=spec.slice('@lite/'.length).split('/');const base=join(root,'runtime/modules',name),manifest=JSON.parse(readFileSync(join(base,'package.json'),'utf8'));const key=parts.length?'./'+parts.join('/'):'.';const entry=manifest.exports?.[key];file=source(resolve(base,typeof entry==='string'?entry:entry?.import??(parts.length?parts.join('/'):'src/index.ts')));}
  else if(spec.startsWith('.')&&context.parentURL?.startsWith(pathToFileURL(join(root,'runtime/modules')).href))file=source(fileURLToPath(new URL(spec,context.parentURL)));
  if(file)return next(pathToFileURL(file).href,context);
  try{return next(spec,context);}catch(e){if(spec.startsWith('.')||spec.startsWith('/')||spec.startsWith('node:'))throw e;return next(pathToFileURL(deps.resolve(spec)).href,context);}
}});
