import type { BeforeWrite, Module, RecordData } from './types.ts';
import type { EntityHooks, EntityHookContext } from './module-contract.ts';
import { fail, validateData } from './validation.ts';

import {storedFields,editableFields} from './entity-fields.ts';
export {storedFields,editableFields} from './entity-fields.ts';
/** Validate the full persisted value, after every server transformation. */
export function validateStoredData(module:Module,input:unknown,options:{previous?:Record<string,unknown>}={}):Record<string,unknown>{
 const fields=storedFields(module).filter(f=>f.required||!module.serverFields?.some(s=>s.key===f.key)||!!input&&typeof input==='object'&&Object.hasOwn(input,f.key));
 const absent=(value:unknown)=>value===undefined||value===null||value==='';
 const checked=fields.map(f=>f.required&&options.previous&&absent(options.previous[f.key])&&input&&typeof input==='object'&&absent((input as Record<string,unknown>)[f.key])?{...f,required:false}:f);
 return validateData({...module,fields:checked},input,{stored:true});
}
/** Closed client input. Omitted server fields are inherited, never reset by a form. */
export function validateEntityInput(module:Module,input:unknown,previous:Record<string,unknown>|null=null){
 if(!input||typeof input!=='object'||Array.isArray(input))fail(400,'invalid_data','Les données doivent être un objet.');
 const source=input as Record<string,unknown>,editable=editableFields(module),keys=new Set(editable.map(f=>f.key));
 for(const key of Object.keys(source))if(!keys.has(key)){
  const field=storedFields(module).find(f=>f.key===key);
  // Compatibility with clients that echo an entire record: an identical server value is not a write.
  if(field?.editable===false&&previous&&Object.hasOwn(previous,key)&&JSON.stringify(source[key])===JSON.stringify(previous[key]))continue;
  fail(400,module.fields.some(f=>f.key===key)||field?'readonly_field':'unknown_field','Ce champ ne peut pas être écrit.');
 }
 const submitted=Object.fromEntries(Object.entries(source).filter(([key])=>keys.has(key)));
 const baseline=previous?Object.fromEntries(editable.filter(f=>Object.hasOwn(previous,f.key)).map(f=>[f.key,previous[f.key]])):{};
 const data=validateData({...module,fields:editable},{...baseline,...submitted});
 for(const field of storedFields(module))if(field.editable===false&&previous&&Object.hasOwn(previous,field.key))data[field.key]=previous[field.key];
 return data;
}
/** Also callable by commands before constructing their own atomic D1 batch. */
export async function prepareEntityWrite(input:Parameters<BeforeWrite>[0],options:{beforeWrite?:BeforeWrite;hooks?:EntityHooks;source?:'client'|'server'}={}){
 const data=options.source==='server'?structuredClone(input.data):validateEntityInput(input.module,input.data,input.previous);
 const context={...input,data};
 await options.beforeWrite?.(context);
 await (input.previous?options.hooks?.beforeUpdate:options.hooks?.beforeCreate)?.(context);
 return validateStoredData(input.module,data);
}
export type CommitEffect={id:string;run:()=>void|Promise<unknown>};
/** Never turn an already committed write into an apparent rollback. Durable effects must be queued in the transaction. */
export async function runAfterCommit(effects:readonly CommitEffect[]){
 const results: {id:string;status:'done'|'failed'}[]=[];
 for(const effect of effects){try{await effect.run();results.push({id:effect.id,status:'done'});}catch{console.error(JSON.stringify({event:'lite.after-commit-failed',effect:effect.id}));results.push({id:effect.id,status:'failed'});}}
 return results;
}
export async function entityAfterCommit(hooks:EntityHooks|undefined,action:'create'|'update'|'archive',context:EntityHookContext,record:RecordData){
 const hook=action==='create'?hooks?.afterCreate:action==='update'?hooks?.afterUpdate:hooks?.afterArchive;
 return runAfterCommit(hook?[{id:context.module.id+'.'+action,run:()=>hook({...context,record:structuredClone(record)})}]:[]);
}

/** Preserve the caller's transaction boundary: effects start only after its commit resolves. */
export async function commitWithEffects<T>(commit:()=>Promise<T>,effects:readonly CommitEffect[]=[]):Promise<T>{
 const result=await commit();await runAfterCommit(effects);return result;
}

/** Typed partial command write, as in Creezio PATCH: untouched legacy values are preserved verbatim. */
export function validateStoredPatch(module:Module,patch:Record<string,unknown>,previous:Record<string,unknown>){
 const keys=new Set(Object.keys(patch));
 const checked=validateData({...module,fields:storedFields(module).filter(f=>keys.has(f.key))},patch,{stored:true});
 return {...previous,...checked};
}
