import { env } from 'cloudflare:workers';
import { handleApi } from '@/creezio/core/index';
import type { LiteEnvironment } from '@/creezio/core/index';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { appDefinition } from '@/app/app-definition';
import { beforeWrite } from '@/app/business-rules';
export const dynamic = 'force-dynamic';
async function route(request: Request) {
  return handleApi(request,{env:env as unknown as LiteEnvironment,identity:await getChatGPTUser(),app:appDefinition},{beforeWrite});
}
export const GET=route;
export const POST=route;
export const PATCH=route;
export const DELETE=route;
