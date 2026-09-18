import { dispatchRequest } from '@lite/sites-adapter/dispatch';
import { env } from 'cloudflare:workers';
import { after } from 'next/server';
import type { LiteEnvironment } from '@/runtime/core/index';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { appDefinition } from '@/app/app-definition';
import { beforeWrite } from '@/app/business-rules';
export const dynamic = 'force-dynamic';
async function route(request: Request) {
  const context={env:env as unknown as LiteEnvironment,defer:after,identity:await getChatGPTUser(),app:appDefinition};
  return dispatchRequest(request,context,{beforeWrite});
}
export const GET=route;
export const POST=route;
export const PATCH=route;
export const DELETE=route;

export const PUT=route;
