import {env} from 'cloudflare:workers';
import {oauthRoute} from '@lite/core/mcp-oauth';
import type {LiteEnvironment} from '@lite/core';
import {appDefinition} from '@/app/app-definition';
export const dynamic='force-dynamic';
export function GET(request:Request){return oauthRoute(request,{app:appDefinition,env:env as unknown as LiteEnvironment,identity:null});}
export const OPTIONS=GET;
