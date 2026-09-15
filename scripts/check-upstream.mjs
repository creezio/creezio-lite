import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function checkUpstream(){
  const baseline=JSON.parse(await readFile(join(root,'upstream-packages.lock.json'),'utf8'));
  const patches=JSON.parse(await readFile(join(root,'upstream-patches.json'),'utf8'));
  if(baseline.commit!==patches.commit)throw new Error('Les patchs ne correspondent pas à la référence upstream.');
  const issues=[];let exact=0,patched=0;
  for(const [source,original] of Object.entries(baseline.allFiles)){
    const destination=baseline.relocated?.[source]??source;
    let current;try{current=hash(await readFile(join(root,destination)));}catch{issues.push(`Source manquante : ${source}`);continue;}
    if(current===original){exact++;continue;}
    const patch=patches.changes[source];
    if(!patch?.reason||patch.sha256!==current||patch.originalSha256!==original)issues.push(`Différence upstream non recensée : ${source}`);
    else patched++;
  }
  for(const file of Object.keys(patches.changes))if(!baseline.allFiles[file])issues.push(`Patch sans source upstream : ${file}`);
  const manifests=Object.keys(baseline.files).filter(f=>/^packages\/[^/]+\/package\.json$/.test(f));
  if(manifests.length!==36)issues.push('Les 36 manifests natifs doivent être présents.');
  if(issues.length)throw new Error(issues.join('\n'));
  return {ok:true,packages:manifests.length,originalFiles:Object.keys(baseline.allFiles).length,identicalFiles:exact,documentedPatches:patched,commit:baseline.commit};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)console.log(JSON.stringify(await checkUpstream(),null,2));
