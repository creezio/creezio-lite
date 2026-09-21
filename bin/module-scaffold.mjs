import {mkdir,writeFile,readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
const marker='// Generated module imports — keep declarations in modules/<id>/index.ts.';
export async function scaffoldModules(app,modules,{all=false}={}){
 const index=join(app,'app/modules/index.ts');
 if(!all){try{const source=await readFile(index,'utf8');if(!source.startsWith(marker))throw new Error('Module registry is customised: merge the new module explicitly before retrying.');}catch(e){if(e.code!=='ENOENT')throw e;}}
 for(const mod of modules){
  const directory=join(app,'app/modules',mod.id);let exists=false;try{await stat(directory);exists=true;}catch(e){if(e.code!=='ENOENT')throw e;}if(exists)continue;
  await mkdir(directory,{recursive:true});
  await writeFile(join(directory,'schema.json'),JSON.stringify(mod,null,2)+'\n');
  const definition=`import { appDefinition } from '../../app-definition.ts';\nimport type { BrandModuleDef } from '../../../runtime/core/module-contract.ts';\nconst schema=appDefinition.modules.find(module=>module.id===${JSON.stringify(mod.id)})!;\nexport default {\n id:${JSON.stringify(mod.id)},\n entitySpecs:{[schema.id]:{schema,storage:{kind:'records'}}},\n operations:[], migrations:[],
 onboarding:{steps:[{id:schema.id,label:schema.name,texts:{description:schema.description}}]},\n assistantSources:[{kind:'entity',entityKind:schema.id,titleFields:[schema.titleField],type:schema.singular,urlWhenId:'/'+schema.id+'?record={id}',urlWhenSearch:'/'+schema.id}],\n demo:{scenarios:[{id:schema.id+'-tour',title:schema.name,steps:[{id:'open',kind:'navigate',href:'/'+schema.id},{id:'intro',kind:'say',title:schema.name,body:schema.description}]}]},\n} satisfies BrandModuleDef;\n`;
  await writeFile(join(directory,'index.ts'),definition);
  for(const [name,body] of Object.entries({'PRD.md':`# ${mod.name}\n\n${mod.description}\n\nLe schéma canonique est schema.json ; brand.json en est un instantané de compatibilité vérifié ; ce module possède ses règles, opérations et migrations D1.`, 'INTERVIEW.md':'# Décisions métier\n\nConsigner ici les décisions et leurs sources avant d’étendre le module.', 'TODO.md':'# Recette\n\n- [ ] Cas métier nominal et refus de droits.\n- [ ] Deux espaces : aucune lecture ni écriture croisée.\n- [ ] Navigation, filtre et brouillon conservés entre onglets.\n- [ ] Tri et pagination sur plus d’une page.\n- [ ] Mise à jour et conflit de version.','CHANGELOG.md':'# Historique\n\n- Création du contrat de module D1/R2.'}))await writeFile(join(directory,name),body+'\n');
 }
 await mkdir(join(app,'app/modules'),{recursive:true});
 await writeFile(join(app,'app/modules/schemas.ts'),'// Generated import list. Edit each module schema.json, then run sync:module-schemas.\n'+modules.map((mod,i)=>`import schema${i} from './${mod.id}/schema.json' with {type:'json'};`).join('\n')+'\nexport const moduleSchemas=['+modules.map((_,i)=>'schema'+i).join(',')+'];\n');
 const imports=modules.map((mod,i)=>`import module${i} from './${mod.id}/index.ts';`).join('\n');
 await mkdir(join(app,'app/modules'),{recursive:true});
 await writeFile(index,`${marker}\nimport { createBrandModuleRegistry } from '../../runtime/core/module-contract.ts';\nimport { appDefinition } from '../app-definition.ts';\n${imports}\nexport const moduleRegistry=createBrandModuleRegistry(appDefinition,[${modules.map((_,i)=>'module'+i).join(',')}]);\n`);
}
