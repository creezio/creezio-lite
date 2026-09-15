import type { ApiContext, BeforeWrite, Workspace } from '@lite/core';
import { handleApi } from '@lite/core';
import { mailRoute, mailInboundRoute } from '@lite/core/mail';
import { integrationsRoute } from '@lite/core/integrations';
import { assistantRoute } from '@lite/core/assistant';
import { workspace } from '@lite/core/api';
import { resolveToken, authorizeTokenRequest } from '@lite/core/access-tokens';
import { handleMcp } from '@lite/core/mcp';
import { dataTools } from '@lite/core/tools';
import { toolBindings, mcpAdminRoute } from '@lite/core/mcp-admin';
import { accessRoute, openApiDocument } from '@lite/core/access';
import { matchOperation, assertOperationAllowed } from '@lite/core/operations';
import { ApiError, fail } from '@lite/core/validation';
import { checkOrigin, json, readJson } from '@lite/core/http';
import { observabilityRoute, persistRequestLog } from '@lite/core/observability';
import { handleNativeApi, workspaceCookie } from './index';
import { operationCatalog } from './catalog';

export async function dispatchRequest(request:Request,context:ApiContext,options:{beforeWrite?:BeforeWrite}={}):Promise<Response>{
  const started=performance.now();let logContext:ApiContext|undefined,logOrg:Workspace|undefined;
  const source=new URL(request.url).pathname==='/api/mcp'?'mcp':'api';
  let detail:Record<string,unknown>={};
  const finish=async(response:Response)=>{
    if(logContext&&logOrg){const task=persistRequestLog(request,response,logContext,logOrg,source,started,detail).catch(()=>console.error('Request log persistence failed'));
      if(context.defer)context.defer(task);else await task;}
    return response;
  };
  try{
    const inbound=await mailInboundRoute(request,context);if(inbound)return inbound;
    const credential=await resolveToken(request,context);
    const trusted=credential?{...context,identity:credential.identity}:context;
    if(source==='api'&&trusted.identity){detail.query=Object.fromEntries(new URL(request.url).searchParams);if(!/^\/api\/v1\/(assistant|email)(?:\/|$)/.test(new URL(request.url).pathname)&&request.headers.get('content-type')?.startsWith('application/json'))detail.body=await readJson(request.clone()).catch(()=>undefined);}
    const orgFor=async(req:Request)=>workspace(context.env.DB,trusted.identity!,credential?.access.workspaceId??new URL(req.url).searchParams.get('workspace')??workspaceCookie(req));
    const invoke=async(incoming:Request,fixedOrg?:Workspace):Promise<Response>=>{
      let current=incoming;let url=new URL(current.url);
      const path=url.pathname.replace(/^\/api\/v1\//,'').replace(/\/$/,'');
      // Session bootstrap has no current workspace yet. Machine keys never enter it.
      if(!credential&&['health','bootstrap','session','invites/accept','workspaces','auth/me'].includes(path))return await handleNativeApi(current,trusted)??await handleApi(current,trusted,options);
      if(!trusted.identity)fail(401,'authentication_required','Authentification requise.');
      if(!credential)checkOrigin(current);
      if(credential&&url.searchParams.has('workspace')&&url.searchParams.get('workspace')!==credential.access.workspaceId)fail(403,'token_workspace','Cette clé appartient à un autre espace.');
      const org=fixedOrg??await orgFor(current);
      const operations=operationCatalog({db:context.env.DB,user:trusted.identity,workspace:org},context.app);
      const op=matchOperation(operations,current.method,url.pathname);
      logOrg=org;logContext=trusted;
      if(!op)fail(404,'not_found','Route introuvable.');
      if(credential)current=authorizeTokenRequest(current,credential.access,op);
      assertOperationAllowed(op,org);
      if(op.moduleId==='mail')detail={tool:detail.tool,operation:op.id};
      url=new URL(current.url);url.searchParams.set('workspace',org.id);current=new Request(url,current);
      const scoped={...trusted,workspace:org,operations};
      if(path==='admin/endpoints')return json({generatedAt:new Date().toISOString(),source:'operation-registry',openapiUrl:'/api/v1/openapi.json',endpoints:operations.flatMap(o=>[o.path,...(o.aliases??[])].map(path=>({...o,path,documented:true,summary:o.description,tags:[o.moduleName]})))});
      if(path==='openapi.json')return json(openApiDocument(operations,context.app,org));
      const call=async(path:string,init:{method?:string;body?:string}={})=>{
        const target=new URL('/api/v1/'+path,request.url);target.searchParams.set('workspace',org.id);
        const result=await invoke(new Request(target,{method:init.method??'GET',headers:{origin:target.origin,...(init.body?{'content-type':'application/json'}:{})},body:init.body}),org);
        const data=await result.json() as any;if(!result.ok)throw new ApiError(result.status,data.error?.code??data.code??'api_error',typeof data.error==='string'?data.error:data.error?.message??'Opération impossible.');return data;
      };
      if(path==='mcp/tools'||path==='mcp/call'){
        const tools=dataTools(context.app,org.role,call,credential?.access.mode!=='read',{operations,workspace:org,bindings:await toolBindings(scoped,org,operations),machine:Boolean(credential)});
        if(path==='mcp/tools')return json({tools:tools.map(({execute,...definition})=>definition)});
        const body=await readJson(current),tool=tools.find(t=>t.name===body.name);if(!tool)fail(403,'tool_forbidden','Outil désactivé ou inaccessible.');
        detail={tool:tool.name,args:body.arguments};return json(await tool.execute(body.arguments??{}));
      }
      const assistant=await assistantRoute(current,scoped,org,{tools:async()=>{
        // Re-read membership, group policies and MCP switches before each tool call.
        const liveOrg=await orgFor(current),liveOps=operationCatalog({db:context.env.DB,user:trusted.identity!,workspace:liveOrg},context.app);
        const assistantOp=liveOps.find(o=>o.id==='assistant.chat')!;assertOperationAllowed(assistantOp,liveOrg);
        const liveCall=async(path:string,init:{method?:string;body?:string}={})=>{
          const target=new URL('/api/v1/'+path,request.url);target.searchParams.set('workspace',org.id);
          const response=await invoke(new Request(target,{method:init.method??'GET',headers:{origin:target.origin,...(init.body?{'content-type':'application/json'}:{})},body:init.body}));
          const data=await response.json() as any;if(!response.ok)throw new ApiError(response.status,data.error?.code??'tool_error',data.error?.message??'Opération refusée.');return data;
        };
        return dataTools(context.app,liveOrg.role,liveCall,true,{operations:liveOps,workspace:liveOrg,bindings:await toolBindings({...scoped,workspace:liveOrg},liveOrg,liveOps)});
      }});
      if(assistant)return assistant;
      return await mailRoute(current,scoped,org)??await integrationsRoute(current,scoped,org)??await accessRoute(current,scoped,org,operations)??await mcpAdminRoute(current,scoped,org,operations)??await observabilityRoute(current,scoped,org)??await handleNativeApi(current,scoped)??await handleApi(current,scoped,options);
    };
    if(source==='mcp'){
      if(!trusted.identity)fail(401,'authentication_required','Authentification requise.');
      if(!credential)checkOrigin(request);
      const org=await orgFor(request);logOrg=org;logContext=trusted;
      const operations=operationCatalog({db:context.env.DB,user:trusted.identity,workspace:org},context.app),scoped={...trusted,workspace:org,operations};
      if(request.method==='POST'){const b=await readJson(request.clone()).catch(()=>({})) as any;detail={jsonrpcMethod:b.method,tool:b.params?.name,args:b.params?.arguments};}
      const api=async(path:string,init:{method?:string;body?:string}={})=>{
        const target=new URL('/api/v1/'+path,request.url);target.searchParams.set('workspace',org.id);
        const response=await invoke(new Request(target,{method:init.method??'GET',headers:{origin:target.origin,...(init.body?{'content-type':'application/json'}:{})},body:init.body}),org);
        const data=await response.json() as any;if(!response.ok)throw new ApiError(response.status,data.error?.code??data.code??'api_error',typeof data.error==='string'?data.error:data.error?.message??'Opération impossible.');return data;
      };
      return await finish(await handleMcp(request,context.app,org.role,api,credential?.access.mode!=='read',async()=>dataTools(context.app,org.role,api,credential?.access.mode!=='read',{operations,workspace:org,bindings:await toolBindings(scoped,org,operations),machine:Boolean(credential)})));
    }
    return await finish(await invoke(request));
  }catch(e){const response=e instanceof ApiError?json({error:{code:e.code,message:e.message}},e.status):json({error:{code:'service_unavailable',message:'Service indisponible.'}},503);if(!(e instanceof ApiError))console.error('API dispatch failed',e instanceof Error?e.name:'Error');return await finish(response);}
}
