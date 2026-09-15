import type { ApiContext, BeforeWrite } from '@lite/core';
import { handleApi } from '@lite/core';
import { workspace } from '@lite/core/api';
import { resolveToken, authorizeTokenRequest } from '@lite/core/access-tokens';
import { handleMcp } from '@lite/core/mcp';
import { ApiError, fail } from '@lite/core/validation';
import { checkOrigin, json } from '@lite/core/http';
import { handleNativeApi, workspaceCookie } from './index';

export async function dispatchRequest(request:Request,context:ApiContext,options:{beforeWrite?:BeforeWrite}={}):Promise<Response>{
  try{
    const credential=await resolveToken(request,context);
    const trusted=credential?{...context,identity:credential.identity}:context;
    const invoke=async(incoming:Request)=>{
      let current=incoming;
      if(credential)current=authorizeTokenRequest(current,credential.access);
      const url=new URL(current.url);
      if(!url.searchParams.has('workspace')&&workspaceCookie(current))url.searchParams.set('workspace',workspaceCookie(current)!);
      current=new Request(url,current);
      return await handleNativeApi(current,trusted)??await handleApi(current,trusted,options);
    };
    if(new URL(request.url).pathname==='/api/mcp'){
      if(!trusted.identity)fail(401,'authentication_required','Authentification requise.');
      if(!credential)checkOrigin(request);
      const org=await workspace(context.env.DB,trusted.identity,credential?.access.workspaceId??workspaceCookie(request));
      return await handleMcp(request,context.app,org.role,async(path,init={})=>{
        const url=new URL(`/api/v1/${path}`,request.url);url.searchParams.set('workspace',org.id);
        const response=await invoke(new Request(url,{method:init.method??'GET',headers:{origin:url.origin,...(init.body?{'content-type':'application/json'}:{})},body:init.body}));
        const data=await response.json() as any;
        if(!response.ok)throw new ApiError(response.status,data.error?.code??data.code??'api_error',typeof data.error==='string'?data.error:data.error?.message??'Opération impossible.');
        return data;
      },credential?.access.mode!=='read');
    }
    return await invoke(request);
  }catch(e){if(e instanceof ApiError)return json({error:{code:e.code,message:e.message}},e.status);console.error('API dispatch failed',e instanceof Error?e.name:'Error');return json({error:{code:'service_unavailable',message:'Service indisponible.'}},503);}
}
