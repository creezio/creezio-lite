"use client";
import {useCallback} from 'react';
import {useLoad} from './client.ts';
import type {Workspace} from '../core';
type Result={workspace:Workspace};
/** Shared workspace identity adapter; loading/refresh semantics belong to the kit. */
export function useWorkspaceContext(load:()=>Promise<Result>,identity:string,revision:number){
 const read=useCallback(()=>identity?load():Promise.resolve(null),[load,identity]);
 const state=useLoad<Result|null>(read,[read,revision],[load,identity]);
 return identity?{identity,...state}:{identity,data:null,error:'',loading:false};
}
export function workspaceViewKey(workspace:Workspace){
 return JSON.stringify([workspace.id,workspace.role,workspace.operationPolicies??[]]);
}
