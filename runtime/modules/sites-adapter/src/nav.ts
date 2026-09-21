import { createNavMount } from '../../nav/src/mount.ts';
import { mergeNavOverridePatch, type NavStoredOverride, type NavOverridePatch } from '../../nav/src/store.ts';
import { defaultOsCatalogEntries, type NavCatalogEntry } from '../../shell-ui/src/nav-catalog.ts';
import { OS_ADMIN_NAV_ENTRY } from '../../nav/src/admin-entry.ts';
import type { AppDefinition } from '@lite/core';
import { moduleRegistry } from '@lite/core/registry';
import { fail } from '@lite/core/validation';
import { canReadModule } from '@lite/core/operations';
import { admin, audit, now, type NativeContext } from './context';

export function nativeEntries(app: AppDefinition): NavCatalogEntry[] {
  const live = new Set(['/taches','/parametres','/collaborateurs']);
  const extra = (id: string,href: string,label: string,icon: string,order: number,group: 'core'|'admin'='core'): NavCatalogEntry => ({id,href,label,icon,order,group,source:'os',available:true,defaultVisible:true,...(group==='admin'?{permission:'platform.access.manage'}:{})});
  return [extra('os.dashboard','/dashboard','Tableau de bord','LayoutDashboard',0),
    ...defaultOsCatalogEntries().filter(e=>live.has(e.href)),
    extra('os.mails','/mails','Mail','Mail',23),
    extra('os.documents','/documents','Documents','FileText',24),
    extra('os.onboarding','/onboarding','Prise en main','Circle',64),extra('os.support','/support','Support','Circle',65),OS_ADMIN_NAV_ENTRY,
    extra('os.audit','/admin/activity','Journal d’activité','Activity',74,'admin'),
    extra('os.analytics','/admin/analytics','Analytics','Activity',74.5,'admin'),
    extra('os.search','/admin/search','Recherche','Search',75,'admin'),
    extra('os.api','/admin/api','API','Braces',76,'admin'),
    extra('os.mcp','/admin/mcp','MCP','Plug',77,'admin'),
    extra('os.access','/admin/access','Groupes et accès','Shield',78,'admin'),
    extra('os.integrations','/admin/integrations','Intégrations','KeyRound',78.5,'admin'),
    extra('os.connections','/admin/connections','Clés et connexions','KeyRound',79,'admin'),
    // Collections and entities declared navigation:false own no entry; their permission stays explicit.
    ...moduleRegistry(app).filter(m=>m.kind==='business'&&m.navigation).map((m,i):NavCatalogEntry=>({id:`module.${m.id}`,href:m.href,label:m.name,icon:'FileText',group:'brand',order:40+i,source:'module',available:true,defaultVisible:true,permission:`module.${m.id}.read`}))];
}
export function permissions(c:NativeContext,app:AppDefinition):string[] {
  return [...(['owner','admin'].includes(c.workspace.role)&&(!c.access||c.access.evaluateAccess({kind:'operation',operationId:'access.catalog'}).allowed)?['platform.access.manage','platform.users.manage']:[]),
    ...app.modules.filter(m=>(m.readRoles??['owner','admin','member','viewer']).includes(c.workspace.role)&&canReadModule(c.workspace,m.id,c.access)).map(m=>`module.${m.id}.read`)];
}
export function navMount(c: NativeContext, app: AppDefinition) {
  const org = c.workspace.id;
  async function list() {
    const rows=await c.db.prepare('SELECT value_json FROM sites_nav_overrides WHERE org_id=? ORDER BY entry_id').bind(org).all<{value_json:string}>();
    return rows.results.map(r=>JSON.parse(r.value_json) as NavStoredOverride);
  }
  async function prepare(patch:NavOverridePatch, actor?:string) {
    if (!nativeEntries(app).some(e=>e.id===patch.entryId) || patch.entryId.length>160) fail(400,'unknown_nav_entry','Entrée de navigation inconnue.');
    for(const k of ['label','icon','permission'] as const) if(typeof patch[k]==='string' && patch[k]!.length>160) fail(400,'invalid_nav_override','Personnalisation trop longue.');
    const value={...mergeNavOverridePatch(null,patch),updatedBy:actor,updatedAt:now()};
    const delta: Record<string,unknown>={...value};
    if (patch.hidden === undefined) delete delta.hidden;
    for(const key of ['order','label','icon','group','permission'] as const) if(patch[key]===null||patch[key]==='')delta[key]=null;
    // JSON Merge Patch is applied by SQLite to the current value, atomically.
    const statement=c.db.prepare('INSERT INTO sites_nav_overrides(org_id,entry_id,value_json) VALUES(?,?,?) ON CONFLICT(org_id,entry_id) DO UPDATE SET value_json=json_patch(sites_nav_overrides.value_json,?)').bind(org,patch.entryId,JSON.stringify(value),JSON.stringify(delta));
    return {value,statement};
  }
  return createNavMount({
    osEntries:()=>nativeEntries(app).filter(e=>{
      const id=moduleRegistry(app).find(m=>m.href===e.href)?.id;
      if(!c.access)return !id||canReadModule(c.workspace,id);
      if(id)return canReadModule(c.workspace,id,c.access);
      const mapped:Record<string,string>={'os.onboarding':'onboarding.content','os.dashboard':'dashboard.get','os.mails':'mail.list','os.documents':'files.list','os.support':'support.list','os.audit':'logs.list','os.analytics':'analytics.overview','os.search':'search.settings','os.api':'api.catalog','os.mcp':'mcp.status','os.access':'access.catalog','os.integrations':'integrations.list','os.connections':'tokens.list',[OS_ADMIN_NAV_ENTRY.id]:'nav.catalog'};
      return !!mapped[e.id]&&c.access.evaluateAccess({kind:'operation',operationId:mapped[e.id]}).allowed;
    }), features:{plugins:false,fleet:false},
    getSession:()=>({sub:c.user.userId,role:c.workspace.role==='owner'?'owner':'collaborator',permissions:permissions(c,app),impersonating:false}),
    persistence:{list,
      async upsert(patch,actor) {admin(c);const p=await prepare(patch,actor);await c.db.batch([p.statement,audit(c,'nav.update',patch.entryId)]);return (await list()).find(v=>v.entryId===patch.entryId)!;},
      async reorder(ids,actor) {admin(c);if(ids.length>100||new Set(ids).size!==ids.length)fail(400,'invalid_order','Ordre invalide.');const ps=await Promise.all(ids.map((entryId,i)=>prepare({entryId,order:(i+1)*10},actor)));if(!ps.length)return [];await c.db.batch([...ps.map(p=>p.statement),audit(c,'nav.reorder','catalog')]);return (await list()).filter(v=>ids.includes(v.entryId));},
      async remove(id) {admin(c);await c.db.batch([c.db.prepare('DELETE FROM sites_nav_overrides WHERE org_id=? AND entry_id=?').bind(org,id),audit(c,'nav.reset',id)]);},
    },
  });
}
