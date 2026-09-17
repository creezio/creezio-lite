import { createRequestAccessContext, assertRequestAccessContext, disposeRequestAccessContext, type RequestAccessContext } from '@lite/core/access-profiles-store';
import { sessionCredential } from '@lite/core/scope';
import { createApiKernel } from '../../api-kernel/src/kernel.ts';
import type { ApiContext, AppExtensions, Workspace } from '@lite/core';
import { handleApi } from '@lite/core';
import { workspace as getWorkspace } from '@lite/core/api';
import { ApiError, fail } from '@lite/core/validation';
import { checkOrigin, readJson, json } from '@lite/core/http';
import { navMount, permissions } from './nav';
import { supportMount } from './support';
import { demoMount } from './demo';
import { tasksMount } from './tasks';
import { type NativeContext } from './context';
import { nativeMounts, operationCatalog } from './catalog';
import { matchOperation, assertOperationAllowed } from '@lite/core/operations';

export function workspaceCookie(request:Request):string|null {
  const cookies=(request.headers.get('cookie')??'').split(';').map(s=>s.trim());
  const selected=cookies.find(s=>s.startsWith('lite_workspace='))??cookies.find(s=>/^[a-z]+_workspace=/.test(s));
  const value=selected?.slice(selected.indexOf('=')+1);
  return value&&/^[a-zA-Z0-9_-]{1,100}$/.test(value)?value:null;
}
export async function handleNativeApi(request:Request,context:ApiContext,options:AppExtensions={}):Promise<Response|null> {
  const url=new URL(request.url),path=url.pathname.slice('/api/v1/'.length).replace(/\/$/,'');
  const isNative=/^(auth\/|users$|desktop\/heartbeat$|tasks(?:\/|$)|core(?:\/|$)|modules\/(?![a-z][a-z0-9-]*\/records(?:\/|$))|platform\/platform-support(?:\/|$)|workspaces\/select$)/.test(path);
  if(!isNative)return null;
  let ownAccess:RequestAccessContext|undefined;
  try{
    const user=context.identity;if(!user)fail(401,'authentication_required','Connectez-vous pour continuer.');
    checkOrigin(request);const db=context.env.DB;if(!db)fail(503,'database_unavailable','Base de données indisponible.');
    let org:Workspace;
    try {org=context.workspace??await getWorkspace(db,user,url.searchParams.get('workspace')??workspaceCookie(request));}catch(e){
      if(!(e instanceof ApiError)||e.code!=='setup_required')throw e;
      // Bootstrap uses the already verified identity. No public synthetic login.
      const setup=await handleApi(new Request(new URL('/api/v1/bootstrap',url),{method:'POST',headers:{origin:url.origin}}),context);
      if(!setup.ok)return setup;org=await getWorkspace(db,user,null);
    }
    const requestId=context.requestId??crypto.randomUUID();
    const operations=context.operations??operationCatalog({db,user,workspace:org},context.app,options.operations);
    const access=context.access??(options.access===undefined?undefined:ownAccess=await createRequestAccessContext({db,request,requestId,workspace:org,identity:user,credential:context.credential??sessionCredential,declaration:options.access,catalog:operations}));
    if(access)assertRequestAccessContext(access,request,requestId,org.id,user.userId);
    const operation=matchOperation(operations,request.method,url.pathname);if(access&&operation)assertOperationAllowed(operation,org,access);
    const c:NativeContext={db,user,workspace:org,access};
    if(path==='auth/me'&&request.method==='GET')return json({ok:true,user:user.displayName,user_id:user.userId,role:org.role==='owner'?'owner':'collaborator',brand_role:org.role,permissions:permissions(c,context.app),kind:'human',impersonating:false,actor:null,workspace:org});
    if(path==='auth/logout'&&request.method==='POST')return json({ok:true,redirect:'/signout-with-chatgpt?return_to=%2Flogin'});
    if(path==='desktop/heartbeat'&&request.method==='POST')return json({ok:true,host_bridge_ready:false});
    if(path==='workspaces/select'&&request.method==='POST'){const b=await readJson(request);const next=await getWorkspace(db,user,String(b.workspaceId??''));const r=json({workspace:next});r.headers.set('Set-Cookie',`lite_workspace=${next.id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`);return r;}
    if(path==='users'&&request.method==='GET'){const rows=await db.prepare('SELECT u.id,u.name AS username,m.role FROM lite_members m JOIN lite_users u ON u.id=m.user_id WHERE m.org_id=?').bind(org.id).all();return json({ok:true,users:rows.results.map(r=>({...r,role:r.role==='owner'?'owner':'collaborator',kind:'human',enabled:true})),can_impersonate:false});}
    if(path.startsWith('auth/'))fail(422,'sites_identity','Cette opération utilise la connexion ChatGPT du Site.');
    const kernel=createApiKernel({brandId:context.app.id,appVersion:'0.6.1',authorizeModuleAccess:({permission})=>({allow:permissions(c,context.app).includes(permission),reason:'permission_denied'})});
    for(const entry of nativeMounts(c,context.app)){if(entry.space==='platform')kernel.registerPlatformApi(entry.id,entry.mount);else kernel.registerModuleApi(entry.id,entry.mount);}
    const route=path.startsWith('tasks')?`modules/${path}`:path;
    const body=['POST','PUT','PATCH'].includes(request.method)&&request.body?await readJson(request):undefined;
    const response=await kernel.handle({method:request.method,path:`/api/v1/${route}`,query:Object.fromEntries(url.searchParams),body,headers:Object.fromEntries(request.headers)});
    const result=json(response.body,response.status);
    if(response.status<300 && ["POST","PUT","PATCH","DELETE"].includes(request.method))result.headers.set("x-lite-data-changed",path.startsWith("modules/nav")?"nav":path.startsWith("tasks")?"tasks":"support");
    return result;
  }catch(e){if(e instanceof ApiError)return json({ok:false,error:e.message,code:e.code},e.status);console.error('Native Lite request failed',e instanceof Error?e.name:'Error');return json({ok:false,error:'Erreur du service Lite.',code:'internal_error'},500);}finally{disposeRequestAccessContext(ownAccess);}
}
