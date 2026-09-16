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
export function resolveScope(scope?:ScopeProvider):ScopeProvider{
  if(!scope)return openScope;
  if(typeof scope.recordFilter!=='function'||typeof scope.fileFilter!=='function'||(scope.deleteFile!==undefined&&typeof scope.deleteFile!=='function'))throw new Error('ScopeProvider invalide : recordFilter et fileFilter sont obligatoires.');
  return scope;
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
export function recordScope(scope:ScopeProvider,principal:Principal,ref:{alias:string;idColumn:string;moduleColumn:string},action:ScopeAction):SqlFragment{
  assertIdentifier(ref.alias,'alias');assertIdentifier(ref.idColumn,'idColumn');assertIdentifier(ref.moduleColumn,'moduleColumn');
  return checked(scope.recordFilter(principal,{...ref},action),'records');
}
export function fileScope(scope:ScopeProvider,principal:Principal,ref:{alias:string;idColumn:string},action:ScopeAction):SqlFragment{
  assertIdentifier(ref.alias,'alias');assertIdentifier(ref.idColumn,'idColumn');
  return checked(scope.fileFilter(principal,{...ref},action),'files');
}
