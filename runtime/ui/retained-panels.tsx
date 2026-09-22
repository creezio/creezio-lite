"use client";
import {useState,type ReactNode} from 'react';
import {PaneActivityBoundary} from '../modules/shell-ui/ui/workspace/keep-alive.tsx';
/** Same retained-pane policy inside a page. Mount on first visit; remove immediately when access removes a view. */
export function RetainedPanels({active,views}:{active:string;views:readonly {id:string;content:ReactNode}[]}) {
 const [visited,setVisited]=useState([active]);
 if(!visited.includes(active))setVisited([...visited,active]);
 return <>{views.filter(view=>view.id===active||visited.includes(view.id)).map(view=><PaneActivityBoundary key={view.id} active={view.id===active}><section data-retained-view={view.id} hidden={view.id!==active} inert={view.id!==active}>{view.content}</section></PaneActivityBoundary>)}</>;
}
