import { notFound } from 'next/navigation';
import { appDefinition } from '../app-definition';
import { WorkspaceContent } from '../workspace-content';
export default async function Page({params}:{params:Promise<{moduleId:string}>}){const {moduleId}=await params;if(!appDefinition.modules.some(m=>m.id===moduleId))notFound();return <WorkspaceContent page={moduleId}/>;}
