/** Vinext dev/RSC can import slot.js both with and without Vite's ?v query.
 * These URLs must share the same React contexts, as its navigation contexts
 * already do via Symbol.for. Adapt the four module-local slot contexts only;
 * no routing implementation or node_modules file is copied or modified.
 */
export function stabilizeVinextSlotContexts(code:string,id:string):string|null {
 if(!id.replaceAll('\\','/').split('?')[0].endsWith('/vinext/dist/shims/slot.js'))return null;
 const names=['ElementsContext','ChildrenContext','ParallelSlotsContext','BfcacheIdentityMapContext'];
 for(const name of names){
  const key='creezio.vinext.slot.'+name;
  if(code.includes('Symbol.for("'+key+'")'))continue;
  const pattern=new RegExp('const '+name+' = ([\\w$]+)\\.createContext\\(([^;\\n]*)\\);');
  if(!pattern.test(code))throw new Error('Vinext slot context changed: '+name+'. Review the host adapter before upgrading Vinext.');
  code=code.replace(pattern,(_match,react,initial)=>'const '+name+' = (globalThis[Symbol.for("'+key+'")] ??= '+react+'.createContext('+initial+'));');
 }
 return code;
}
