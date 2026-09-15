import {env} from 'cloudflare:workers';
import type {Metadata} from 'next';
import type {LiteEnvironment} from '@lite/core';
import {prepareOAuthConsent} from '@lite/core/mcp-oauth';
import {ApiError} from '@lite/core/validation';
import {OAuthConsentForm} from '@/runtime/ui/oauth-consent';
import {appDefinition} from '@/app/app-definition';
import {requireChatGPTUser} from '@/app/chatgpt-auth';
export const dynamic='force-dynamic';
// Native form POSTs under no-referrer send Origin: null. Keep the real Origin
// for this same-origin decision while withholding Referer from external clients.
export const metadata:Metadata={referrer:'same-origin'};
export default async function Page({searchParams}:{searchParams:Promise<{request?:string}>}){
  const params=await searchParams;
  return <Consent requestId={typeof params.request==='string'?params.request:''}/>;
}
async function Consent({requestId}:{requestId:string}){
  const identity=await requireChatGPTUser('/oauth/consent?request='+encodeURIComponent(requestId));
  try{
    const consent=await prepareOAuthConsent({app:appDefinition,env:env as unknown as LiteEnvironment,identity},requestId);
    return <OAuthConsentForm consent={consent} appName={appDefinition.name}/>;
  }catch(error){
    if(!(error instanceof ApiError))throw error;
    return <main className="min-h-screen grid place-items-center p-6"><div className="max-w-lg space-y-4"><h1 className="text-xl font-semibold">Connexion MCP</h1><p role="alert">{error.message}</p><a href="/dashboard" className="underline">Retour à l’application</a></div></main>;
  }
}
