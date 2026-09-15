import type { AppDefinition, Field, Role } from './types.ts';
import { visibleModules } from './registry.ts';
import { fail, validateData } from './validation.ts';

export type ApiCall=(path:string,init?:{method?:string;body?:string})=>Promise<any>;
export type DataTool={name:string;title:string;description:string;inputSchema:Record<string,unknown>;annotations:{readOnlyHint:boolean;destructiveHint:boolean;idempotentHint:boolean;untrustedContentHint:boolean};execute:(input:unknown)=>Promise<unknown>};
const object=(properties:Record<string,unknown>,required:string[]=[])=>({type:'object',properties,required,additionalProperties:false});
const idSchema={type:'string',minLength:1,maxLength:100,pattern:'^[a-zA-Z0-9_-]+$'};
const versionSchema={type:'integer',minimum:1};
function input(value:unknown,allowed:string[]){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))fail(400,'invalid_arguments','Arguments invalides.');return value as Record<string,any>;}
function recordId(value:unknown):string {if(typeof value!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(value))fail(400,'invalid_id','Référence invalide.');return value;}
function expectedVersion(value:unknown):number{if(!Number.isInteger(value)||Number(value)<1)fail(400,'version_required','Version positive requise.');return Number(value);}
function query(values:Record<string,any>,moduleId?:string){
  if(values.query!==undefined&&(typeof values.query!=='string'||values.query.length>120))fail(400,'invalid_query','Recherche invalide.');
  if(values.offset!==undefined&&(!Number.isInteger(values.offset)||values.offset<0||values.offset>100000))fail(400,'invalid_offset','Pagination invalide.');
  return new URLSearchParams({q:values.query??'',offset:String(values.offset??0),limit:'100',...(moduleId?{module:moduleId}:{})});
}
export function fieldSchema(f:Field):Record<string,unknown>{return {type:f.type==='number'?'number':f.type==='boolean'?'boolean':'string',description:f.label,...(f.type==='select'?{enum:f.options}:{}),...(f.type==='email'?{format:'email'}:{}),...(f.type==='date'?{format:'date'}:{}),...(f.maxLength?{maxLength:f.maxLength}:{}),...(f.min!==undefined?{minimum:f.min}:{}),...(f.max!==undefined?{maximum:f.max}:{})};}

/** WebMCP and HTTP MCP expose the very same tools, schemas and data API. */
export function dataTools(app:AppDefinition,role:Role,api:ApiCall,writable=true):DataTool[]{
  const result:DataTool[]=[];
  const add=(name:string,title:string,description:string,schema:Record<string,unknown>,readOnly:boolean,execute:DataTool['execute'],destructive=false)=>{result.push({name,title,description,inputSchema:schema,annotations:{readOnlyHint:readOnly,destructiveHint:destructive,idempotentHint:readOnly,untrustedContentHint:true},execute});};
  add('lite_modules','Modules disponibles','Lire le registre des modules accessibles et leurs champs.',object({}),true,async value=>{input(value,[]);return api('registry');});
  add('lite_search','Rechercher dans les données','Recherche plein texte dans les champs autorisés de l’espace. Les réglages de recherche et permissions sont appliqués côté serveur.',object({query:{type:'string',maxLength:120},moduleId:{type:'string'},offset:{type:'integer',minimum:0,maximum:100000}},['query']),true,async value=>{const v=input(value,['query','moduleId','offset']);if(typeof v.query!=='string')fail(400,'invalid_query','Texte de recherche requis.');if(v.moduleId!==undefined&&!visibleModules(app,role).some(m=>m.id===v.moduleId))fail(404,'module_not_found','Module inaccessible.');return api(`search?${query(v,v.moduleId)}`);});
  for(const module of visibleModules(app,role)){
    const prefix=`lite_${module.id.replaceAll('-','_')}`;
    const listSchema=object({query:{type:'string',maxLength:120},offset:{type:'integer',minimum:0,maximum:100000}});
    add(`${prefix}_list`,`${module.name} : lister`,`Lister les données de ${module.name}. Une query interroge le moteur de recherche ; utiliser offset pour la suite.`,listSchema,true,async value=>{const v=input(value,['query','offset']);const params=query(v,module.id);return v.query?api(`search?${params}`):api(`${module.api}?offset=${v.offset??0}&limit=100`);});
    if(module.kind!=='business'){
      if(['tasks','files','support','members','audit'].includes(module.id))add(`${prefix}_get`,`${module.name} : consulter`,'Consulter un élément existant dans l’espace actuel.',object({recordId:idSchema},['recordId']),true,async value=>{const v=input(value,['recordId']);return api(`${module.api}/${recordId(v.recordId)}${module.id==='files'?'/metadata':''}`);});
      continue;
    }
    const mod=app.modules.find(m=>m.id===module.id)!;
    add(`${prefix}_get`,`${module.name} : consulter`,'Lire une fiche avec sa version actuelle.',object({recordId:idSchema},['recordId']),true,async value=>{const v=input(value,['recordId']);return api(`${module.api}/${recordId(v.recordId)}`);});
    if(!writable||!module.writeRoles.includes(role))continue;
    const dataSchema=object(Object.fromEntries(mod.fields.map(f=>[f.key,fieldSchema(f)])),mod.fields.filter(f=>f.required).map(f=>f.key));
    add(`${prefix}_create`,`${module.name} : créer`,'Créer une fiche. Les validations métier, les droits et l’indexation sont appliqués par l’API.',object({data:dataSchema},['data']),false,async value=>{const v=input(value,['data']);return api(module.api,{method:'POST',body:JSON.stringify({data:validateData(mod,v.data)})});});
    add(`${prefix}_update`,`${module.name} : modifier`,'Remplacer les champs d’une fiche en fournissant sa version actuelle. Relire la fiche en cas de conflit.',object({recordId:idSchema,version:versionSchema,data:dataSchema},['recordId','version','data']),false,async value=>{const v=input(value,['recordId','version','data']);return api(`${module.api}/${recordId(v.recordId)}`,{method:'PATCH',body:JSON.stringify({version:expectedVersion(v.version),data:validateData(mod,v.data)})});});
    add(`${prefix}_archive`,`${module.name} : archiver`,'Retirer une fiche des listes et de la recherche. La version actuelle est obligatoire.',object({recordId:idSchema,version:versionSchema},['recordId','version']),false,async value=>{const v=input(value,['recordId','version']);return api(`${module.api}/${recordId(v.recordId)}`,{method:'DELETE',body:JSON.stringify({version:expectedVersion(v.version)})});},true);
  }
  return result;
}
