import { createInteractiveDemoMount, genericOsTourScenario, type DemoScenario, type DemoScenarioOverride } from '@lite/interactive-demo';
import type { ApiMount } from '../../api-kernel/src/types.ts';
import { fail } from '@lite/core/validation';
import { admin, now, type NativeContext } from './context';

export function demoMount(c:NativeContext,productName:string,contributions:DemoScenario[]=[]):ApiMount {
  const db=c.db,org=c.workspace.id;
  // Same OS tour and player; optional assistant steps skip their missing target.
  const scenario=genericOsTourScenario({productName,homeHref:'/dashboard'});
  scenario.autoStart=false;
  const assertUser=(user:string)=>{if(user!==c.user.displayName&&user!==c.user.userId)fail(403,'preference_owner','Préférences d’un autre utilisateur.');};
  const mount=createInteractiveDemoMount({defaults:[scenario,...contributions.filter(item=>item.id!==scenario.id)],persistence:{
    async overrides(){return (await db.prepare('SELECT value_json FROM sites_demo_content WHERE org_id=?').bind(org).all<{value_json:string}>()).results.map(r=>JSON.parse(r.value_json) as DemoScenarioOverride);},
    async putOverride(id,value){admin(c);if(id.length>160)fail(400,'invalid_id','Identifiant trop long.');await db.prepare('INSERT INTO sites_demo_content(org_id,id,value_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(org_id,id) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at').bind(org,id,JSON.stringify(value),now()).run();},
    async removeOverride(id){admin(c);await db.prepare('DELETE FROM sites_demo_content WHERE org_id=? AND id=?').bind(org,id).run();},
    async preferences(user){assertUser(user);const r=await db.prepare('SELECT key,value_json FROM sites_demo_preferences WHERE org_id=? AND user_id=?').bind(org,c.user.userId).all<{key:string;value_json:string}>();return Object.fromEntries(r.results.map(r=>[r.key,JSON.parse(r.value_json)]));},
    async putPreferences(user,answers){assertUser(user);const values=Object.entries(answers);if(values.length>50||values.some(([k,v])=>k.length>160||JSON.stringify(v).length>8192))fail(400,'preferences_too_large','Préférences trop volumineuses.');if(values.length)await db.batch(values.map(([key,v])=>db.prepare('INSERT INTO sites_demo_preferences(org_id,user_id,key,value_json,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(org_id,user_id,key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at').bind(org,c.user.userId,key,JSON.stringify(v),now())));return values.length;},
  }});
  return {...mount,handle:ctx=>{if(ctx.subPath.startsWith('scenarios/')&&ctx.req.method!=='GET')admin(c);return mount.handle(ctx);}};
}
