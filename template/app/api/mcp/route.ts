import { env } from 'cloudflare:workers';
import { after } from 'next/server';
import { dispatchRequest } from '@lite/sites-adapter/dispatch';
import type { LiteEnvironment } from '@/runtime/core';
import { appDefinition } from '@/app/app-definition';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { appExtensions } from '@/app/app-extensions';
export const dynamic='force-dynamic';
async function route(request:Request){return dispatchRequest(request,{app:appDefinition,env:env as unknown as LiteEnvironment,defer:after,identity:await getChatGPTUser()},appExtensions);}
export const POST=route;
export const GET=route;
export const DELETE=route;
export const OPTIONS=route;
