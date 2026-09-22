import type { Module, Field } from './types.ts';
export const storedFields=(module:Module)=>[...module.fields,...(module.serverFields??[]).map(f=>({...f,editable:false}))].filter(f=>f.storage!=='computed');
export const editableFields=(module:Module)=>storedFields(module).filter(f=>f.editable!==false);

export const queryableField=(field:Pick<Field,'storage'|'queryable'>)=>field.storage!=='computed'||field.queryable===true;
