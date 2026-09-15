import { handleNativeApi, workspaceCookie } from '@creezio/sites-adapter';
import { env } from 'cloudflare:workers';
import { handleApi } from '@/creezio/core/index';
import type { LiteEnvironment } from '@/creezio/core/index';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { appDefinition } from '@/app/app-definition';
import { beforeWrite } from '@/app/business-rules';
export const dynamic = 'force-dynamic';
async function route(request: Request) {
  const context={env:env as unknown as LiteEnvironment,identity:await getChatGPTUser(),app:appDefinition};
  const native=await handleNativeApi(request,context);if(native)return native;
  const url=new URL(request.url);if(!url.searchParams.has('workspace')&&workspaceCookie(request))url.searchParams.set('workspace',workspaceCookie(request)!);
  return handleApi(new Request(url,request),context,{beforeWrite});
}
export const GET=route;
export const POST=route;
export const PATCH=route;
export const DELETE=route;

export const PUT=route;
