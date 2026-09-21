"use client";
import {useCallback,useMemo} from 'react';
import {useRouter} from 'next/navigation';
import {OnboardingWizard} from './onboarding/onboarding-wizard';
import {Button} from '@lite/shell-ui/ui/kit';
import {State} from './module-view';
import {createClient,useLoad} from './client';
import type {BrandModuleOnboarding} from '../core/module-contract';
import './onboarding/onboarding.css';
export function OnboardingView(){
 const router=useRouter(),api=useMemo(()=>createClient(''),[]);
 const load=useCallback(async()=>{const [content,preferences]=await Promise.all([api<{content:BrandModuleOnboarding}>('modules/onboarding/content'),api<{answers:Record<string,unknown>}>('modules/onboarding/preferences')]);return {...content,...preferences};},[api]);
 const {data,error,loading}=useLoad(load,[load]);
 const save=useCallback((answers:Record<string,unknown>)=>api('modules/onboarding/preferences',{method:'PUT',body:JSON.stringify({answers})}),[api]);
 const transport=useMemo(()=>({persistStep:async(step:number)=>{await save({step});},skip:async()=>{await save({skipped:true});},complete:async()=>{await save({completed:true});}}),[save]);
 if(!data)return <State error={error} loading={loading}/>;
 if(!data.content.steps.length)return <p className="p-6">Aucun parcours n’est configuré pour cet espace.</p>;
 return <OnboardingWizard initialStep={typeof data.answers.step==='number'?data.answers.step:0} transport={transport} onExit={href=>router.push(href)} steps={data.content.steps.map((step,index)=>({...step,render:ctx=><section className="p-6 space-y-4"><h1 className="text-xl font-semibold">{step.label}</h1>{Object.entries(step.texts??{}).map(([key,text])=><p key={key}>{text}</p>)}<div className="flex gap-3">{index>0&&<Button variant="outline" onClick={ctx.back}>Précédent</Button>}<Button disabled={ctx.saving} onClick={index===data.content.steps.length-1?ctx.complete:ctx.advance}>{index===data.content.steps.length-1?'Terminer':'Continuer'}</Button></div></section>}))}/>;
}
