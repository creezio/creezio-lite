import { composeModuleExtensions } from './module-contract.ts';
import { validateAccessDeclaration } from './access-profiles-engine.ts';
import { assertRequestAccessContext, type RequestAccessContext } from './access-profiles-store.ts';
import type { AppDefinition, AppExtensions, AppOperationContext, AppOperationDefinition, AppOperationResult, CredentialContext, Identity, LiteEnvironment, Principal, Role, ScopeProvider, Workspace } from './types.ts';
import { appOperations, assertUniqueOperations, coreOperations, idSchema, objectSchema, operation, type JsonSchema, type Operation } from './operations.ts';
import { ApiError, errorBody, fail, idPattern, roles as everyRole } from './validation.ts';
import { validateSchema } from './tools.ts';
import { json, readJson } from './http.ts';
import { resolveScope, sessionCredential } from './scope.ts';
import { PublicIngressDeclarationError, validatePublicIngressDeclaration } from './public-ingress-engine.ts';

const writers:Role[]=['owner','admin','member'];
const namePattern=/^[a-z][a-z0-9-]{0,47}$/;
type Requirement='required'|'optional'|'none';
export const reservedCommandFields=['expectedVersion','idempotencyKey','reason'] as const;
/** Never declarable as business fields: the envelope names and every server-context name a client could try to forge. */
export const rejectedCommandFields=['command','payload','principal','credential','identity','workspace','workspaceId','role','requestId','scope','operation','access','profileId','observedProfileIds','catalogRevision','evaluateAccess','authorizeDelegation'] as const;
/** Replay keys are opaque ASCII tokens: letters, digits, dot, underscore, colon and dash, 1 to 160 characters, no whitespace. */
export const idempotencyKeyPattern='^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$';
const reservedSchemas:Record<(typeof reservedCommandFields)[number],JsonSchema>={
  expectedVersion:{type:'integer',minimum:1,description:'Version attendue de la cible modifiée'},
  idempotencyKey:{type:'string',minLength:1,maxLength:160,pattern:idempotencyKeyPattern,description:'Clé de rejeu ASCII sans espace ; l’en-tête Idempotency-Key est un alias'},
  reason:{type:'string',maxLength:500,description:'Motif borné à 500 caractères'},
};

export type CommandInput={
  moduleId:string; name:string; description:string; moduleName?:string;
  /** 'record' targets /records/:id/commands/<name>; 'module' targets /commands/<name>. */
  target?:'module'|'record';
  roles?:Role[];
  /** Business fields, flattened next to the reserved names. */
  fields?:Record<string,JsonSchema>; required?:string[];
  expectedVersion?:Requirement; idempotencyKey?:Requirement; reason?:Requirement;
  tokenAllowed?:boolean; mcp?:boolean; mcpReason?:string; toolName?:string;
  handle:(ctx:AppOperationContext)=>Promise<AppOperationResult>;
};
/** A command is always a POST mutation, whatever its name; the dispatcher never derives the method from the last segment. */
export function command(input:CommandInput):AppOperationDefinition{
  if(!idPattern.test(input.moduleId))throw new Error('moduleId de commande invalide.');
  if(!namePattern.test(input.name))throw new Error(`Nom de commande invalide : ${String(input.name)}.`);
  const target=input.target??'record';
  const fields=input.fields??{};
  for(const key of Object.keys(fields)){
    if((reservedCommandFields as readonly string[]).includes(key))throw new Error(`Le champ ${key} est réservé au corps de commande.`);
    if((rejectedCommandFields as readonly string[]).includes(key)||!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key))throw new Error(`Champ de commande refusé : ${key}.`);
  }
  const policy:Record<(typeof reservedCommandFields)[number],Requirement>={
    expectedVersion:input.expectedVersion??(target==='record'?'required':'none'),
    idempotencyKey:input.idempotencyKey??(target==='module'?'required':'optional'),
    reason:input.reason??'optional',
  };
  const properties:Record<string,JsonSchema>={};const required:string[]=[];
  for(const key of reservedCommandFields){if(policy[key]==='none')continue;properties[key]=reservedSchemas[key];if(policy[key]==='required')required.push(key);}
  for(const key of input.required??[])if(!(key in fields))throw new Error(`Champ requis non déclaré : ${key}.`);
  Object.assign(properties,fields);required.push(...(input.required??[]));
  const op=operation({
    id:`command.${input.moduleId}.${input.name}`,kind:'business',moduleId:input.moduleId,moduleName:input.moduleName??input.moduleId,
    method:'POST',path:`/api/v1/modules/${input.moduleId}${target==='record'?'/records/:id':''}/commands/${input.name}`,
    description:input.description,roles:input.roles??writers,bodySchema:objectSchema(properties,required),
    ...(input.tokenAllowed!==undefined?{tokenAllowed:input.tokenAllowed}:{}),...(input.mcp!==undefined?{mcp:input.mcp}:{}),...(input.mcpReason?{mcpReason:input.mcpReason}:{}),...(input.toolName?{toolName:input.toolName}:{}),
  });
  return {operation:op,handle:input.handle};
}

export type ReadInput={
  moduleId:string; name:string; description:string; moduleName?:string;
  /** 'record' targets /records/:id/<name> (history…); 'module' targets /modules/<id>/<name>. */
  target?:'module'|'record';
  roles?:Role[]; querySchema?:JsonSchema;
  tokenAllowed?:boolean; mcp?:boolean; mcpReason?:string; toolName?:string;
  handle:(ctx:AppOperationContext)=>Promise<AppOperationResult>;
};
/** A declared GET read (history, relations…) built with the catalogue helper. */
export function read(input:ReadInput):AppOperationDefinition{
  if(!idPattern.test(input.moduleId))throw new Error('moduleId de lecture invalide.');
  if(!namePattern.test(input.name)||['records','commands'].includes(input.name))throw new Error(`Nom de lecture invalide : ${String(input.name)}.`);
  const target=input.target??'record';
  const op=operation({
    id:`read.${input.moduleId}.${input.name}`,kind:'business',moduleId:input.moduleId,moduleName:input.moduleName??input.moduleId,
    method:'GET',path:`/api/v1/modules/${input.moduleId}${target==='record'?'/records/:id':''}/${input.name}`,
    description:input.description,roles:input.roles??everyRole,...(input.querySchema?{querySchema:input.querySchema}:{}),
    ...(input.tokenAllowed!==undefined?{tokenAllowed:input.tokenAllowed}:{}),...(input.mcp!==undefined?{mcp:input.mcp}:{}),...(input.mcpReason?{mcpReason:input.mcpReason}:{}),...(input.toolName?{toolName:input.toolName}:{}),
  });
  return {operation:op,handle:input.handle};
}

/**
 * Validate the extensions once at declaration. Every schema is checked and every collision of ID,
 * route shape or tool name with the given catalogue is refused here, with the same stable
 * diagnostics as the request-time catalogue. Without a catalogue the core operations of the
 * application are used; the Sites adapter passes its complete native catalogue.
 * publicIngress exige ce catalogue complet : `operations: []` ou son omission ne prouvent
 * pas l’absence de collision avec les routes privées.
 */
export function defineExtensions(app:AppDefinition,extensions:AppExtensions={},catalog?:Operation[]):AppExtensions{
  extensions=composeModuleExtensions(extensions);
  if(extensions.beforeWrite!==undefined&&typeof extensions.beforeWrite!=='function')throw new Error('beforeWrite doit être une fonction.');
  resolveScope(extensions.scope);
  const declared=appOperations(app,extensions.operations);
  const privateOperations=assertUniqueOperations([...(catalog??coreOperations(app)),...declared]);
  if(extensions.publicIngress!==undefined){
    if(!Array.isArray(catalog)||catalog.length<1){
      throw new PublicIngressDeclarationError('operations_catalog_required','Le catalogue complet des opérations privées doit être fourni explicitement ; son absence ou operations:[] ne prouve pas l’unicité des routes publiques.');
    }
    validatePublicIngressDeclaration(extensions.publicIngress,{operations:privateOperations});
  }
  if(extensions.access!==undefined)validateAccessDeclaration(extensions.access,privateOperations);
  return extensions;
}

const pathParams=(route:string,pathname:string):Record<string,string>|null=>{
  const pattern=route.split('/'),actual=pathname.replace(/\/$/,'').split('/');
  if(pattern.length!==actual.length)return null;
  const params:Record<string,string>={};
  for(let i=0;i<pattern.length;i++){
    if(pattern[i].startsWith(':')){try{params[pattern[i].slice(1)]=decodeURIComponent(actual[i]);}catch{return null;}}
    else if(pattern[i]!==actual[i])return null;
  }
  return params;
};
function coerceQuery(schema:JsonSchema|undefined,raw:Record<string,string>):Record<string,unknown>{
  const result:Record<string,unknown>=Object.create(null);
  for(const [key,value] of Object.entries(raw)){
    const child=schema?.properties?.[key];const type=child?.type??(child?.enum?.every((v:unknown)=>typeof v==='number')?'number':undefined);
    if((type==='integer'||type==='number')&&/^-?\d+(?:\.\d+)?$/.test(value))result[key]=Number(value);
    else if(type==='boolean'&&(value==='true'||value==='false'))result[key]=value==='true';
    else result[key]=value;
  }
  return result;
}
const dataChanged=/^[a-z][a-z0-9-]{0,47}$/;

export type AppOperationInput={
  access?:RequestAccessContext;
  app:AppDefinition; env:LiteEnvironment; identity:Identity; workspace:Workspace; principal:Principal;
  /** Verified credential reference built by the dispatcher; defaults to the browser session. */
  credential?:CredentialContext;
  scope?:ScopeProvider;
  /** The dispatcher correlation id. The executor never mints a second one when it is given. */
  requestId?:string; defer?:(promise:Promise<unknown>)=>void;
};
/**
 * Single executor for application operations reached through HTTP, MCP or the assistant.
 * The caller has already verified identity, workspace, role, policies, credential and origin.
 */
export async function executeAppOperation(request:Request,definition:AppOperationDefinition,input:AppOperationInput):Promise<Response>{
  const requestId=input.requestId??crypto.randomUUID(),op:Operation=definition.operation;
  const credential:CredentialContext=Object.isFrozen(input.credential??sessionCredential)?(input.credential??sessionCredential):Object.freeze({...(input.credential as CredentialContext)});
  const deferred:Promise<unknown>[]=[];
  const defer=(promise:Promise<unknown>)=>{if(input.defer)input.defer(promise);else deferred.push(promise.catch(()=>{}));};
  try{
    const url=new URL(request.url);
    if(request.method!==op.method)fail(405,'method_not_allowed','Méthode non autorisée.');
    let params:Record<string,string>|null=null;
    for(const route of [op.path,...(op.aliases??[])]){params=pathParams(route,url.pathname);if(params)break;}
    if(!params)fail(404,'not_found','Route introuvable.');
    for(const [key,value] of Object.entries(params)){
      const schema=op.inputSchema?.properties?.[key]??idSchema;
      if(/[\/\\]/.test(value)||value==='.'||value==='..')fail(400,'invalid_arguments',`${key} : identifiant invalide.`);
      validateSchema(schema,value,key);
    }
    const rawQuery=Object.fromEntries([...url.searchParams].filter(([key])=>key!=='workspace'));
    const querySchema=op.querySchema??objectSchema({});
    const query=coerceQuery(querySchema,rawQuery);
    validateSchema(querySchema,query,'query');
    let body:Record<string,unknown>={};
    if(op.method==='GET'){
      const length=request.headers.get('content-length');
      if((length&&length!=='0')||request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))fail(400,'invalid_arguments','Une lecture n’accepte pas de corps métier.');
    }else{
      body=request.body||request.headers.get('content-type')?await readJson(request):{};
      const bodySchema=op.bodySchema??objectSchema({});
      const header=request.headers.get('idempotency-key');
      if(header!==null&&bodySchema.properties?.idempotencyKey){
        if(body.idempotencyKey!==undefined&&body.idempotencyKey!==header)fail(400,'invalid_arguments','Idempotency-Key et idempotencyKey diffèrent.');
        body={...body,idempotencyKey:header};
      }
      validateSchema(bodySchema,body,'body');
    }
    if(input.access)assertRequestAccessContext(input.access,request,requestId,input.workspace.id,input.identity.userId);
    const ctx:AppOperationContext=Object.freeze({
      ...(input.access?{access:input.access}:{}),
      db:input.env.DB,env:input.env,app:input.app,identity:Object.freeze({...input.identity}),workspace:input.workspace,principal:Object.freeze({...input.principal}),credential,
      operation:op,requestId,now:new Date().toISOString(),params:Object.freeze({...params}),query:Object.freeze(query),body:Object.freeze(body),
      scope:resolveScope(input.scope),defer,
    });
    const result=await definition.handle(ctx);
    if(!result||typeof result!=='object'||!('body' in result))fail(503,'service_unavailable','Réponse d’opération invalide.');
    const status=result.status??200;
    if(![200,201,202].includes(status))fail(503,'service_unavailable','Statut d’opération invalide.');
    const response=json(result.body,status);
    // Only these two derived headers exist; no free property of the result reaches the response headers.
    const changed=(result.changed??[]).filter(id=>typeof id==='string'&&dataChanged.test(id));
    if(changed.length)response.headers.set('x-lite-data-changed',[...new Set(changed)].join(','));
    if(result.replayed===true)response.headers.set('Idempotent-Replayed','true');
    return response;
  }catch(error){
    // Only ApiError reaches the client, with its validated public details; any other throwable (including
    // look-alikes carrying status/code/details) is a generic 503 without message, cause or properties.
    if(error instanceof ApiError)return json(errorBody(error,requestId),error.status);
    console.error(JSON.stringify({event:'lite.app-operation-error',requestId,operation:op.id,type:error instanceof Error?error.name:'UnknownError'}));
    return json({error:{code:'service_unavailable',message:'Le service est momentanément indisponible. Vos modifications n’ont pas été confirmées.',requestId}},503);
  }finally{
    if(deferred.length)await Promise.all(deferred);
  }
}
