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

/** The server supplies the same enabled bindings as HTTP MCP; it checks each call again. */
export function registerServerTools(context:ModelContext,api:Api,onMutation:()=>void){
  let stopped=false,active:AbortController|undefined;let fingerprint='';
  async function refresh(){try{
    const {tools}=await api('mcp/tools');if(stopped)return;
    const next=JSON.stringify(tools);if(next===fingerprint)return;fingerprint=next;active?.abort();active=new AbortController();
    for(const definition of tools){const tool={...definition,execute:async(input:unknown)=>{const value=await api('mcp/call',{method:'POST',body:JSON.stringify({name:definition.name,arguments:input})});if(!definition.annotations.readOnlyHint)onMutation();return value;}};await context.registerTool(tool,{signal:active.signal});}
  }catch{console.warn('WebMCP : actualisation indisponible.');}}
  void refresh();const timer=window.setInterval(()=>void refresh(),60000);window.addEventListener('focus',refresh);
  return ()=>{stopped=true;active?.abort();window.clearInterval(timer);window.removeEventListener('focus',refresh);};
}
