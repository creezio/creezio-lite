import { canReadModule } from './operations.ts';
import type { AppDefinition } from './types.ts';
import { scopeAccessMatches, type RequestAccessContext } from './access-profiles-store.ts';
import { fail } from './validation.ts';
import type { CredentialContext, CredentialMode, Identity, Principal, ScopeAction, ScopeProvider, SqlFragment, Workspace } from './types.ts';

const identifier=/^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const open:SqlFragment={sql:'1=1',bindings:[]};

/** Verified references only: an identifier is a bounded, printable, non-secret string. */
const reference=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
function assertReference(value:unknown,label:string):string{
  if(typeof value!=='string'||!reference.test(value))throw new Error(`Référence de credential invalide (${label}).`);
  return value;
}
function assertMode(value:unknown):CredentialMode{if(value!=='read'&&value!=='write')throw new Error('Mode de credential invalide.');return value;}
/** The browser session of the Sites dispatcher carries no machine reference. */
export const sessionCredential:CredentialContext=Object.freeze({kind:'session'} as const);
/** A personal API key: its row id, workspace and mode as verified by resolveToken. */
export function tokenCredential(input:{tokenId:string;workspaceId:string;mode:CredentialMode}):CredentialContext{
  return Object.freeze({kind:'token',tokenId:assertReference(input.tokenId,'tokenId'),workspaceId:assertReference(input.workspaceId,'workspaceId'),mode:assertMode(input.mode)} as const);
}
/** An OAuth connection: the access token row (t.id), its grant (g.id) and client (cl.id) are distinct references. */
export function oauthCredential(input:{tokenId:string;grantId:string;clientId:string;workspaceId:string;mode:CredentialMode}):CredentialContext{
  return Object.freeze({kind:'oauth',tokenId:assertReference(input.tokenId,'tokenId'),grantId:assertReference(input.grantId,'grantId'),clientId:assertReference(input.clientId,'clientId'),workspaceId:assertReference(input.workspaceId,'workspaceId'),mode:assertMode(input.mode)} as const);
}

/** Default provider: every readable row of the workspace stays visible, native routes are unchanged. */
export const openScope:ScopeProvider={
  recordFilter:()=>({...open,bindings:[]}),
  fileFilter:()=>({...open,bindings:[]}),
};
const boundScopes=new WeakMap<ScopeProvider,RequestAccessContext|null>();
const closed=():SqlFragment=>({sql:'0=1',bindings:[]});
export function resolveScope(scope?:ScopeProvider,access?:RequestAccessContext|null):ScopeProvider{
  scope??=openScope;
  if(typeof scope.recordFilter!=='function'||typeof scope.fileFilter!=='function'||(scope.deleteFile!==undefined&&typeof scope.deleteFile!=='function'))throw new Error('ScopeProvider invalide : recordFilter et fileFilter sont obligatoires.');
  if(access===undefined)return scope;
  const original=scope;
  const bound:ScopeProvider={
    recordFilter:(p,r,a,c)=>c===access&&scopeAccessMatches(access,p)?original.recordFilter(p,r,a,c):closed(),
    fileFilter:(p,r,a,c)=>c===access&&scopeAccessMatches(access,p)?original.fileFilter(p,r,a,c):closed(),
    ...(original.deleteFile?{deleteFile:async(ctx)=>{if(ctx.access!==access||!scopeAccessMatches(access,ctx.principal))fail(403,'operation_forbidden','Invalid access scope.');return original.deleteFile!(ctx);}}:{}),
  };
  boundScopes.set(bound,access);return bound;
}
/** The principal is derived from the verified identity, the live membership and the credential context only. */
export function principalOf(identity:Identity,workspace:Workspace,credential:CredentialContext=sessionCredential):Principal{
  return {userId:identity.userId,role:workspace.role,workspaceId:workspace.id,credential:credential.kind};
}
function assertIdentifier(value:string,label:string){if(typeof value!=='string'||!identifier.test(value))throw new Error(`Identifiant SQL de portée invalide (${label}).`);}
function checked(fragment:SqlFragment,label:string):SqlFragment{
  if(!fragment||typeof fragment.sql!=='string'||!fragment.sql.trim()||!Array.isArray(fragment.bindings))throw new Error(`Fragment de portée invalide (${label}).`);
  if(fragment.sql.includes(';'))throw new Error(`Fragment de portée invalide (${label}) : une seule expression attendue.`);
  return {sql:`(${fragment.sql})`,bindings:[...fragment.bindings]};
}
/** Aliases and columns come from trusted code and are validated as identifiers; values are always bound. */
export function recordScope(scope:ScopeProvider,principal:Principal,ref:{alias:string;idColumn:string;moduleColumn:string},action:ScopeAction,access?:RequestAccessContext):SqlFragment{
  assertIdentifier(ref.alias,'alias');assertIdentifier(ref.idColumn,'idColumn');assertIdentifier(ref.moduleColumn,'moduleColumn');
  if(boundScopes.has(scope)&&boundScopes.get(scope)!==access||access!==undefined&&!scopeAccessMatches(access,principal))return checked(closed(),'records');
  return checked(access===undefined?scope.recordFilter(principal,{...ref},action):scope.recordFilter(principal,{...ref},action,access),'records');
}
export function fileScope(scope:ScopeProvider,principal:Principal,ref:{alias:string;idColumn:string},action:ScopeAction,access?:RequestAccessContext):SqlFragment{
  assertIdentifier(ref.alias,'alias');assertIdentifier(ref.idColumn,'idColumn');
  if(boundScopes.has(scope)&&boundScopes.get(scope)!==access||access!==undefined&&!scopeAccessMatches(access,principal))return checked(closed(),'files');
  return checked(access===undefined?scope.fileFilter(principal,{...ref},action):scope.fileFilter(principal,{...ref},action,access),'files');
}

/** Unknown/orphan business resources stay hidden; only explicit native recovery events need no business row. */
export function auditScope(scope:ScopeProvider,principal:Principal,app:AppDefinition,org:Workspace,access?:RequestAccessContext):SqlFragment{
  if(!access)return {sql:'1=1',bindings:[]};
  const records=recordScope(scope,principal,{alias:'r',idColumn:'id',moduleColumn:'module_id'},'read',access);
  const files=fileScope(scope,principal,{alias:'f',idColumn:'id'},'read',access);
  const readable=app.modules.filter(m=>canReadModule(org,m.id,access)).map(m=>m.id);
  const recordTest=readable.length?'r.module_id IN ('+readable.map(()=>'?').join(',')+')':'0=1';
  const recovery=['workspace.create','workspace.rename','member.join','member.role','member.remove','invite.create','invite.revoke','access.adopt','access.rebind','access.bind','access.unbind','access.group.create','access.group.update','access.group.delete','access.policy.update','mcp.policy.update','mcp.tool.create','mcp.tool.delete','mcp.client.revoke','mcp.oauth.revoke'];
  return {sql:'((a.action IN ('+recovery.map(()=>'?').join(',')+') AND NOT EXISTS(SELECT 1 FROM lite_records r WHERE r.org_id=a.org_id AND r.id=a.resource_id) AND NOT EXISTS(SELECT 1 FROM lite_files f WHERE f.org_id=a.org_id AND f.id=a.resource_id)) OR EXISTS(SELECT 1 FROM lite_records r WHERE r.org_id=a.org_id AND r.id=a.resource_id AND '+recordTest+' AND '+records.sql+') OR EXISTS(SELECT 1 FROM lite_files f WHERE f.org_id=a.org_id AND f.id=a.resource_id AND '+(canReadModule(org,'files',access)?'1=1':'0=1')+' AND '+files.sql+'))',bindings:[...recovery,...readable,...records.bindings,...files.bindings]};
}
