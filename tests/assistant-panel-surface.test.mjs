import './register-ui-loader.mjs';
import {registerHooks} from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
const {createElement:h,useState}=await import('react');const {create,act}=await import('react-test-renderer');
// Radix is the existing tested modal primitive; verify how this composition selects its contract.
registerHooks({resolve(spec,ctx,next){if(spec==='@radix-ui/react-dialog')return {url:'data:text/javascript,'+encodeURIComponent("import React from 'react';export const Root=p=>React.createElement('dialog-root',p);export const Portal=({children})=>children;export const Content=p=>React.createElement('modal-content',p);export const Overlay=p=>React.createElement('modal-overlay',p);export const Title=p=>React.createElement('h2',p);"),shortCircuit:true};return next(spec,ctx);}});
const {AssistantPanel}=await import('../runtime/modules/assistant/ui/assistant-panel.tsx');
globalThis.IS_REACT_ACT_ENVIRONMENT=true;

test('modal/fullscreen and complementary docking share a surface contract and keep owner draft on resize',async t=>{
 let tree;const oldDocument=globalThis.document;let focused=0,closed=0;globalThis.document={querySelector:()=>({focus:()=>focused++})};
 t.after(async()=>{await act(()=>tree.unmount());globalThis.document=oldDocument;});
 function Widget({mode,chatOnly=false}){const [draft,setDraft]=useState('');return h(AssistantPanel,{presentation:mode,chatOnly,label:'Assistant exemple',onClose:()=>closed++},h('input',{value:draft,onChange:e=>setDraft(e.target.value)}));}
 await act(()=>{tree=create(h(Widget,{mode:'docked'}));});
 assert.equal(tree.root.findByType('aside').props.role,'complementary');assert.equal(tree.root.findAllByType('modal-content').length,0);assert.equal(tree.root.findAllByType('modal-overlay').length,0);
 await act(()=>tree.root.findByType('input').props.onChange({target:{value:'Brouillon conservé'}}));
 for(const mode of ['overlay','fullscreen','docked']){await act(()=>tree.update(h(Widget,{mode})));assert.equal(tree.root.findByType('input').props.value,'Brouillon conservé');const aside=tree.root.findByType('aside');assert.equal(aside.props.style.width,mode==='fullscreen'?'100%':400);assert.equal(aside.props.role,mode==='docked'?'complementary':'dialog');assert.equal(aside.props['aria-modal'],mode==='docked'?undefined:true);assert.equal(tree.root.findAllByType('modal-content').length,mode==='docked'?0:1);}
 // Docked Escape applies only inside this surface, never to a nested portalled layer.
 const key=tree.root.findByType('aside').props.onKeyDown;key({key:'Escape',defaultPrevented:false,currentTarget:{contains:()=>false},target:{},preventDefault(){}});assert.equal(closed,0);
 key({key:'Escape',defaultPrevented:true,currentTarget:{contains:()=>true},target:{},preventDefault(){}});assert.equal(closed,0);
 key({key:'Escape',defaultPrevented:false,currentTarget:{contains:()=>true},target:{},preventDefault(){}});await new Promise(r=>setTimeout(r,5));assert.equal(closed,1);assert.equal(focused,1);
 await act(()=>tree.update(h(Widget,{mode:'overlay'})));tree.root.findByType('dialog-root').props.onOpenChange(false);await new Promise(r=>setTimeout(r,5));assert.equal(closed,2);assert.equal(focused,2);
 await act(()=>tree.update(h(Widget,{mode:'overlay',chatOnly:true})));assert.equal(tree.root.findByType('aside').props.style.width,'100%');assert.equal(tree.root.findAllByType('modal-content').length,0);tree.root.findByType('dialog-root').props.onOpenChange(false);assert.equal(closed,2);
});

test('mode transition restores focused composer and selection but leaves outside focus alone',async t=>{
 const oldDocument=globalThis.document;globalThis.document={activeElement:null};const panels=[];let tree;
 const props={presentation:'docked',label:'Assistant exemple',onClose(){}};
 const render=mode=>h(AssistantPanel,{...props,presentation:mode},h('input',{'aria-label':'Composer'}));
 const nodeMock=node=>{if(node.type!=='aside')return null;const input={tagName:'INPUT',selectionStart:2,selectionEnd:4,selectionDirection:'backward',getAttribute:name=>name==='aria-label'?'Composer':null,focus(){document.activeElement=this;},setSelectionRange(start,end,direction){this.selectionStart=start;this.selectionEnd=end;this.selectionDirection=direction;}};const panel={input,contains:node=>node===input,querySelectorAll:()=>[input]};panels.push(panel);return panel;};
 t.after(async()=>{await act(()=>tree.unmount());globalThis.document=oldDocument;});
 await act(()=>{tree=create(render('docked'),{createNodeMock:nodeMock});});document.activeElement=panels.at(-1).input;
 for(const mode of ['overlay','docked']){const previous=document.activeElement;await act(()=>tree.update(render(mode)));assert.notEqual(panels.at(-1).input,previous);assert.equal(document.activeElement,panels.at(-1).input);assert.equal(document.activeElement.selectionStart,2);assert.equal(document.activeElement.selectionEnd,4);assert.equal(document.activeElement.selectionDirection,'backward');}
 const outside={tagName:'INPUT'};document.activeElement=outside;await act(()=>tree.update(render('overlay')));assert.equal(document.activeElement,outside);
});
