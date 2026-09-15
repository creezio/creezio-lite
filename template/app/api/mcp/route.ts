import { env } from 'cloudflare:workers';
import { dispatchRequest } from '@lite/sites-adapter/dispatch';
import type { LiteEnvironment } from '@/runtime/core';
import { appDefinition } from '@/app/app-definition';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { beforeWrite } from '@/app/business-rules';
export const dynamic='force-dynamic';
async function route(request:Request){return dispatchRequest(request,{app:appDefinition,env:env as unknown as LiteEnvironment,identity:await getChatGPTUser()},{beforeWrite});}
export const POST=route;
export const GET=route;
export const DELETE=route;
