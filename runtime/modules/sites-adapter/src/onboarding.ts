import type {ApiMount} from '../../api-kernel/src/types.ts';
import type {BrandModuleOnboarding} from '@lite/core/module-contract';
import {mergeOnboardingContent,type OnboardingContentOverride} from '@lite/core/onboarding-content';
import {commitRequestAccessBatch} from '@lite/core/access-profiles-store';
import {fail} from '@lite/core/validation';
import {validateSchema} from '@lite/core/tools';
import {objectSchema} from '@lite/core/operations';
import {admin,now,type NativeContext} from './context';
const text={type:'string',maxLength:4000} as const;
const dictionary={type:'object',additionalProperties:text};
const contentSchema=objectSchema({steps:{type:'array',maxItems:100,items:objectSchema({id:{type:'string',minLength:1,maxLength:100},label:text,interstitialTitle:text,interstitialTagline:text,texts:dictionary},['id'])},texts:dictionary,mascot:objectSchema({baseUrl:text,poses:dictionary})});
const preferencesSchema=objectSchema({user:{type:'string',maxLength:200},answers:{type:'object',additionalProperties:true}},['answers']);
/** Same content/preferences contract as Creezio; workspace and user are server-owned. */
export function onboardingMount(c:NativeContext,defaults:BrandModuleOnboarding={steps:[]}):ApiMount{
 const db=c.db,org=c.workspace.id,user=c.user.userId;
 const assertUser=(value:unknown)=>{if(value!==undefined&&value!==user&&value!==c.user.displayName)fail(403,'preference_owner','Préférences d’un autre utilisateur.');};
 const content=async()=>{const row=await db.prepare('SELECT value_json FROM sites_onboarding_content WHERE org_id=?').bind(org).first<{value_json:string}>();return {ok:true,content:mergeOnboardingContent(defaults,row?JSON.parse(row.value_json):null),hasOverride:!!row};};
 return {operations:[
  {id:'content',method:'GET',path:'/content',description:'Lire le parcours et le contenu des modules'},
  {id:'content.update',method:'PUT',path:'/content',description:'Personnaliser le contenu du parcours',permission:'platform.access.manage',inputSchema:contentSchema},
  {id:'content.reset',method:'DELETE',path:'/content',description:'Rétablir les défauts du parcours',permission:'platform.access.manage'},
  {id:'preferences',method:'GET',path:'/preferences',description:'Lire ses réponses et sa progression'},
  {id:'preferences.update',method:'PUT',path:'/preferences',description:'Enregistrer ses réponses et sa progression',roles:['owner','admin','member','viewer'],inputSchema:preferencesSchema},
 ],async handle({req,subPath}){
  if(subPath==='content'){
   if(req.method==='GET')return {status:200,body:await content()};
   admin(c);
   if(req.method==='PUT'){
    validateSchema(contentSchema,req.body);if(JSON.stringify(req.body).length>65536)fail(400,'preferences_too_large','Contenu trop volumineux.');
    await commitRequestAccessBatch(db,c.access,[db.prepare('INSERT INTO sites_onboarding_content(org_id,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(org_id) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at').bind(org,JSON.stringify(req.body as OnboardingContentOverride),now())]);
    return {status:200,body:await content()};
   }
   if(req.method==='DELETE'){await commitRequestAccessBatch(db,c.access,[db.prepare('DELETE FROM sites_onboarding_content WHERE org_id=?').bind(org)]);return {status:200,body:await content()};}
  }
  if(subPath==='preferences'){
   if(req.method==='GET'){assertUser(req.query?.user);const rows=await db.prepare('SELECT key,value_json FROM sites_onboarding_preferences WHERE org_id=? AND user_id=?').bind(org,user).all<{key:string;value_json:string}>();return {status:200,body:{ok:true,user,answers:Object.fromEntries(rows.results.map(row=>[row.key,JSON.parse(row.value_json)]))}};}
   if(req.method==='PUT'){
    validateSchema(preferencesSchema,req.body);const body=req.body as {user?:string;answers:Record<string,unknown>};assertUser(body.user);
    const entries=Object.entries(body.answers);if(entries.length>100||entries.some(([key,value])=>!key||key.length>160||JSON.stringify(value).length>8192))fail(400,'preferences_too_large','Préférences trop volumineuses.');
    if(entries.length)await commitRequestAccessBatch(db,c.access,entries.map(([key,value])=>db.prepare('INSERT INTO sites_onboarding_preferences(org_id,user_id,key,value_json,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(org_id,user_id,key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at').bind(org,user,key,JSON.stringify(value),now())));
    return {status:200,body:{ok:true,user,count:entries.length}};
   }
  }
  return {status:404,body:{ok:false,error:'not_found'}};
 }};
}
