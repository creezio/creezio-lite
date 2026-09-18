"use client";
import { type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ASSISTANT_PANEL_WIDTH_PX, type AssistantPresentation } from './panel-policy';

/** Radix owns modal focus and nested layers. Docked content keeps ordinary tab order. */
export function AssistantPanel({presentation,chatOnly=false,label,onClose,children}: {
  presentation:AssistantPresentation; chatOnly?:boolean; label:string; onClose:()=>void; children:ReactNode;
}) {
  const modal=!chatOnly&&presentation!=='docked';
  const close=()=>{onClose();setTimeout(()=>document.querySelector<HTMLButtonElement>('[data-lite-assistant-fab]')?.focus(),0);};
  const surface=<aside data-lite-assistant-ui data-assistant-presentation={chatOnly?'fullscreen':presentation}
    role={modal?'dialog':'complementary'} aria-modal={modal?true:undefined} aria-label={label}
    onKeyDown={event=>{if(!modal&&!chatOnly&&event.key==='Escape'&&!event.defaultPrevented&&event.currentTarget.contains(event.target as Node)){event.preventDefault();close();}}}
    className="fixed inset-y-0 right-0 z-50 flex h-[100dvh] max-h-[100dvh] max-w-full flex-col overflow-hidden border-l border-slate-200 bg-white shadow-xl shadow-slate-900/10"
    style={{width:chatOnly||presentation==='fullscreen'?'100%':ASSISTANT_PANEL_WIDTH_PX,paddingBottom:'env(safe-area-inset-bottom, 0px)',paddingTop:'env(safe-area-inset-top, 0px)'}}>
    {modal&&<Dialog.Title className="sr-only">{label}</Dialog.Title>}
    {children}
  </aside>;
  return <Dialog.Root open modal={modal} onOpenChange={value=>{if(!value&&!chatOnly)close();}}>
    <Dialog.Portal>
      {modal&&<Dialog.Overlay asChild><button type="button" tabIndex={-1} data-lite-assistant-ui className="fixed inset-0 z-40 bg-slate-900/40" aria-label="Fermer l'assistant" onClick={close}/></Dialog.Overlay>}
      {modal?<Dialog.Content asChild aria-describedby={undefined} onCloseAutoFocus={event=>event.preventDefault()}>{surface}</Dialog.Content>:surface}
    </Dialog.Portal>
  </Dialog.Root>;
}
