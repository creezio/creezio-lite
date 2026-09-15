import type { AppDefinition, Field, Role, Workspace } from './types.ts';
import { roles, fail } from './validation.ts';

export type JsonSchema = Record<string, any>;
export type Operation = {
  id:string; moduleId:string; moduleName:string; kind:'system'|'business';
  method:string; path:string; aliases?:string[]; description:string; roles:Role[];
  essential?:boolean; tokenAllowed:boolean; mcp:boolean; mcpReason?:string;
  toolName:string; inputSchema:JsonSchema; bodySchema?:JsonSchema; querySchema?:JsonSchema;
  responseType?:'json'|'file'; requestType?:'json'|'file';
};
export type OperationPolicy = {operationId:string;effect:'allow'|'deny'};
export const objectSchema=(properties:JsonSchema={},required:string[]=[])=>({type:'object',properties,required,additionalProperties:false});
export const stringSchema={type:'string',maxLength:300};
export const idSchema={type:'string',minLength:1,maxLength:160};
export const paging={limit:{type:'integer',minimum:1,maximum:100},offset:{type:'integer',minimum:0,maximum:100000},q:{type:'string',maxLength:120}};
const admin:Role[]=['owner','admin'],writers:Role[]=['owner','admin','member'];
export function fieldSchema(f:Field):JsonSchema{return {type:f.type==='number'?'number':f.type==='boolean'?'boolean':'string',description:f.label,...(f.type==='select'?{enum:f.options}:{}),...(f.type==='email'?{format:'email'}:{}),...(f.type==='date'?{format:'date'}:{}),...(f.maxLength?{maxLength:f.maxLength}:{}),...(f.min!==undefined?{minimum:f.min}:{}),...(f.max!==undefined?{maximum:f.max}:{})};}
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
    ['trace','GET','conversations/:id/trace','Actions et diagnostics de sa conversation'],['chat','POST','chat','Dialoguer avec OpenAI ou Hermes'],['transcribe','POST','transcribe','Transcrire un message vocal'],
  ] as const)add(`assistant.${id}`,method,`assistant/${path}`,'assistant','Assistant',description,{...personalAssistant,...(id==='transcribe'?{requestType:'file' as const}:method==='POST'||method==='PATCH'?{bodySchema:{type:'object',additionalProperties:true}}:{})});
  for(const module of app.modules){
    const data=objectSchema(Object.fromEntries(module.fields.map(f=>[f.key,fieldSchema(f)])),module.fields.filter(f=>f.required).map(f=>f.key));
    for(const [action,method,suffix] of [['list','GET',''],['get','GET','/:id'],['create','POST',''],['update','PATCH','/:id'],['archive','DELETE','/:id']] as const){
      add(`module.${module.id}.${action}`,method,`modules/${module.id}/records${suffix}`,module.id,module.name,`${module.name} : ${action}`,{kind:'business',roles:method==='GET'?(module.readRoles??roles):(module.writeRoles??writers),toolName:`lite_${module.id.replaceAll('-','_')}_${action}`,
        ...(action==='list'?{querySchema:objectSchema({...paging,field:stringSchema,value:stringSchema})}:{}),
        ...(action==='create'?{bodySchema:objectSchema({data},['data'])}:{}),
        ...(action==='update'?{bodySchema:objectSchema({data,version:{type:'integer',minimum:1}},['data','version'])}:{}),
        ...(action==='archive'?{bodySchema:objectSchema({version:{type:'integer',minimum:1}},['version'])}:{})});
    }
  }
  return list;
}
export function operationAllowed(op:Operation,org:Workspace):boolean {
  if(!op.roles.includes(org.role))return false;
  if(op.essential||org.role==='owner')return true;
  return !(org.operationPolicies??[]).some(p=>(p.operationId===op.id||p.operationId===`module:${op.moduleId}`)&&p.effect==='deny');
}
export function canReadModule(org:Workspace,id:string):boolean {
  if(org.role==='owner')return true;
  const identifiers=[`module:${id}`,`module.${id}.list`,`module.${id}.get`,`${id}.list`,`${id}.get`,`${id}.detail`,...(id==='files'?['files.download']:[])];
  return !(org.operationPolicies??[]).some(p=>identifiers.includes(p.operationId)&&p.effect==='deny');
}
export function matchOperation(operations:Operation[],method:string,path:string):Operation|undefined {
  const normalized=path.replace(/\/$/,'');
  return [...operations].sort((a,b)=>(a.path.match(/:/g)?.length??0)-(b.path.match(/:/g)?.length??0)).find(op=>op.method===method&&[op.path,...(op.aliases??[])].some(route=>new RegExp('^'+route.split('/').map(p=>p.startsWith(':')?'[^/]+':p.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('/')+'$').test(normalized)));
}
export function assertOperationAllowed(op:Operation,org:Workspace){if(!operationAllowed(op,org))fail(403,'operation_forbidden','Votre groupe n’a pas accès à cette opération.');}
