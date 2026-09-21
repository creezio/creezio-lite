import handler from 'vinext/server/fetch-handler';
import { dispatchRequest } from './runtime/modules/sites-adapter/src/dispatch';
import { appDefinition } from './app/app-definition';
import { appExtensions } from './app/app-extensions';
import type { LiteEnvironment } from './runtime/core/types';

// Keep streaming responses and WebSocket upgrades at the native Worker boundary.
// Identity headers are supplied exclusively by the Sites dispatcher.
export default {
  async fetch(request:Request,env:LiteEnvironment,ctx:{waitUntil(promise:Promise<unknown>):void}) {
    if(new URL(request.url).pathname.startsWith('/api/v1/assistant/')) {
      const userId=request.headers.get('oai-authenticated-user-id'),email=request.headers.get('oai-authenticated-user-email');
      let displayName=email??'';
      if(request.headers.get('oai-authenticated-user-full-name-encoding')==='percent-encoded-utf-8')try{displayName=decodeURIComponent(request.headers.get('oai-authenticated-user-full-name')??'')||displayName;}catch{}
      return dispatchRequest(request,{env,identity:userId&&email?{userId,email,displayName}:null,app:appDefinition,defer:promise=>ctx.waitUntil(promise)},appExtensions);
    }
    return handler.fetch(request,env,ctx);
  },
};
