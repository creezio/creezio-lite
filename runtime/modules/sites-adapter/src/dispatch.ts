import { createRequestAccessContext, disposeRequestAccessContext } from '@lite/core/access-profiles-store';
import type { ApiContext, AppExtensions, CredentialContext, Workspace } from '@lite/core';
import { handleApi } from '@lite/core';
import { executeAppOperation } from '@lite/core/commands';
import { principalOf, sessionCredential, resolveScope } from '@lite/core/scope';
import { mailRoute, mailInboundRoute } from '@lite/core/mail';
import { integrationsRoute, resolveIntegration, type IntegrationRow } from '@lite/core/integrations';
import { assistantRoute } from '@lite/core/assistant';
import { workspace } from '@lite/core/api';
import { resolveToken, authorizeTokenRequest } from '@lite/core/access-tokens';
import { resolveOAuthToken, mcpAuthHeaders, mcpOptions } from '@lite/core/mcp-oauth';
import { handleMcp } from '@lite/core/mcp';
import { dataTools } from '@lite/core/tools';
import { toolBindings, mcpAdminRoute } from '@lite/core/mcp-admin';
import { accessRoute, openApiDocument } from '@lite/core/access';
import { canReadModule, matchOperation, assertOperationAllowed, operationAllowed } from '@lite/core/operations';
import { ApiError, errorBody, fail, publicDetails } from '@lite/core/validation';
import { checkOrigin, json, readJson, readPublicBytes, normalizedMethod, requestPathname, requestQuery } from '@lite/core/http';
import { observabilityRoute, persistRequestLog, newRequestTrace, jsonrpcLabel, UNKNOWN_TOOL, REQUEST_ID_HEADER } from '@lite/core/observability';
import { admitPublicIngress, publicIngressLimits, type PublicIngressDeclaration, type PublicIngressEntry, type VaultPort } from '@lite/core/public-ingress-engine';
import { handleNativeApi, workspaceCookie } from './index';
import { operationCatalog } from './catalog';

function matchPublicPath(route:string,pathname:string):boolean{
  const pattern=route.replace(/\/$/,'').split('/');
  const actual=pathname.replace(/\/$/,'').split('/');
  if(pattern.length!==actual.length)return false;
  for(let i=0;i<pattern.length;i++){
    if(pattern[i].startsWith(':')){
      let value:string;
      try{value=decodeURIComponent(actual[i]??'');}catch{return false;}
      if(!value||value.length>publicIngressLimits.paramMaxLength)return false;
    }else if(pattern[i]!==actual[i])return false;
  }
  return true;
}
/** Gate only: decide whether to consume the body. The engine re-matches and remains authoritative. */
function selectPublicEntry(entries:readonly PublicIngressEntry[],method:string,pathname:string):PublicIngressEntry|undefined{
  const normalized=pathname.replace(/\/$/,'')||'/';
  const candidates:{entry:PublicIngressEntry;paramsCount:number}[]=[];
  for(const entry of entries){
    if(entry.method!==method)continue;
    if(matchPublicPath(entry.path,normalized))candidates.push({entry,paramsCount:(entry.path.match(/\/:/g)??[]).length});
  }
  candidates.sort((a,b)=>a.paramsCount-b.paramsCount);
  return candidates[0]?.entry;
}
function publicIngressVault(env:ApiContext['env']):VaultPort|undefined{
  if(!env.DB||typeof env.DB.prepare!=='function')return undefined;
  return {
    ready(){return typeof env.LITE_INTEGRATION_SECRET==='string'&&env.LITE_INTEGRATION_SECRET.length>0;},
    async decrypt({tenantId,integrationId,aad}){
      if(aad!==`${tenantId}:${integrationId}`)throw new Error('aad');
      const row=await env.DB.prepare('SELECT * FROM lite_integrations WHERE org_id=? AND id=?').bind(tenantId,integrationId).first<IntegrationRow>();
      if(!row||row.enabled!==1||row.org_id!==tenantId||row.id!==integrationId||`${row.org_id}:${row.id}`!==aad)throw new Error('vault');
      return resolveIntegration({env} as ApiContext,row);
    },
  };
}
function publicHttpResponse(result:{status:number;body:unknown;replayed?:true},requestId:string):Response{
  const body=result.body;
  const row=body&&typeof body==='object'&&!Array.isArray(body)?body as Record<string,unknown>:null;
  const error=row&&row.error&&typeof row.error==='object'&&!Array.isArray(row.error)?row.error as Record<string,unknown>:null;
  const payload=error?{error:{code:error.code,message:error.message,requestId}}:body;
  const response=json(payload,result.status);
  if(result.replayed===true)response.headers.set('Idempotent-Replayed','true');
  return response;
}
async function dispatchPublicIngress(request:Request,context:ApiContext,declaration:PublicIngressDeclaration,requestId:string):Promise<Response|null>{
  if(!context.env.DB)return json({error:{code:'factory_unavailable',message:'factory_unavailable',requestId}},503);
  const method=normalizedMethod(request);
  const path=requestPathname(request);
  const entry=selectPublicEntry(declaration.entries,method,path);
  if(!entry)return null;
  const rawBytes=await readPublicBytes(request,entry.maxBytes);
  const admitted=await admitPublicIngress(declaration,{
    method,path,headers:request.headers,rawBytes,query:requestQuery(request),nowMs:Date.now(),requestId,
  },{db:context.env.DB,env:context.env,vault:publicIngressVault(context.env)});
  if(admitted.kind==='unmatched')return null;
  return publicHttpResponse(admitted,requestId);
}

export async function dispatchRequest(request:Request,context:ApiContext,options:AppExtensions={}):Promise<Response>{
  const started=performance.now();let logContext:ApiContext|undefined,logOrg:Workspace|undefined;
  const source=new URL(request.url).pathname==='/api/mcp'?'mcp':'api';
  // The request log only receives this trace: catalogue identifiers, neutral labels and a server-generated correlation id. Bodies, queries and tool arguments never enter it.
  const trace=newRequestTrace();
  const finish=async(response:Response)=>{
    if(source==='mcp')mcpAuthHeaders(request,response);
    try{response.headers.set(REQUEST_ID_HEADER,trace.correlationId);}catch{}
    if(logContext&&logOrg){const task=persistRequestLog(request,response,logContext,logOrg,source,started,trace).catch(()=>console.error('Request log persistence failed'));
      if(context.defer)context.defer(task);else await task;}
    return response;
  };
  try{
    if(source==='mcp'&&request.method==='OPTIONS')return mcpOptions();
    const inbound=await mailInboundRoute(request,context);if(inbound)return inbound;
    if(options.publicIngress){
      const published=await dispatchPublicIngress(request,context,options.publicIngress,trace.correlationId);
      if(published)return await finish(published);
    }
    const oauth=await resolveOAuthToken(request,context),credential=oauth??await resolveToken(request,context);
    trace.credential=oauth?'oauth':credential?'api_key':'session';
    // The verified, non-secret credential reference and the correlation id travel with the context to every handler.
    const credentialContext:CredentialContext=credential?.credential??sessionCredential;
    const trusted:ApiContext=credential?{...context,identity:credential.identity,credential:credentialContext,requestId:trace.correlationId}:{...context,credential:credentialContext,requestId:trace.correlationId};
    const orgFor=async(req:Request)=>workspace(context.env.DB,trusted.identity!,credential?.access.workspaceId??new URL(req.url).searchParams.get('workspace')??workspaceCookie(req));
    // Each resolved operation is recorded by catalogue id: the first one names the request, nested ones (WebMCP proxy, MCP tools, assistant tools) are listed as sub-calls with their status.
    const invoke=async(incoming:Request,fixedOrg?:Workspace):Promise<Response>=>{
      const step:{operation?:string;status:number}={status:0};
      try{const response=await run(incoming,fixedOrg,step);step.status=response.status;return response;}
      catch(e){step.status=e instanceof ApiError?e.status:503;throw e;}
    };
    const run=async(incoming:Request,fixedOrg:Workspace|undefined,step:{operation?:string;status:number}):Promise<Response>=>{
      let current=incoming;let url=new URL(current.url);
      const path=url.pathname.replace(/^\/api\/v1\//,'').replace(/\/$/,'');
      // Session bootstrap has no current workspace yet. Machine keys never enter it.
      if(!credential&&['health','bootstrap','session','invites/accept','workspaces','auth/me'].includes(path))return await handleNativeApi(current,trusted,options)??await handleApi(current,trusted,options);
      if(!trusted.identity)fail(401,'authentication_required','Authentification requise.');
      if(!credential)checkOrigin(current);
      if(credential&&url.searchParams.has('workspace')&&url.searchParams.get('workspace')!==credential.access.workspaceId)fail(403,'token_workspace','Cette clé appartient à un autre espace.');
      const org=fixedOrg??await orgFor(current);
      const operations=operationCatalog({db:context.env.DB,user:trusted.identity,workspace:org},context.app,options.operations,options.registry);
      const op=matchOperation(operations,current.method,url.pathname);
      logOrg=org;logContext={...trusted,operations};
      if(!op)fail(404,'not_found','Route introuvable.');
      if(trace.operation===undefined)trace.operation=op.id;else{step.operation=op.id;if(trace.calls.length<20)trace.calls.push(step);}
      if(credential)current=authorizeTokenRequest(current,credential.access,op);
      url=new URL(current.url);url.searchParams.set('workspace',org.id);current=new Request(url,current);
      const access=options.access===undefined?undefined:await createRequestAccessContext({db:context.env.DB,request:current,requestId:trace.correlationId,workspace:org,identity:trusted.identity,credential:credentialContext,declaration:options.access,catalog:operations});
      const scoped:ApiContext={...trusted,workspace:org,operations,...(access?{access,refreshAccess:async(refreshRequest:Request,live:Workspace)=>{
        // Browser sockets are session-only. Rebuild from server declaration and current membership.
        if(credentialContext.kind!=='session'||!options.access)fail(403,'operation_forbidden','Access refresh unavailable.');
        return createRequestAccessContext({db:context.env.DB,request:refreshRequest,requestId:crypto.randomUUID(),workspace:live,identity:trusted.identity!,credential:credentialContext,declaration:options.access,catalog:operationCatalog({db:context.env.DB,user:trusted.identity!,workspace:live},context.app,options.operations,options.registry)});
      }}:{})};
      try{
      assertOperationAllowed(op,org,access);
      if(op.source==='app'){
        // Application handlers run after identity, workspace, role, policy, credential and origin checks, before the native kernel.
        const definition=options.operations?.find(d=>d.operation.id===op.id);if(!definition)fail(404,'not_found','Route introuvable.');
        return await executeAppOperation(current,definition,{app:context.app,env:context.env,identity:trusted.identity,workspace:org,principal:principalOf(trusted.identity,org,credentialContext),credential:credentialContext,scope:resolveScope(options.scope,access),access,requestId:trace.correlationId,defer:context.defer});
      }
      if(path==='admin/endpoints')return json({generatedAt:new Date().toISOString(),source:'operation-registry',openapiUrl:'/api/v1/openapi.json',endpoints:operations.filter(o=>operationAllowed(o,org,access)).flatMap(o=>[o.path,...(o.aliases??[])].map(path=>({...o,path,documented:true,summary:o.description,tags:[o.moduleName]})))});
      if(path==='openapi.json')return json(openApiDocument(operations,context.app,org,access));
      const call=async(path:string,init:{method?:string;body?:string}={})=>{
        const target=new URL('/api/v1/'+path,request.url);target.searchParams.set('workspace',org.id);
        const result=await invoke(new Request(target,{method:init.method??'GET',headers:{origin:target.origin,...(init.body?{'content-type':'application/json'}:{})},body:init.body}),org);
        const data=await result.json() as any;if(!result.ok)throw Object.assign(new ApiError(result.status,data.error?.code??data.code??'api_error',typeof data.error==='string'?data.error:data.error?.message??'Opération impossible.',publicDetails(data.error?.details)),{requestId:trace.correlationId});return data;
      };
      if(path==='mcp/tools'||path==='mcp/call'){
        const tools=dataTools(context.app,org.role,call,credential?.access.mode!=='read',{operations,workspace:org,bindings:await toolBindings(scoped,org,operations,options.mcp,access?.snapshot.observedProfileIds),machine:Boolean(credential),access});
        if(path==='mcp/tools')return json({tools:tools.map(({execute,...definition})=>definition)});
        const body=await readJson(current),tool=tools.find(t=>t.name===body.name);
        if(!tool){trace.tool=UNKNOWN_TOOL;fail(403,'tool_forbidden','Outil désactivé ou inaccessible.');}
        trace.tool=tool.name;return json(await tool.execute(body.arguments??{}));
      }
      const assistant=await assistantRoute(current,scoped,org,{moduleContext:async()=>{
        const visible=options.registry?.modules.filter(mod=>Object.keys(mod.entitySpecs).some(id=>operations.some(op=>op.moduleId===id&&op.method==='GET'&&(context.app.modules.find(m=>m.id===id)?.readRoles??['owner','admin','member','viewer']).includes(org.role)&&canReadModule(org,id,scoped.access))))??[];
        return visible.flatMap(mod=>(mod.assistantSources??[]).filter(source=>source.kind==='context').map(source=>source.kind==='context'?`### ${source.title}\n${source.body}`:'')).join('\n\n');
      },...(options.assistant?{policy:async()=>{
        const profiles=scoped.access?.snapshot.observedProfileIds??[],definitions=profiles.flatMap(id=>{const item=options.assistant?.profiles[id];return item?[item]:[];});
        return {instructions:definitions.map(item=>item.instructions).join(' '),toolNames:[...new Set(definitions.flatMap(item=>[...item.toolNames]))]};
      }}:{}),tools:async()=>{
        // Re-read membership, group policies and MCP switches before each tool call.
        const liveOrg=await orgFor(current),liveOps=operationCatalog({db:context.env.DB,user:trusted.identity!,workspace:liveOrg},context.app,options.operations,options.registry);
        const liveAccess=options.access===undefined?undefined:await createRequestAccessContext({db:context.env.DB,request:current,requestId:trace.correlationId,workspace:liveOrg,identity:trusted.identity!,credential:credentialContext,declaration:options.access,catalog:liveOps});
        try{
        const assistantOp=liveOps.find(o=>o.id==='assistant.chat')!;assertOperationAllowed(assistantOp,liveOrg,liveAccess);
        const liveCall=async(path:string,init:{method?:string;body?:string}={})=>{
          const target=new URL('/api/v1/'+path,request.url);target.searchParams.set('workspace',org.id);
          const response=await invoke(new Request(target,{method:init.method??'GET',headers:{origin:target.origin,...(init.body?{'content-type':'application/json'}:{})},body:init.body}));
          const data=await response.json() as any;if(!response.ok)throw Object.assign(new ApiError(response.status,data.error?.code??'tool_error',data.error?.message??'Opération refusée.',publicDetails(data.error?.details)),{requestId:trace.correlationId});return data;
        };
        return dataTools(context.app,liveOrg.role,liveCall,true,{operations:liveOps,workspace:liveOrg,access:liveAccess,bindings:await toolBindings({...scoped,workspace:liveOrg,access:liveAccess},liveOrg,liveOps,options.mcp,liveAccess?.snapshot.observedProfileIds)});
        }finally{disposeRequestAccessContext(liveAccess);}
      }});
      if(assistant)return assistant;
      return await mailRoute(current,scoped,org)??await integrationsRoute(current,scoped,org)??await accessRoute(current,scoped,org,operations,options)??await mcpAdminRoute(current,scoped,org,operations,options.mcp)??await observabilityRoute(current,scoped,org)??await handleNativeApi(current,scoped,options)??await handleApi(current,scoped,options);
      }finally{disposeRequestAccessContext(access);}
    };
    if(source==='mcp'){
      if(!trusted.identity)fail(401,'authentication_required','Authentification requise.');
      if(!credential)checkOrigin(request);
      const requestedWorkspace=new URL(request.url).searchParams.get('workspace');
      if(credential&&requestedWorkspace&&requestedWorkspace!==credential.access.workspaceId)fail(403,'token_workspace','Cette connexion appartient à un autre espace.');
      const org=await orgFor(request);
      const operations=operationCatalog({db:context.env.DB,user:trusted.identity,workspace:org},context.app,options.operations,options.registry),scoped={...trusted,workspace:org,operations};
      const access=options.access===undefined?undefined:await createRequestAccessContext({db:context.env.DB,request,requestId:trace.correlationId,workspace:org,identity:trusted.identity,credential:credentialContext,declaration:options.access,catalog:operations});
      try{
      logOrg=org;logContext={...trusted,operations};
      let requestedTool:string|undefined;
      if(request.method==='POST'){const b=await readJson(request.clone()).catch(()=>({})) as any;trace.jsonrpcMethod=jsonrpcLabel(b.method);requestedTool=typeof b.params?.name==='string'?b.params.name:undefined;}
      const api=async(path:string,init:{method?:string;body?:string}={})=>{
        const target=new URL('/api/v1/'+path,request.url);target.searchParams.set('workspace',org.id);
        const response=await invoke(new Request(target,{method:init.method??'GET',headers:{origin:target.origin,...(init.body?{'content-type':'application/json'}:{})},body:init.body}),org);
        const data=await response.json() as any;if(!response.ok)throw Object.assign(new ApiError(response.status,data.error?.code??data.code??'api_error',typeof data.error==='string'?data.error:data.error?.message??'Opération impossible.',publicDetails(data.error?.details)),{requestId:trace.correlationId});return data;
      };
      // A tool name is only logged once it matches an authorised binding; anything else is a neutral label.
      const resolveTools=async()=>{const tools=dataTools(context.app,org.role,api,credential?.access.mode!=='read',{operations,workspace:org,bindings:await toolBindings(scoped,org,operations,options.mcp,access?.snapshot.observedProfileIds),machine:Boolean(credential),access});
        if(requestedTool!==undefined)trace.tool=tools.some(t=>t.name===requestedTool)?requestedTool:UNKNOWN_TOOL;return tools;};
      return await finish(await handleMcp(request,context.app,org.role,api,credential?.access.mode!=='read',resolveTools));
      }finally{disposeRequestAccessContext(access);}
    }
      return await finish(await invoke(request));
  }catch(e){const response=e instanceof ApiError?json(errorBody(e,trace.correlationId),e.status):json({error:{code:'service_unavailable',message:'Service indisponible.',requestId:trace.correlationId}},503);if(!(e instanceof ApiError))console.error('API dispatch failed',e instanceof Error?e.name:'Error');return await finish(response);}
}
