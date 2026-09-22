import type {BrandModuleRegistry} from '@lite/core/module-contract';
import type { AppDefinition, AppExtensions, AppOperationDefinition } from '@lite/core';
import { coreOperations, operation, objectSchema, stringSchema, idSchema, paging, appOperations, assertUniqueOperations, canReadModule, type Operation } from '@lite/core/operations';
import { defineExtensions as defineCoreExtensions } from '@lite/core/commands';
import { roles } from '@lite/core/validation';
import type { NativeContext } from './context';
import type { ApiMount } from '../../api-kernel/src/types';
import { navMount } from './nav';
import { demoMount } from './demo';
import { tasksMount } from './tasks';
import { supportMount } from './support';
import { onboardingMount } from './onboarding';
import {composeOnboardingFromModules} from '@lite/core/module-contract';

/** Registration is shared by dispatch, HTTP documentation, permissions and tools. */
export function nativeMounts(c:NativeContext,app:AppDefinition,extensions:AppExtensions={}):{id:string;name:string;space:'module'|'platform';mount:ApiMount;alias?:string}[]{
  const visibleModules=extensions.registry?.modules.filter(mod=>Object.values(mod.entitySpecs).some(spec=>(spec.schema.readRoles??roles).includes(c.workspace.role)&&canReadModule(c.workspace,spec.schema.id,c.access)))??[];
  return [
    {id:'nav',name:'Navigation',space:'module',mount:navMount(c,app)},
    {id:'interactive-demo',name:'Visite guidée',space:'module',mount:demoMount(c,app.name,extensions.registry?.collectDemoScenarios())},
    {id:'onboarding',name:'Prise en main',space:'module',mount:onboardingMount(c,composeOnboardingFromModules(visibleModules))},
    {id:'tasks',name:'Tâches',space:'module',mount:tasksMount(c),alias:'/api/v1/tasks'},
    {id:'platform-support',name:'Support',space:'platform',mount:supportMount(c)},
  ];
}
/** One catalogue for HTTP, MCP, assistant tools, administration and OpenAPI; application operations join it before duplicate detection. */
export function operationCatalog(c:NativeContext,app:AppDefinition,extensions:AppOperationDefinition[]=[],registry?:BrandModuleRegistry):Operation[]{
  const result=coreOperations(app);
  for(const entry of nativeMounts(c,app))for(const op of entry.mount.operations??[]){
    const base=`/api/v1/${entry.space==='module'?'modules':'platform'}/${entry.id}`,suffix=op.path==='/'?'':op.path;
    const moduleId=entry.id==='platform-support'?'support':entry.id;
    const read=op.method==='GET',isAdmin=Boolean(op.permission)||(entry.id==='nav'&&op.id!=='list')||(entry.id==='interactive-demo'&&op.path.startsWith('/scenarios')&&!read);
    result.push(operation({id:`${moduleId}.${op.id}`,moduleId,moduleName:entry.name,method:op.method,path:base+suffix,...(entry.alias?{aliases:[entry.alias+suffix]}:{}),description:op.description,
      ...(moduleId==='support'&&op.id==='detail'?{toolName:'lite_support_get'}:{}),
      roles:isAdmin?['owner','admin']:(entry.id==='onboarding'&&op.roles?op.roles as import('@lite/core').Role[]:read?roles:['owner','admin','member']),essential:entry.id==='nav'&&op.id==='list',
      ...(op.method==='DELETE'?{}:read?{querySchema:objectSchema({...paging,...(['interactive-demo','onboarding'].includes(entry.id)?{user:idSchema}:{})})}:{bodySchema:(op.inputSchema as any)??{type:'object',additionalProperties:true}}),
    }));
  }
  for(const [id,path,description] of [['health','health','Santé du noyau'],['version','version','Version du runtime'],['architecture','architecture','Architecture et modules montés'],['sqlite.status','sqlite/status','État du stockage Sites']] as const){
    result.push(operation({id:`core.${id==='health'?'kernel_health':id}`,moduleId:'core',moduleName:'Système',method:'GET',path:`/api/v1/core/${path}`,description,roles,essential:true,...(id==='health'?{aliases:['/api/v1/core']}:{})}));
  }
  // Application operations come last so a collision always names the kit operation first, as defineExtensions does.
  result.push(...appOperations(app,extensions,registry));
  return assertUniqueOperations(result);
}

/** Mounts capture the context lazily; the declaration-time catalogue never touches a database. */
const declarationContext:NativeContext={db:undefined as unknown as NativeContext['db'],user:{userId:'',email:'',displayName:''},workspace:{id:'',name:'',role:'owner'}};
/** The complete catalogue of the kit for this application, without extensions: core routes plus every native mount. */
export function nativeCatalog(app:AppDefinition):Operation[]{return operationCatalog(declarationContext,app);}
/**
 * Validate application extensions against the shared catalogue at construction time.
 * A collision with a core or native operation (ID, route shape or tool name) or an invalid schema
 * throws here with a stable OperationCatalogError instead of failing every request with 503.
 */
export function defineExtensions(app:AppDefinition,extensions:AppExtensions={}):AppExtensions{
  return defineCoreExtensions(app,extensions,nativeCatalog(app));
}
