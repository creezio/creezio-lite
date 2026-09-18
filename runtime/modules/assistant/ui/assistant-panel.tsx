"use client";
import { Component, useRef, type ReactNode, type RefObject } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ASSISTANT_PANEL_WIDTH_PX, type AssistantPresentation } from './panel-policy';

type FocusSnapshot={index:number;tag:string;identity:string;start:number|null;end:number|null;direction:'forward'|'backward'|'none'|null};
type FocusBoundaryProps={mode:string;panelRef:RefObject<HTMLElement|null>;children:ReactNode};
const inputIdentity=(node:Element)=>['id','name','type','aria-label','placeholder'].map(name=>node.getAttribute(name)??'').join('\u0000');
/** Snapshot before Radix switches modal implementation; never steal focus from outside. */
class PreserveComposerFocus extends Component<FocusBoundaryProps,{},FocusSnapshot|null> {
  getSnapshotBeforeUpdate(previous:FocusBoundaryProps):FocusSnapshot|null {
    const panel=this.props.panelRef.current,active=document.activeElement;
    if(previous.mode===this.props.mode||!panel||!active||!panel.contains(active)||!['INPUT','TEXTAREA'].includes(active.tagName))return null;
    const input=active as HTMLInputElement|HTMLTextAreaElement;
    return {index:Array.from(panel.querySelectorAll('input,textarea')).indexOf(input),tag:input.tagName,identity:inputIdentity(input),start:input.selectionStart,end:input.selectionEnd,direction:input.selectionDirection};
  }
  componentDidUpdate(_previous:FocusBoundaryProps,_state:{},snapshot:FocusSnapshot|null) {
    if(!snapshot)return;
    const input=this.props.panelRef.current?.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('input,textarea')[snapshot.index];
    if(!input||input.tagName!==snapshot.tag||inputIdentity(input)!==snapshot.identity)return;
    input.focus({preventScroll:true});
    if(snapshot.start!==null&&snapshot.end!==null)input.setSelectionRange(snapshot.start,snapshot.end,snapshot.direction??undefined);
  }
  render(){return this.props.children;}
}

/** Radix owns modal focus and nested layers. Docked content keeps ordinary tab order. */
export function AssistantPanel({presentation,chatOnly=false,label,onClose,children}: {
  presentation:AssistantPresentation; chatOnly?:boolean; label:string; onClose:()=>void; children:ReactNode;
}) {
  const modal=!chatOnly&&presentation!=='docked';
  const panelRef=useRef<HTMLElement>(null);
  const close=()=>{onClose();setTimeout(()=>document.querySelector<HTMLButtonElement>('[data-lite-assistant-fab]')?.focus(),0);};
  const surface=<aside ref={panelRef} data-lite-assistant-ui data-assistant-presentation={chatOnly?'fullscreen':presentation}
    role={modal?'dialog':'complementary'} aria-modal={modal?true:undefined} aria-label={label}
    onKeyDown={event=>{if(!modal&&!chatOnly&&event.key==='Escape'&&!event.defaultPrevented&&event.currentTarget.contains(event.target as Node)){event.preventDefault();close();}}}
    className="fixed inset-y-0 right-0 z-50 flex h-[100dvh] max-h-[100dvh] max-w-full flex-col overflow-hidden border-l border-slate-200 bg-white shadow-xl shadow-slate-900/10"
    style={{width:chatOnly||presentation==='fullscreen'?'100%':ASSISTANT_PANEL_WIDTH_PX,paddingBottom:'env(safe-area-inset-bottom, 0px)',paddingTop:'env(safe-area-inset-top, 0px)'}}>
    {modal&&<Dialog.Title className="sr-only">{label}</Dialog.Title>}
    {children}
  </aside>;
  return <PreserveComposerFocus panelRef={panelRef} mode={modal?'modal':'docked'}><Dialog.Root open modal={modal} onOpenChange={value=>{if(!value&&!chatOnly)close();}}>
    <Dialog.Portal>
      {modal&&<Dialog.Overlay asChild><button type="button" tabIndex={-1} data-lite-assistant-ui className="fixed inset-0 z-40 bg-slate-900/40" aria-label="Fermer l'assistant" onClick={close}/></Dialog.Overlay>}
      {modal?<Dialog.Content asChild aria-describedby={undefined} onOpenAutoFocus={event=>{if(panelRef.current?.contains(document.activeElement))event.preventDefault();}} onCloseAutoFocus={event=>event.preventDefault()}>{surface}</Dialog.Content>:surface}
    </Dialog.Portal>
  </Dialog.Root></PreserveComposerFocus>;
}
