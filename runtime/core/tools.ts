import type { RequestAccessContext } from './access-profiles-store.ts';
import type { AppDefinition, Role, Workspace } from './types.ts';
import { coreOperations, objectSchema, idSchema, operationAllowed, schemaPattern, SCHEMA_KEYWORDS, UNSAFE_PROPERTY_NAMES, type Operation, type JsonSchema } from './operations.ts';
import { fail } from './validation.ts';
export {fieldSchema} from './operations.ts';

export type ApiCall=(path:string,init?:{method?:string;body?:string})=>Promise<any>;
export type DataTool={name:string;title:string;description:string;inputSchema:Record<string,unknown>;annotations:{readOnlyHint:boolean;destructiveHint:boolean;idempotentHint:boolean;untrustedContentHint:boolean};execute:(input:unknown)=>Promise<unknown>};
export type ToolBinding={name:string;operationId:string;description:string;enabled:boolean;version:number;custom:boolean};

/** Validation failures expose the offending field as their only public detail. */
function invalid(path:string,message:string):never{fail(400,'invalid_arguments',path+message,{field:path.replace(/[\x00-\x1f\x7f]/g,'?').slice(0,200)});}
const has=(schema:JsonSchema,keys:readonly string[])=>keys.some(key=>schema[key]!==undefined);
const calendarDate=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const dateTime=(value:string)=>calendarDate(value.slice(0,10))&&Number(value.slice(11,13))<24&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value));
const uri=(value:string)=>{try{const parsed=new URL(value);return /^[a-z][a-z0-9+.-]*:$/i.test(parsed.protocol);}catch{return false;}};
/**
 * Enforce the closed schema subset documented on SCHEMA_KEYWORDS (operations.ts). Only own properties of the
 * value and of `properties` are consulted, so a JSON body naming constructor or __proto__ is never matched
 * against Object.prototype; those names are refused outright. anyOf never short-circuits its siblings.
 */
export function validateSchema(schema:JsonSchema,value:unknown,path='arguments'):void {
  if(schema.anyOf){let accepted=false;for(const option of schema.anyOf){try{validateSchema(option,value,path);accepted=true;break;}catch{}}if(!accepted)invalid(path,' : valeur invalide.');}
  if(schema.type==='null'&&value!==null)invalid(path,' : null attendu.');
  if(schema.enum&&!schema.enum.includes(value))invalid(path,' : valeur non autorisée.');
  const type=schema.type;
  if(type==='object'||(type===undefined&&has(schema,SCHEMA_KEYWORDS.object))){
    if(!value||typeof value!=='object'||Array.isArray(value))invalid(path,' : objet requis.');
    const v=value as Record<string,unknown>,properties:JsonSchema=schema.properties&&typeof schema.properties==='object'?schema.properties:{};
    if((schema.required??[]).some((key:string)=>!Object.hasOwn(v,key)||v[key]===undefined))invalid(path,' : champ obligatoire absent.');
    for(const [key,item] of Object.entries(v)){
      if((UNSAFE_PROPERTY_NAMES as readonly string[]).includes(key))invalid(path+'.'+key,' : nom de champ refusé.');
      const child=Object.hasOwn(properties,key)?properties[key]:undefined;
      if(child){validateSchema(child,item,path+'.'+key);continue;}
      if(schema.additionalProperties===false)invalid(path+'.'+key,' : champ inconnu.');
      if(schema.additionalProperties&&typeof schema.additionalProperties==='object')validateSchema(schema.additionalProperties,item,path+'.'+key);
    }
  }
  if(type==='array'||(type===undefined&&has(schema,SCHEMA_KEYWORDS.array))){
    if(!Array.isArray(value)||(schema.maxItems!==undefined&&value.length>schema.maxItems)||(schema.minItems!==undefined&&value.length<schema.minItems))invalid(path,' : liste invalide.');
    if(schema.items)for(const item of value)validateSchema(schema.items,item,path);
  }
  if(type==='string'||(type===undefined&&has(schema,SCHEMA_KEYWORDS.string))){
    if(typeof value!=='string'||(schema.minLength!==undefined&&value.length<schema.minLength)||(schema.maxLength!==undefined&&value.length>schema.maxLength))invalid(path,' : texte invalide.');
    if(schema.format!==undefined){
      const ok=schema.format==='email'?/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value):schema.format==='date'?calendarDate(value):schema.format==='date-time'?dateTime(value):schema.format==='uri'?uri(value):false;
      if(!ok)invalid(path,schema.format==='email'?' : e-mail invalide.':' : format invalide.');
    }
    // A declared pattern is enforced, never skipped: an uncompilable pattern refuses the value instead of accepting it.
    if(schema.pattern!==undefined){let expression:RegExp|null=null;try{expression=schemaPattern(schema.pattern,path);}catch{expression=null;}if(!expression||!expression.test(value))invalid(path,' : format invalide.');}
  }
  if(type==='number'||type==='integer'||(type===undefined&&has(schema,SCHEMA_KEYWORDS.number)))if(typeof value!=='number'||!Number.isFinite(value)||(type==='integer'&&!Number.isInteger(value))||(schema.minimum!==undefined&&value<schema.minimum)||(schema.maximum!==undefined&&value>schema.maximum))invalid(path,' : nombre invalide.');
  if(type==='boolean'&&typeof value!=='boolean')invalid(path,' : booléen requis.');
}
function legacyRead(op:Operation){return op.kind==='system'&&['tasks','files','support','members','audit'].includes(op.moduleId)&&['list','get','detail'].includes(op.id.split('.').at(-1)!);}
function toolSchema(op:Operation):JsonSchema {
  // Application operations use their declared inputSchema (path params, query, body); never the legacy CRUD branch.
  if(op.source==='app')return op.inputSchema;
  if(legacyRead(op))return op.id.endsWith('.list')?objectSchema({query:{type:'string',maxLength:120},offset:{type:'integer',minimum:0,maximum:100000}}):objectSchema({recordId:idSchema},['recordId']);
  if(op.id==='search.query')return objectSchema({query:{type:'string',maxLength:120},moduleId:idSchema,offset:{type:'integer',minimum:0,maximum:100000}},['query']);
  if(op.kind==='business'){
    const action=op.id.split('.').at(-1),fields:JsonSchema={};const required:string[]=[];
    if(action==='list')Object.assign(fields,{query:{type:'string',maxLength:120},offset:{type:'integer',minimum:0,maximum:100000}});
    if(['get','update','archive'].includes(action!)){fields.recordId=idSchema;required.push('recordId');}
    if(op.bodySchema){Object.assign(fields,op.bodySchema.properties);required.push(...(op.bodySchema.required??[]));}
    return objectSchema(fields,required);
  }
  return op.inputSchema;
}
export function operationTool(op:Operation,api:ApiCall,binding?:ToolBinding):DataTool {
  const inputSchema=toolSchema(op),read=op.method==='GET';
  return {name:binding?.name??op.toolName,title:op.description,description:binding?.description??op.description,inputSchema,
    annotations:{readOnlyHint:read,destructiveHint:op.method==='DELETE',idempotentHint:read||op.method==='PUT',untrustedContentHint:true},
    execute:async(value)=>{
      validateSchema(inputSchema,value);const input=value as Record<string,any>;let path=op.path,body=input.body,query:Record<string,unknown>=input.query??{};
      if(legacyRead(op)){
        if(op.id.endsWith('.list')){if(input.query)return api('search?'+new URLSearchParams({q:input.query,module:op.moduleId,offset:String(input.offset??0),limit:'100'}));query={offset:input.offset,limit:100};}
        else{if(/[\/\\]/.test(input.recordId)||['.','..'].includes(input.recordId))fail(400,'invalid_arguments','Identifiant invalide.');path=path.replace(':id',encodeURIComponent(input.recordId));}
      }
      if(op.id==='search.query')query={q:input.query,module:input.moduleId,offset:input.offset};
      if(op.kind==='business'&&op.source!=='app'){
        if(input.recordId!==undefined&&(/[\/\\]/.test(input.recordId)||['.','..'].includes(input.recordId)))fail(400,'invalid_arguments','Identifiant invalide.');
        path=path.replace(':id',encodeURIComponent(input.recordId??''));
        query={q:input.query,offset:input.offset,limit:100};
        body=op.bodySchema?Object.fromEntries(Object.keys(op.bodySchema.properties).map(key=>[key,input[key]])):undefined;
      }
      path=path.replace(/:([A-Za-z0-9_]+)/g,(_,key)=>{const v=input[key];if(typeof v!=='string'||!v||/[\/\\]/.test(v)||v==='.'||v==='..')fail(400,'invalid_arguments','Identifiant invalide.');return encodeURIComponent(v);});
      const params=new URLSearchParams();for(const [key,value] of Object.entries(query))if(value!==undefined&&value!==null&&value!=='')params.set(key,String(value));
      return api(path.replace('/api/v1/','')+(params.size?'?'+params:''),{method:op.method,...(body!==undefined?{body:JSON.stringify(body)}:{})});
    }};
}
/** Both protocols consume the same operation bindings; HTTP is always the executor. */
export function dataTools(app:AppDefinition,role:Role,api:ApiCall,writable=true,options:{operations?:Operation[];workspace?:Workspace;bindings?:ToolBinding[];machine?:boolean;access?:RequestAccessContext|null}={}):DataTool[]{
  const org=options.workspace??{id:'',name:'',role},operations=options.operations??coreOperations(app);
  const bindings=options.bindings??operations.filter(op=>op.mcp).map(op=>({name:op.toolName,operationId:op.id,description:op.description,enabled:true,version:0,custom:false}));
  return bindings.flatMap(binding=>{const op=operations.find(o=>o.id===binding.operationId);return op&&op.mcp&&binding.enabled&&operationAllowed(op,org,options.access)&&(!options.machine||op.tokenAllowed)&&(writable||op.method==='GET')?[operationTool(op,api,binding)]:[];});
}
