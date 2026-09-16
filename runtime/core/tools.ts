import type { AppDefinition, Role, Workspace } from './types.ts';
import { coreOperations, objectSchema, idSchema, operationAllowed, schemaPattern, type Operation, type JsonSchema } from './operations.ts';
import { fail } from './validation.ts';
export {fieldSchema} from './operations.ts';

export type ApiCall=(path:string,init?:{method?:string;body?:string})=>Promise<any>;
export type DataTool={name:string;title:string;description:string;inputSchema:Record<string,unknown>;annotations:{readOnlyHint:boolean;destructiveHint:boolean;idempotentHint:boolean;untrustedContentHint:boolean};execute:(input:unknown)=>Promise<unknown>};
export type ToolBinding={name:string;operationId:string;description:string;enabled:boolean;version:number;custom:boolean};

export function validateSchema(schema:JsonSchema,value:unknown,path='arguments'):void {
  if(schema.anyOf){for(const option of schema.anyOf){try{validateSchema(option,value,path);return;}catch{}}fail(400,'invalid_arguments',path+' : valeur invalide.');}
  if(schema.type==='null'&&value!==null)fail(400,'invalid_arguments',path+' : null attendu.');
  if(schema.enum&&!schema.enum.includes(value))fail(400,'invalid_arguments',path+' : valeur non autorisée.');
  if(schema.type==='object'){
    if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'invalid_arguments',path+' : objet requis.');
    const v=value as Record<string,unknown>;if((schema.required??[]).some((key:string)=>v[key]===undefined))fail(400,'invalid_arguments',path+' : champ obligatoire absent.');
    for(const [key,item] of Object.entries(v)){const child=schema.properties?.[key];if(!child&&schema.additionalProperties===false)fail(400,'invalid_arguments',path+'.'+key+' : champ inconnu.');if(child)validateSchema(child,item,path+'.'+key);}
  }
  if(schema.type==='array'){
    if(!Array.isArray(value)||(schema.maxItems!==undefined&&value.length>schema.maxItems))fail(400,'invalid_arguments',path+' : liste invalide.');
    if(schema.items)for(const item of value)validateSchema(schema.items,item,path);
  }
  if(schema.type==='string'){
    if(typeof value!=='string'||(schema.minLength!==undefined&&value.length<schema.minLength)||(schema.maxLength!==undefined&&value.length>schema.maxLength))fail(400,'invalid_arguments',path+' : texte invalide.');
    if(schema.format==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))fail(400,'invalid_arguments',path+' : e-mail invalide.');
    // A declared pattern is enforced, never skipped: an uncompilable pattern refuses the value instead of accepting it.
    if(schema.pattern!==undefined){let expression:RegExp|null=null;try{expression=schemaPattern(schema.pattern,path);}catch{expression=null;}if(!expression||!expression.test(value))fail(400,'invalid_arguments',path+' : format invalide.');}
  }
  if(schema.type==='number'||schema.type==='integer')if(typeof value!=='number'||!Number.isFinite(value)||(schema.type==='integer'&&!Number.isInteger(value))||(schema.minimum!==undefined&&value<schema.minimum)||(schema.maximum!==undefined&&value>schema.maximum))fail(400,'invalid_arguments',path+' : nombre invalide.');
  if(schema.type==='boolean'&&typeof value!=='boolean')fail(400,'invalid_arguments',path+' : booléen requis.');
}
function legacyRead(op:Operation){return op.kind==='system'&&['tasks','files','support','members','audit'].includes(op.moduleId)&&['list','get','detail'].includes(op.id.split('.').at(-1)!);}
function toolSchema(op:Operation):JsonSchema {
  // Application operations use their declared inputSchema (path params, query, body); never the legacy CRUD branch.
  if(op.source==='app')return op.inputSchema;
  if(legacyRead(op))return op.id.endsWith('.list')?objectSchema({query:{type:'string',maxLength:120},offset:{type:'integer',minimum:0,maximum:100000}}):objectSchema({recordId:idSchema},['recordId']);
  if(op.id==='search.query')return objectSchema({query:{type:'string',maxLength:120},moduleId:idSchema,offset:{type:'integer',minimum:0,maximum:100000}},['query']);
  if(op.kind==='business'){
    const action=op.id.split('.').at(-1),fields:JsonSchema={};let required:string[]=[];
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
export function dataTools(app:AppDefinition,role:Role,api:ApiCall,writable=true,options:{operations?:Operation[];workspace?:Workspace;bindings?:ToolBinding[];machine?:boolean}={}):DataTool[]{
  const org=options.workspace??{id:'',name:'',role},operations=options.operations??coreOperations(app);
  const bindings=options.bindings??operations.filter(op=>op.mcp).map(op=>({name:op.toolName,operationId:op.id,description:op.description,enabled:true,version:0,custom:false}));
  return bindings.flatMap(binding=>{const op=operations.find(o=>o.id===binding.operationId);return op&&op.mcp&&binding.enabled&&operationAllowed(op,org)&&(!options.machine||op.tokenAllowed)&&(writable||op.method==='GET')?[operationTool(op,api,binding)]:[];});
}
