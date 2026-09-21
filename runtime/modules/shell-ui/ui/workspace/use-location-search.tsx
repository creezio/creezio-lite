"use client";
import {createContext,useContext} from 'react';
import {usePathname,useSearchParams} from 'next/navigation';
/** A host can supply the location belonging to the RSC tree being rendered,
 * before that navigation is committed to window.location. */
export const WorkspaceRenderedLocationContext=createContext<{pathname:string;search:string}|null>(null);
export function useWorkspaceLocation(){
 const pathname=usePathname()||'/',search=useSearchParams()?.toString()??'';
 return useContext(WorkspaceRenderedLocationContext)??{pathname,search};
}
/** Global shell only; pane content uses usePaneSearchParams. */
export function useLocationSearch(_pathname:string):string {return useWorkspaceLocation().search;}
