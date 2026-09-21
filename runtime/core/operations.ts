import { editableFields } from './entity-write.ts';
import { requestAccessMatches, accessModuleReadable, type RequestAccessContext } from './access-profiles-store.ts';
import type { AppDefinition, AppOperationDefinition, Field, Module, Role, Workspace } from './types.ts';
import { roles, fail, idPattern, moduleWritable } from './validation.ts';

export type JsonSchema = Record<string, any>;
export type Operation = {
  id:string; moduleId:string; moduleName:string; kind:'system'|'business';
  method:string; path:string; aliases?:string[]; description:string; roles:Role[];
  essential?:boolean; tokenAllowed:boolean; mcp:boolean; mcpReason?:string;
  toolName:string; inputSchema:JsonSchema; bodySchema?:JsonSchema; querySchema?:JsonSchema;
  responseType?:'json'|'file'; requestType?:'json'|'file';
  /** Explicit transport marker: 'app' operations run their declared handler through the generic executor. */
  source?:'core'|'native'|'app';
};
export type OperationPolicy = {operationId:string;effect:'allow'|'deny'};
export const objectSchema=(properties:JsonSchema={},required:string[]=[])=>({type:'object',properties,required,additionalProperties:false});
export const stringSchema={type:'string',maxLength:300};
export const idSchema={type:'string',minLength:1,maxLength:160};
export const paging={limit:{type:'integer',minimum:1,maximum:100},offset:{type:'integer',minimum:0,maximum:100000},q:{type:'string',maxLength:120}};
const admin:Role[]=['owner','admin'],writers:Role[]=['owner','admin','member'];
export function fieldSchema(f:Field):JsonSchema{if(f.encoding==='json')return {description:f.label,anyOf:[{type:'string',maxLength:f.maxLength??5000},{type:'array',items:{}},{type:'object',additionalProperties:true}]};if(f.type==='date'&&!f.required)return {description:f.label,anyOf:[fieldSchema({...f,required:true}),{type:'string',enum:['']},{type:'null'}]};return {type:f.type==='number'?(f.integer?'integer':'number'):f.type==='boolean'?'boolean':'string',description:f.label,...(f.type==='select'?{enum:f.options}:{}),...(f.type==='email'?{format:'email'}:{}),...(f.type==='date'?{format:'date'}:{}),...(f.maxLength?{maxLength:f.maxLength}:{}),...(f.min!==undefined?{minimum:f.min}:{}),...(f.max!==undefined?{maximum:f.max}:{})};}
/** Derive a closed command data schema from the same fields as validateData.
 * Optional blank values remain compatible with native forms; domain validation
 * still handles normalization and business rules. Partial is for update/restore inputs.
 */
export function moduleDataSchema(module:Module,{partial=false}:{partial?:boolean}={}):JsonSchema {
 const properties=Object.fromEntries(editableFields(module).map(field=>[field.key,field.required?fieldSchema(field):{
  description:field.label,anyOf:[fieldSchema({...field,required:true}),{type:'null'},{type:'string',enum:['']}]
 }]));
 return objectSchema(properties,partial?[]:editableFields(module).filter(f=>f.required).map(f=>f.key));
}
export function operation(value:Omit<Operation,'kind'|'inputSchema'|'toolName'|'tokenAllowed'|'mcp'> & Partial<Pick<Operation,'kind'|'inputSchema'|'toolName'|'tokenAllowed'|'mcp'>>):Operation {
  const params=Object.fromEntries([...value.path.matchAll(/:([A-Za-z0-9_]+)/g)].map(m=>[m[1],idSchema]));
  const properties={...params,...(value.querySchema?{query:value.querySchema}:{}),...(value.bodySchema?{body:value.bodySchema}:{})};
  return {kind:'system',tokenAllowed:true,mcp:true,...value,toolName:value.toolName??`lite_${value.id.replace(/[^a-zA-Z0-9_]/g,'_')}`,inputSchema:value.inputSchema??objectSchema(properties,[...Object.keys(params),...(value.bodySchema?['body']:[])])};
}

/** Native mounts append their own declared operations. No separate MCP route list. */
export function coreOperations(app:AppDefinition):Operation[]{
  const list:Operation[]=[];
  const add=(id:string,method:string,path:string,moduleId:string,moduleName:string,description:string,extra:Partial<Operation>={})=>list.push(operation({id,method,path:`/api/v1/${path}`,moduleId,moduleName,description,roles:method==='GET'?roles:writers,...extra}));
  const essential={essential:true,tokenAllowed:false,mcp:false,mcpReason:'Fonction indispensable de la session navigateur.'};
  const protectedAdmin={roles:admin,tokenAllowed:false,mcp:false,mcpReason:'Administration des accès réservée à une session administrateur.'};
  add('core.health','GET','health','core','Système','État du service',{...essential});
  add('session.bootstrap','POST','bootstrap','session','Session','Initialiser son espace',{...essential,roles});
  add('session.get','GET','session','session','Session','Lire sa session et ses espaces',essential);
  add('session.me','GET','auth/me','session','Session','Identité et permissions effectives',essential);
  add('session.logout','POST','auth/logout','session','Session','Se déconnecter',{...essential,roles});
  add('session.heartbeat','POST','desktop/heartbeat','session','Session','Maintenir la session du shell',{...essential,roles});
  add('workspaces.select','POST','workspaces/select','session','Session','Changer d’espace',{...essential,roles,bodySchema:objectSchema({workspaceId:idSchema},['workspaceId'])});
  add('workspaces.create','POST','workspaces','workspaces','Espaces','Créer un espace',{tokenAllowed:false,mcp:false,bodySchema:objectSchema({name:stringSchema},['name'])});
  add('workspaces.update','PATCH','workspaces/current','workspaces','Espaces','Renommer cet espace',{roles:admin,bodySchema:objectSchema({name:stringSchema},['name'])});
  add('modules.list','GET','modules','core','Système','Modules métier accessibles',{essential:true,toolName:'lite_modules_list'});
  add('registry.list','GET','registry','core','Système','Registre commun des modules',{essential:true,toolName:'lite_modules'});
  add('dashboard.get','GET','dashboard','core','Système','Synthèse des données accessibles');
  add('search.query','GET','search','search','Recherche','Rechercher dans les données autorisées',{toolName:'lite_search',querySchema:objectSchema({...paging,module:stringSchema})});
  add('search.settings','GET','admin/search','search','Recherche','Réglages de recherche',{roles:admin});
  add('search.configure','PUT','admin/search/:moduleId','search','Recherche','Configurer les champs recherchables',{roles:admin,bodySchema:objectSchema({enabled:{type:'boolean'},fields:{type:'array',items:stringSchema,maxItems:30},version:{type:'integer',minimum:0}},['enabled','fields','version'])});
  add('search.reindex','POST','admin/search/reindex','search','Recherche','Reprendre l’indexation des données existantes',{roles:admin,bodySchema:objectSchema({reset:{type:'boolean'}})});
  add('members.directory','GET','users','members','Collaborateurs','Personnes assignables',{essential:true});
  for(const [mod,name] of [['members','Collaborateurs'],['audit','Modifications']] as const){
    add(`${mod}.list`,'GET',mod,mod,name,`Lister : ${name}`,{roles:admin,querySchema:objectSchema(paging)});
    add(`${mod}.get`,'GET',`${mod}/:id`,mod,name,`Consulter : ${name}`,{roles:admin});
  }
  add('members.update','PATCH','members/:id','members','Collaborateurs','Changer le rôle d’un membre',{...protectedAdmin,roles:['owner'],bodySchema:objectSchema({role:{enum:['admin','member','viewer']}},['role'])});
  add('members.remove','DELETE','members/:id','members','Collaborateurs','Retirer un membre',{...protectedAdmin,roles:['owner']});
  add('invites.list','GET','invites','members','Collaborateurs','Lister les invitations',protectedAdmin);
  add('invites.create','POST','invites','members','Collaborateurs','Créer une invitation',{...protectedAdmin,bodySchema:objectSchema({email:{type:'string',format:'email'},role:{enum:['admin','member','viewer']}},['email','role'])});
  add('invites.accept','POST','invites/accept','session','Session','Accepter une invitation',{...essential,roles,bodySchema:objectSchema({token:stringSchema},['token'])});
  add('invites.revoke','DELETE','invites/:id','members','Collaborateurs','Révoquer une invitation',protectedAdmin);
  add('files.list','GET','files','files','Documents','Lister les fichiers',{querySchema:objectSchema(paging)});
  add('files.get','GET','files/:id/metadata','files','Documents','Métadonnées du fichier');
  add('files.download','GET','files/:id','files','Documents','Télécharger le fichier',{responseType:'file',mcp:false,mcpReason:'Téléchargement binaire par HTTP ; métadonnées disponibles par MCP.'});
  add('files.upload','POST','files','files','Documents','Ajouter un fichier (10 Mo maximum)',{requestType:'file',mcp:false,mcpReason:'Corps binaire : téléverser le fichier par HTTP.'});
  add('files.delete','DELETE','files/:id','files','Documents','Supprimer le fichier');
  add('tokens.list','GET','access-tokens','connections','Connexions','Lister ses clés personnelles',{...protectedAdmin,roles:admin});
  add('tokens.create','POST','access-tokens','connections','Connexions','Créer sa clé personnelle',{...protectedAdmin,roles:admin,bodySchema:objectSchema({name:stringSchema,mode:{enum:['read','write']},days:{enum:[7,30,90]}},['name','mode','days'])});
  add('tokens.revoke','DELETE','access-tokens/:id','connections','Connexions','Révoquer sa clé personnelle',{...protectedAdmin,roles:admin});
  add('api.catalog','GET','admin/endpoints','api','API','Catalogue complet des opérations',{roles:admin});
  add('api.openapi','GET','openapi.json','api','API','Documentation OpenAPI des opérations autorisées',{essential:true});
  add('access.catalog','GET','access/catalog','access','Groupes et accès','Matrice des groupes et opérations',protectedAdmin);
  const bindingSchema=objectSchema({groupId:idSchema,profileId:idSchema,profileRevision:{type:'integer'}},['groupId','profileId','profileRevision']);
  const receiptSchema=objectSchema({catalogRevision:stringSchema,bindings:{type:'array',maxItems:1000,items:bindingSchema},validUntil:{type:'string',format:'date-time'}},['catalogRevision','bindings']);
  add('access.receipt.update','PUT','access/receipt','access','Groupes et acces','Adopter ou remplacer le recu natif',{...protectedAdmin,bodySchema:objectSchema({receipt:receiptSchema,version:{type:'integer',minimum:0}},['receipt','version'])});
  add('access.bind','POST','access/bind','access','Groupes et acces','Lier un groupe a un profil',{...protectedAdmin,bodySchema:objectSchema({groupId:idSchema,profileId:idSchema,profileRevision:{type:'integer'},version:{type:'integer',minimum:0}},['groupId','profileId','profileRevision','version'])});
  add('access.unbind','POST','access/unbind','access','Groupes et acces','Retirer une liaison de profil',{...protectedAdmin,bodySchema:objectSchema({groupId:idSchema,profileId:idSchema,version:{type:'integer',minimum:0}},['groupId','profileId','version'])});
  add('access.groups.create','POST','access/groups','access','Groupes et accès','Créer un groupe',{...protectedAdmin,bodySchema:objectSchema({name:stringSchema},['name'])});
  add('access.groups.update','PUT','access/groups/:id','access','Groupes et accès','Modifier un groupe et ses membres',{...protectedAdmin,bodySchema:objectSchema({name:stringSchema,userIds:{type:'array',items:idSchema,maxItems:500},version:{type:'integer',minimum:1}},['name','userIds','version'])});
  add('access.groups.delete','DELETE','access/groups/:id','access','Groupes et accès','Supprimer un groupe',protectedAdmin);
  add('access.policies.update','PUT','access/policies/:id','access','Groupes et accès','Régler les API d’un groupe',{...protectedAdmin,bodySchema:objectSchema({changes:{type:'array',maxItems:500,items:objectSchema({operationId:stringSchema,effect:{enum:['allow','deny','inherit']}},['operationId','effect'])},version:{type:'integer',minimum:0}},['changes','version'])});
  for(const part of ['status','tools','clients','diagnostics','metrics'])add(`mcp.${part}`,'GET',`admin/mcp/${part}`,'mcp','MCP',`Administration MCP : ${part}`,protectedAdmin);
  add('mcp.clients.revoke','DELETE','admin/mcp/clients/:id','mcp','MCP','Révoquer une connexion',{roles:['owner','admin'],tokenAllowed:false,mcp:false});
  add('mcp.diagnostics.export','GET','admin/mcp/diagnostics/export','mcp','MCP','Exporter le diagnostic expurgé',protectedAdmin);
  add('mcp.policies.update','PATCH','admin/mcp/policies/:name','mcp','MCP','Activer ou désactiver un outil',{...protectedAdmin,bodySchema:objectSchema({enabled:{type:'boolean'},version:{type:'integer',minimum:0}},['enabled','version'])});
  add('mcp.tools.create','POST','admin/mcp/tools','mcp','MCP','Créer un outil nommé à partir d’une opération API',{...protectedAdmin,bodySchema:objectSchema({name:stringSchema,operationId:stringSchema,description:{type:'string',maxLength:1000}},['name','operationId','description'])});
  add('mcp.tools.delete','DELETE','admin/mcp/tools/:name','mcp','MCP','Supprimer un outil personnalisé',protectedAdmin);
  add('mcp.tools.available','GET','mcp/tools','mcp','MCP','Outils autorisés pour la session',{essential:true,mcp:false});
  add('mcp.tools.call','POST','mcp/call','mcp','MCP','Exécuter un outil WebMCP autorisé',{essential:true,tokenAllowed:false,mcp:false,roles,bodySchema:objectSchema({name:stringSchema,arguments:{type:'object'}},['name'])});
  add('logs.list','GET','admin/request-logs','observability','Activité','Journal détaillé API et MCP',{roles:admin,querySchema:objectSchema({...paging,limit:{type:'integer',minimum:1,maximum:1000},source:{enum:['all','api','mcp']},errorsOnly:{enum:['0','1']}})});
  add('logs.clear','DELETE','admin/request-logs','observability','Activité','Vider le journal technique',{roles:admin});
  add('analytics.ingest','POST','analytics/events','observability','Activité','Enregistrer l’usage de la session',{...essential,roles,bodySchema:objectSchema({events:{type:'array',maxItems:100,items:{type:'object'}}},['events'])});
  for(const part of ['overview','timeline','pages','clicks','users','events','productivity'])add(`analytics.${part}`,'GET',`admin/analytics/${part}`,'observability','Activité',`Activité : ${part}`,{roles:admin,querySchema:objectSchema({...paging,period:{enum:['day','week','month','year']},from:stringSchema,to:stringSchema,kind:{enum:['all','human','ai']},userId:idSchema})});
  add('analytics.purge','DELETE','admin/analytics/events','observability','Activité','Purger les événements d’usage',{roles:admin});
  const integrationAdmin={roles:admin,tokenAllowed:false,mcp:false,mcpReason:'La configuration de secrets est réservée à la session administrateur.'};
  for(const [id,method,suffix,description] of [
    ['list','GET','','Lister les intégrations sans les clés'],['catalog','GET','/catalog','Catalogue des services'],
    ['get','GET','/:id','Lire les réglages sans la clé'],['create','POST','','Ajouter une intégration chiffrée'],
    ['update','PATCH','/:id','Modifier une intégration'],['delete','DELETE','/:id','Supprimer une intégration'],['test','POST','/:id/test','Tester la connexion au fournisseur'],
  ] as const)add(`integrations.${id}`,method,`platform/integrations${suffix}`,'integrations','Intégrations',description,{...integrationAdmin,...(['create','update'].includes(id)?{bodySchema:objectSchema({provider:stringSchema,label:stringSchema,slug:stringSchema,secret:{type:'string',maxLength:8192,writeOnly:true},gatewayToken:{type:'string',maxLength:8192,writeOnly:true},meta:objectSchema({baseUrl:stringSchema,headerName:stringSchema,host:stringSchema,port:{type:'integer',minimum:1,maximum:65535},user:stringSchema,security:{enum:['tls','starttls']},from:stringSchema,fromName:stringSchema,accountId:stringSchema,gatewayUrl:stringSchema,folder:stringSchema}),enabled:{type:'boolean'},version:{type:'integer',minimum:1}},id==='create'?['provider','secret']:['version'])}:{}),...(id==='delete'?{querySchema:objectSchema({version:{type:'integer',minimum:1}},['version'])}:{})});
  const mailBody=objectSchema({to:{type:'array',items:{type:'string',format:'email'},maxItems:50},cc:{type:'array',items:{type:'string',format:'email'}},bcc:{type:'array',items:{type:'string',format:'email'}},subject:{type:'string',maxLength:500},text:{type:'string',maxLength:500000},html:{type:'string',maxLength:500000},inReplyTo:stringSchema,references:{type:'array',items:stringSchema},integrationId:idSchema,idempotencyKey:idSchema,version:{type:'integer',minimum:1},attachments:{type:'array',maxItems:20,items:objectSchema({filename:stringSchema,content_type:stringSchema,content_base64:{type:'string',maxLength:4300000}})}});
  for(const [id,method,suffix,description] of [
    ['list','GET','','Lister les messages de l’espace'],['meta','GET','/meta','Connexions et capacités mail actives'],['get','GET','/:id','Lire un message et ses pièces jointes'],['thread','GET','/threads/:id','Lire un fil de messages'],['events','GET','/:id/events','État confirmé de l’envoi'],
    ['draft.create','POST','/drafts','Enregistrer un brouillon'],['draft.update','PUT','/drafts/:id','Modifier un brouillon'],['send','POST','/send','Envoyer un message avec la connexion configurée'],['draft.send','POST','/drafts/:id/send','Envoyer un brouillon'],['retry','POST','/:id/retry','Réessayer un envoi explicitement refusé'],['update','PATCH','/:id','Marquer lu ou déplacer le message'],['delete','DELETE','/:id','Supprimer un message de la corbeille'],['attachment','GET','/:id/attachments/:attachmentId','Télécharger une pièce jointe'],['sync','POST','/sync','Synchroniser les boîtes IMAP'],['receiving','POST','/receiving','Créer ou renouveler l’accès de réception Cloudflare'],
  ] as const)add(`mail.${id}`,method,`email${suffix}`,'mail','Mail',description,{
    ...(id==='list'?{querySchema:objectSchema({...paging,folder:{enum:['inbox','sent','drafts','outbox','archive','trash']},unread:{enum:['0','1']}})}:{}),
    ...(['draft.create','draft.update','send'].includes(id)?{bodySchema:mailBody}:{}),
    ...(id==='update'?{bodySchema:objectSchema({read:{type:'boolean'},folder:{enum:['inbox','archive','trash']},version:{type:'integer',minimum:1}},['version'])}:{}),
    ...(id==='delete'?{querySchema:objectSchema({version:{type:'integer',minimum:1}},['version'])}:{}),
    ...(id==='attachment'?{mcp:false,responseType:'file' as const,mcpReason:'Pièce jointe binaire disponible par HTTP.'}:{}),
    ...(id==='receiving'?{...integrationAdmin,bodySchema:objectSchema({integrationId:idSchema},['integrationId'])}:{}),
  });
  const personalAssistant={roles,tokenAllowed:false,mcp:false,mcpReason:'Conversation privée de la session ; exclue des outils pour éviter les appels récursifs.'};
  for(const [id,method,path,description] of [
    ['status','GET','llm-status','État des intégrations du chat'],['models','GET','models','Modèles OpenAI configurés'],['hermes.models','GET','hermes-models','Modèles Hermes configurés'],
    ['conversations.list','GET','conversations','Lister ses conversations'],['conversations.create','POST','conversations','Créer une conversation'],
    ['conversations.get','GET','conversations/:id','Lire sa conversation'],['conversations.update','PATCH','conversations/:id','Modifier sa conversation'],['conversations.delete','DELETE','conversations/:id','Supprimer sa conversation'],
    ['browser.connect','POST','browser/connect','Activer une fenêtre de travail ou le chat mobile'],['browser.poll','POST','browser/poll','Présence et commandes de la fenêtre active'],['browser.release','POST','browser/release','Libérer sa fenêtre'],['browser.events','POST','browser/events','Journaliser le pilotage navigateur'],['browser.diagnostics','GET','browser/diagnostics','Consulter ses diagnostics de connexion'],['browser.socket','GET','browser/socket','Connexion temps réel privée du navigateur'],
    ['ui.check','POST','ui-actions/:id/check','Vérifier le droit d’exécuter une action réservée'],['ui.claim','POST','ui-actions/:id/claim','Réserver une action du curseur dans sa session'],['ui.result','POST','ui-actions/:id/result','Confirmer une action du curseur dans sa session'],
    ['trace','GET','conversations/:id/trace','Actions et diagnostics de sa conversation'],['chat','POST','chat','Dialoguer avec OpenAI ou Hermes'],['transcribe','POST','transcribe','Transcrire un message vocal'],
  ] as const)add(`assistant.${id}`,method,`assistant/${path}`,'assistant','Assistant',description,{...personalAssistant,...(id==='transcribe'?{requestType:'file' as const}:method==='POST'||method==='PATCH'?{bodySchema:{type:'object',additionalProperties:true}}:{})});
  for(const module of app.modules){
    const data=objectSchema(Object.fromEntries(editableFields(module).map(f=>[f.key,fieldSchema(f)])),editableFields(module).filter(f=>f.required).map(f=>f.key));
    // Entities and collections expose reads only; every mutation is a declared command.
    const actions=([['list','GET',''],['get','GET','/:id'],['create','POST',''],['update','PATCH','/:id'],['archive','DELETE','/:id']] as const).filter(([,method])=>method==='GET'||moduleWritable(module));
    for(const [action,method,suffix] of actions){
      add(`module.${module.id}.${action}`,method,`modules/${module.id}/records${suffix}`,module.id,module.name,`${module.name} : ${action}`,{kind:'business',roles:method==='GET'?(module.readRoles??roles):(module.writeRoles??writers),toolName:`lite_${module.id.replaceAll('-','_')}_${action}`,
        ...(action==='list'?{querySchema:objectSchema({...paging,field:stringSchema,value:stringSchema,sort:{enum:module.fields.filter(f=>f.storage!=='computed').map(f=>f.key)},direction:{enum:['asc','desc']}})}:{}),
        ...(action==='create'?{bodySchema:objectSchema({data},['data'])}:{}),
        ...(action==='update'?{bodySchema:objectSchema({data:{...data,required:[]},version:{type:'integer',minimum:1}},['data','version'])}:{}),
        ...(action==='archive'?{bodySchema:objectSchema({version:{type:'integer',minimum:1}},['version'])}:{})});
    }
  }
  return list;
}
const operationIdPattern=/^[a-z][a-z0-9_.-]{0,119}$/,methods=['GET','POST','PUT','PATCH','DELETE'];
/** Stable diagnostics for catalogue construction failures: the code and the operations involved never vary between requests. */
export type OperationCatalogErrorCode='duplicate_operation'|'duplicate_route'|'duplicate_tool'|'invalid_schema';
export class OperationCatalogError extends Error{
  readonly code:OperationCatalogErrorCode;
  readonly operations:string[];
  constructor(code:OperationCatalogErrorCode,message:string,operations:string[]=[]){super(message);this.name='OperationCatalogError';this.code=code;this.operations=operations;}
}
const schemaTypes=['object','array','string','number','integer','boolean','null'];
const patternCache=new Map<string,RegExp>();
/** Compile a declared JSON Schema pattern once; an invalid expression is a declaration error, never a skipped check. */
export function schemaPattern(pattern:unknown,label='schema'):RegExp{
  if(typeof pattern!=='string'||!pattern||pattern.length>512)throw new OperationCatalogError('invalid_schema',`Schéma invalide (${label}) : pattern doit être une expression régulière de 1 à 512 caractères.`);
  let compiled=patternCache.get(pattern);
  if(!compiled){try{compiled=new RegExp(pattern,'u');}catch{throw new OperationCatalogError('invalid_schema',`Schéma invalide (${label}) : pattern non compilable.`);}patternCache.set(pattern,compiled);}
  return compiled;
}
/**
 * Closed JSON Schema subset of the kit. Every keyword listed here is enforced by validateSchema (tools.ts) on
 * each HTTP, MCP, WebMCP and assistant entry; every other keyword is refused at declaration so that no
 * declared constraint is ever silently ignored.
 *
 * - annotations (never validated): description, title, readOnly, writeOnly, deprecated
 * - any type: type (one of object, array, string, number, integer, boolean, null), enum (scalars),
 *   anyOf (non-empty list of sub-schemas; no validating sibling keyword allowed next to it)
 * - string: minLength, maxLength, pattern (ECMAScript, flag u), format ∈ email, date, date-time, uri
 * - number / integer: minimum, maximum
 * - array: items, minItems, maxItems
 * - object: properties (own, safe names), required (each name declared when additionalProperties is false),
 *   additionalProperties (boolean, or a sub-schema applied to every undeclared property)
 *
 * The property names __proto__, constructor and prototype are refused in declarations and in values.
 */
export const SCHEMA_KEYWORDS={
  annotations:['description','title','readOnly','writeOnly','deprecated'],
  any:['type','enum','anyOf'],
  string:['minLength','maxLength','pattern','format'],
  number:['minimum','maximum'],
  array:['items','minItems','maxItems'],
  object:['properties','required','additionalProperties'],
} as const;
export const SCHEMA_FORMATS=['email','date','date-time','uri'] as const;
/** Names that reach Object.prototype through a lookup or a spread; never a declared or accepted property. */
export const UNSAFE_PROPERTY_NAMES=['__proto__','constructor','prototype'] as const;
const propertyName=/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
const familyOf=(type:unknown)=>type==='string'?'string':type==='number'||type==='integer'?'number':type==='array'?'array':type==='object'?'object':undefined;
/** Refuse at declaration every schema outside the closed subset above: the validator then enforces everything that was declared. */
export function assertJsonSchema(schema:unknown,label:string,depth=0):void{
  const bad=(reason:string)=>{throw new OperationCatalogError('invalid_schema',`Schéma invalide (${label}) : ${reason}.`);};
  if(!schema||typeof schema!=='object'||Array.isArray(schema))bad('objet de schéma attendu');
  if(depth>16)bad('profondeur excessive');
  const s=schema as JsonSchema,keys=Object.keys(s);
  const known:readonly string[]=[...SCHEMA_KEYWORDS.annotations,...SCHEMA_KEYWORDS.any,...SCHEMA_KEYWORDS.string,...SCHEMA_KEYWORDS.number,...SCHEMA_KEYWORDS.array,...SCHEMA_KEYWORDS.object];
  for(const key of keys)if(!known.includes(key))bad(`mot-clé non pris en charge : ${key}`);
  if(s.type!==undefined&&(typeof s.type!=='string'||!schemaTypes.includes(s.type)))bad(`type non pris en charge : ${String(s.type)}`);
  const family=familyOf(s.type);
  for(const [name,list] of Object.entries({string:SCHEMA_KEYWORDS.string,number:SCHEMA_KEYWORDS.number,array:SCHEMA_KEYWORDS.array,object:SCHEMA_KEYWORDS.object}))
    for(const key of list)if(s[key]!==undefined&&family!==name)bad(`${key} exige type ${name==='number'?'number ou integer':name}`);
  if(s.anyOf!==undefined){
    if(!Array.isArray(s.anyOf)||!s.anyOf.length)bad('anyOf doit être une liste non vide');
    const siblings=keys.filter(key=>key!=='anyOf'&&!(SCHEMA_KEYWORDS.annotations as readonly string[]).includes(key));
    if(siblings.length)bad(`anyOf ne se combine pas avec ${siblings.join(', ')} ; placer ces contraintes dans chaque branche`);
    s.anyOf.forEach((option:unknown,i:number)=>assertJsonSchema(option,`${label}.anyOf[${i}]`,depth+1));
  }
  if(s.enum!==undefined&&(!Array.isArray(s.enum)||!s.enum.length||!s.enum.every((v:unknown)=>v===null||['string','number','boolean'].includes(typeof v))))bad('enum doit lister des valeurs scalaires');
  if(s.pattern!==undefined)schemaPattern(s.pattern,label);
  for(const key of ['minLength','maxLength','minItems','maxItems'])if(s[key]!==undefined&&(!Number.isInteger(s[key])||s[key]<0))bad(`${key} doit être un entier positif`);
  for(const key of ['minimum','maximum'])if(s[key]!==undefined&&(typeof s[key]!=='number'||!Number.isFinite(s[key])))bad(`${key} doit être un nombre`);
  if(s.minLength!==undefined&&s.maxLength!==undefined&&s.minLength>s.maxLength)bad('minLength dépasse maxLength');
  if(s.minItems!==undefined&&s.maxItems!==undefined&&s.minItems>s.maxItems)bad('minItems dépasse maxItems');
  if(s.minimum!==undefined&&s.maximum!==undefined&&s.minimum>s.maximum)bad('minimum dépasse maximum');
  if(s.format!==undefined&&!(SCHEMA_FORMATS as readonly string[]).includes(s.format))bad(`format non pris en charge : ${String(s.format)}`);
  for(const key of ['description','title'])if(s[key]!==undefined&&(typeof s[key]!=='string'||s[key].length>2000))bad(`${key} doit être un texte de 2000 caractères au plus`);
  for(const key of ['readOnly','writeOnly','deprecated'])if(s[key]!==undefined&&typeof s[key]!=='boolean')bad(`${key} doit être un booléen`);
  if(s.properties!==undefined){
    if(!s.properties||typeof s.properties!=='object'||Array.isArray(s.properties))bad('properties doit être un objet');
    if(Object.getPrototypeOf(s.properties)!==Object.prototype&&Object.getPrototypeOf(s.properties)!==null)bad('properties doit être un objet simple');
    for(const [key,child] of Object.entries(s.properties)){if(!propertyName.test(key)||(UNSAFE_PROPERTY_NAMES as readonly string[]).includes(key))bad(`nom de propriété refusé : ${key}`);assertJsonSchema(child,`${label}.${key}`,depth+1);}
  }
  if(s.required!==undefined){
    if(!Array.isArray(s.required)||!s.required.every((k:unknown)=>typeof k==='string'))bad('required doit lister des noms');
    for(const key of s.required)if((UNSAFE_PROPERTY_NAMES as readonly string[]).includes(key))bad(`nom de propriété refusé : ${key}`);
    if(s.additionalProperties===false)for(const key of s.required)if(!s.properties||!Object.hasOwn(s.properties,key))bad(`champ requis non déclaré : ${key}`);
  }
  if(s.additionalProperties!==undefined&&typeof s.additionalProperties!=='boolean'){
    if(typeof s.additionalProperties!=='object'||!s.additionalProperties||Array.isArray(s.additionalProperties))bad('additionalProperties doit être un booléen ou un schéma');
    assertJsonSchema(s.additionalProperties,`${label}.*`,depth+1);
  }
  if(s.items!==undefined)assertJsonSchema(s.items,`${label}[]`,depth+1);
}
/** Two routes are equivalent when they differ only by the name of a parameter: /records/:id and /records/:recordId share one key. */
export function routeKey(method:string,path:string):string{return `${method} ${path.replace(/\/$/,'').replace(/:[A-Za-z0-9_]+/g,':*')}`;}
/**
 * Validate application operations and mark them for the generic executor.
 * Business operations belong to a declared module and never exceed its read roles;
 * system descriptors (jobs…) use an explicit moduleId that is not a business module.
 */
export function appOperations(app:AppDefinition,definitions:AppOperationDefinition[]=[]):Operation[]{
  const result:Operation[]=[],ids=new Set<string>();
  for(const definition of definitions){
    if(!definition||typeof definition!=='object'||typeof definition.handle!=='function'||!definition.operation||typeof definition.operation!=='object')throw new Error('Une opération applicative déclare une Operation et un handler.');
    const op=definition.operation;
    if(!operationIdPattern.test(op.id)||ids.has(op.id))throw new Error(`Identifiant d’opération applicative invalide ou dupliqué : ${String(op.id)}.`);
    if(!methods.includes(op.method))throw new Error(`Méthode HTTP non prise en charge pour ${op.id}.`);
    for(const path of [op.path,...(op.aliases??[])])if(typeof path!=='string'||!path.startsWith('/api/v1/')||/\/\/|\s/.test(path))throw new Error(`Chemin invalide pour ${op.id} : chaque route commence par /api/v1/.`);
    if(typeof op.description!=='string'||!op.description.trim()||typeof op.moduleName!=='string'||!op.moduleName.trim())throw new Error(`Description et nom de module requis pour ${op.id}.`);
    if(!idPattern.test(op.moduleId))throw new Error(`moduleId invalide pour ${op.id}.`);
    const module=app.modules.find(m=>m.id===op.moduleId);
    if(op.kind==='business'&&!module)throw new Error(`L’opération ${op.id} référence un module absent de l’application : ${op.moduleId}.`);
    if(op.kind!=='business'&&module)throw new Error(`Le descripteur système ${op.id} ne peut pas réutiliser le module métier ${op.moduleId}.`);
    if(!Array.isArray(op.roles)||!op.roles.length||!op.roles.every(r=>roles.includes(r))||new Set(op.roles).size!==op.roles.length)throw new Error(`Rôles invalides pour ${op.id}.`);
    if(op.method==='GET'&&op.bodySchema)throw new Error(`L’opération GET ${op.id} n’accepte pas de corps métier.`);
    if(op.essential)throw new Error(`Une opération applicative ne peut pas être déclarée indispensable : ${op.id}.`);
    if(typeof op.toolName!=='string'||!/^[a-z][a-z0-9_]{1,80}$/.test(op.toolName))throw new Error(`Nom d’outil invalide pour ${op.id}.`);
    if(!op.inputSchema||typeof op.inputSchema!=='object')throw new Error(`inputSchema requis pour ${op.id}.`);
    assertJsonSchema(op.inputSchema,`${op.id}.inputSchema`);
    if(op.bodySchema!==undefined)assertJsonSchema(op.bodySchema,`${op.id}.bodySchema`);
    if(op.querySchema!==undefined)assertJsonSchema(op.querySchema,`${op.id}.querySchema`);
    const readers=module?(module.readRoles??roles):roles;
    const allowed=op.roles.filter(r=>readers.includes(r));
    if(!allowed.length)throw new Error(`Aucun rôle de ${op.id} ne peut lire le module ${op.moduleId}.`);
    ids.add(op.id);
    result.push({...op,roles:allowed,source:'app'});
  }
  return result;
}
/**
 * Refuse duplicate IDs, method/path/alias routes and tool names across the whole catalogue.
 * Routes are compared by shape: parameter names never distinguish two routes, so an application
 * operation can never be silently masked by a native one that differs only by :id/:recordId.
 */
export function assertUniqueOperations(operations:Operation[]):Operation[]{
  const ids=new Map<string,string>(),routes=new Map<string,string>(),tools=new Map<string,string>();
  const collide=(code:OperationCatalogErrorCode,label:string,key:string,previous:string,current:string)=>{throw new OperationCatalogError(code,`${label}: ${key} (${previous}, ${current})`,[previous,current]);};
  for(const op of operations){
    const previous=ids.get(op.id);if(previous!==undefined)collide('duplicate_operation','Duplicate operation',op.id,previous,op.id);ids.set(op.id,op.id);
    for(const path of [op.path,...(op.aliases??[])]){const key=routeKey(op.method,path);const owner=routes.get(key);if(owner!==undefined)collide('duplicate_route','Duplicate route',key,owner,op.id);routes.set(key,op.id);}
    const tool=tools.get(op.toolName);if(tool!==undefined)collide('duplicate_tool','Duplicate tool',op.toolName,tool,op.id);tools.set(op.toolName,op.id);
  }
  return operations;
}
const filteredDiscovery=new Set(['modules.list','registry.list','api.openapi','nav.list']);
export function operationAllowed(op:Operation,org:Workspace,access?:RequestAccessContext|null):boolean {
  if(access!==undefined){
    if(!requestAccessMatches(access,org.id,org.role)||!op.roles.includes(org.role))return false;
    const decision=access!.evaluateAccess({kind:'operation',operationId:op.id});
    // These four envelopes contain individually filtered items; no business grant is inferred.
    return decision.allowed||(filteredDiscovery.has(op.id)&&['denied_unbound','denied_incomplete'].includes(decision.reason));
  }
  if(!op.roles.includes(org.role))return false;
  if(op.essential||org.role==='owner')return true;
  return !(org.operationPolicies??[]).some(p=>(p.operationId===op.id||p.operationId===`module:${op.moduleId}`)&&p.effect==='deny');
}
export function canReadModule(org:Workspace,id:string,access?:RequestAccessContext|null):boolean {
  if(access!==undefined)return requestAccessMatches(access,org.id,org.role)&&accessModuleReadable(access!,id);
  if(org.role==='owner')return true;
  const identifiers=[`module:${id}`,`module.${id}.list`,`module.${id}.get`,`${id}.list`,`${id}.get`,`${id}.detail`,...(id==='files'?['files.download']:[])];
  return !(org.operationPolicies??[]).some(p=>identifiers.includes(p.operationId)&&p.effect==='deny');
}
const routeMatches=(route:string,pathname:string)=>{
  const pattern=route.replace(/\/$/,'').split('/'),actual=pathname.split('/');
  return pattern.length===actual.length&&pattern.every((segment,i)=>segment.startsWith(':')?actual[i].length>0:segment===actual[i]);
};
/**
 * Resolve a request to one operation. Literal segments beat parameters; on an exact tie of shape
 * (impossible after assertUniqueOperations) an application operation is preferred, so a native
 * route keeps its priority only when no extension claims it.
 */
export function matchOperation(operations:Operation[],method:string,path:string):Operation|undefined {
  const normalized=path.replace(/\/$/,'');
  const candidates:{op:Operation;shape:string;params:number}[]=[];
  for(const op of operations){
    if(op.method!==method)continue;
    for(const route of [op.path,...(op.aliases??[])])if(routeMatches(route,normalized))candidates.push({op,shape:routeKey(method,route),params:(route.match(/\/:/g)?.length??0)});
  }
  // Literal beats parameter at the first differing segment; two matching literals are always equal.
  const specificity=(a:string,b:string)=>{const x=a.split('/'),y=b.split('/');for(let i=0;i<x.length;i++){if(x[i]===y[i])continue;return x[i]===':*'?1:-1;}return 0;};
  candidates.sort((a,b)=>a.params-b.params||specificity(a.shape,b.shape)||(a.op.source==='app'?0:1)-(b.op.source==='app'?0:1));
  return candidates[0]?.op;
}
export function assertOperationAllowed(op:Operation,org:Workspace,access?:RequestAccessContext|null){if(!operationAllowed(op,org,access))fail(403,'operation_forbidden','Votre groupe n’a pas accès à cette opération.');}
