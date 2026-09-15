import {env} from 'cloudflare:workers';
import {oauthRoute} from '@lite/core/mcp-oauth';
import type {LiteEnvironment} from '@lite/core';
import {appDefinition} from '@/app/app-definition';
import {getChatGPTUser} from '@/app/chatgpt-auth';
export const dynamic='force-dynamic';
async function route(request:Request){return oauthRoute(request,{app:appDefinition,env:env as unknown as LiteEnvironment,identity:await getChatGPTUser()});}
export const GET=route;
export const POST=route;
export const OPTIONS=route;
