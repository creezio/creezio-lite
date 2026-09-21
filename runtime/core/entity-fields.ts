import type { Module } from './types.ts';
export const storedFields=(module:Module)=>[...module.fields,...(module.serverFields??[]).map(f=>({...f,editable:false}))].filter(f=>f.storage!=='computed');
export const editableFields=(module:Module)=>storedFields(module).filter(f=>f.editable!==false);
