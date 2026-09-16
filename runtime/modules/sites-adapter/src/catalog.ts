import type { AppDefinition, AppOperationDefinition } from '@lite/core';
import { coreOperations, operation, objectSchema, stringSchema, idSchema, paging, appOperations, assertUniqueOperations, type Operation } from '@lite/core/operations';
import { roles } from '@lite/core/validation';
import type { NativeContext } from './context';
import type { ApiMount } from '../../api-kernel/src/types';
import { navMount } from './nav';
import { demoMount } from './demo';
import { tasksMount } from './tasks';
import { supportMount } from './support';

/** Registration is shared by dispatch, HTTP documentation, permissions and tools. */
export function nativeMounts(c:NativeContext,app:AppDefinition):{id:string;name:string;space:'module'|'platform';mount:ApiMount;alias?:string}[]{
  return [
    {id:'nav',name:'Navigation',space:'module',mount:navMount(c,app)},
    {id:'interactive-demo',name:'Visite guidée',space:'module',mount:demoMount(c,app.name)},
    {id:'tasks',name:'Tâches',space:'module',mount:tasksMount(c),alias:'/api/v1/tasks'},
    {id:'platform-support',name:'Support',space:'platform',mount:supportMount(c)},
  ];
}
/** One catalogue for HTTP, MCP, assistant tools, administration and OpenAPI; application operations join it before duplicate detection. */
export function operationCatalog(c:NativeContext,app:AppDefinition,extensions:AppOperationDefinition[]=[]):Operation[]{
  const result=coreOperations(app);
  result.push(...appOperations(app,extensions));
  for(const entry of nativeMounts(c,app))for(const op of entry.mount.operations??[]){
    const base=`/api/v1/${entry.space==='module'?'modules':'platform'}/${entry.id}`,suffix=op.path==='/'?'':op.path;
    const moduleId=entry.id==='platform-support'?'support':entry.id;
    const read=op.method==='GET',isAdmin=Boolean(op.permission)||(entry.id==='nav'&&op.id!=='list')||(entry.id==='interactive-demo'&&op.path.startsWith('/scenarios')&&!read);
    result.push(operation({id:`${moduleId}.${op.id}`,moduleId,moduleName:entry.name,method:op.method,path:base+suffix,...(entry.alias?{aliases:[entry.alias+suffix]}:{}),description:op.description,
      ...(moduleId==='support'&&op.id==='detail'?{toolName:'lite_support_get'}:{}),
      roles:isAdmin?['owner','admin']:read?roles:['owner','admin','member'],essential:entry.id==='nav'&&op.id==='list',
      ...(op.method==='DELETE'?{}:read?{querySchema:objectSchema({...paging,...(entry.id==='interactive-demo'?{user:idSchema}:{})})}:{bodySchema:(op.inputSchema as any)??{type:'object',additionalProperties:true}}),
    }));
  }
  for(const [id,path,description] of [['health','health','Santé du noyau'],['version','version','Version du runtime'],['architecture','architecture','Architecture et modules montés'],['sqlite.status','sqlite/status','État du stockage Sites']] as const){
    result.push(operation({id:`core.${id==='health'?'kernel_health':id}`,moduleId:'core',moduleName:'Système',method:'GET',path:`/api/v1/core/${path}`,description,roles,essential:true,...(id==='health'?{aliases:['/api/v1/core']}:{})}));
  }
  return assertUniqueOperations(result);
}
