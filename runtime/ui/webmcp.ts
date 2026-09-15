import type { AppDefinition, Module, Role } from '../core/types';
import { dataTools } from '../core/tools.ts';
import type { Api } from './client';
export type ModelContext = {registerTool:(tool:ReturnType<typeof dataTools>[number],options:{signal:AbortSignal})=>void|Promise<void>};
export function registerLiteTools(context:ModelContext,api:Api,modules:Module[],onMutation:()=>void,role:Role='member') {
  const life=new AbortController();
  const app:AppDefinition={id:'lite',name:'Lite',description:'',modules};
  for(const tool of dataTools(app,role,api)){
    const registered={...tool,execute:async(input:unknown)=>{const result=await tool.execute(input);if(!tool.annotations.readOnlyHint)onMutation();return result;}};
    try{void Promise.resolve(context.registerTool(registered,{signal:life.signal})).catch(()=>console.warn(`WebMCP indisponible : ${tool.name}`));}catch{console.warn(`WebMCP indisponible : ${tool.name}`);}
  }
  return ()=>life.abort();
}
