import type { CredentialKind, Identity, Principal, ScopeAction, ScopeProvider, SqlFragment, Workspace } from './types.ts';

const identifier=/^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const open:SqlFragment={sql:'1=1',bindings:[]};

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
/** The principal is derived from the verified identity and the live membership only. */
export function principalOf(identity:Identity,workspace:Workspace,credential:CredentialKind='session'):Principal{
  return {userId:identity.userId,role:workspace.role,workspaceId:workspace.id,credential};
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
