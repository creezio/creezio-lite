const STORAGE_KEY='lite-browser-window-id-v1';
const CHANNEL_NAME='lite-browser-window-identity-v1';
const LIVE_PREFIX='lite-browser-window-live:';
const VALID_ID=/^[a-zA-Z0-9-]{16,80}$/;

type IdentityMessage={type:'probe'|'present';windowId:string;documentId:string;targetDocumentId?:string};
type IdentityChannel={postMessage:(message:IdentityMessage)=>void;close:()=>void;onmessage:((event:MessageEvent<IdentityMessage>)=>void)|null};
type IdentityStorage=Pick<Storage,'getItem'|'setItem'>;
type LiveStorage=IdentityStorage&Pick<Storage,'removeItem'>;

export type BrowserWindowIdentity={windowId:string;close:()=>void};

export async function claimBrowserWindowIdentity(options:{storage?:IdentityStorage;liveStorage?:LiveStorage;createId?:()=>string;openChannel?:(name:string)=>IdentityChannel;probeMs?:number}={}):Promise<BrowserWindowIdentity>{
  let storage=options.storage;try{storage??=window.sessionStorage;}catch{}
  const createId=options.createId??(()=>crypto.randomUUID()),documentId=createId();
  let windowId='';
  try{const saved=storage?.getItem(STORAGE_KEY);if(saved&&VALID_ID.test(saved))windowId=saved;}catch{}
  if(!windowId)windowId=createId();
  let live:LiveStorage|undefined=options.liveStorage;
  try{live??=typeof window==='undefined'?undefined:window.localStorage;}catch{}
  const occupiedInStorage=(id:string)=>{
    try{const value=JSON.parse(live?.getItem(LIVE_PREFIX+id)??'null');return Boolean(value&&value.documentId!==documentId);}catch{return false;}
  };
  const markLive=(id:string)=>{try{live?.setItem(LIVE_PREFIX+id,JSON.stringify({documentId}));}catch{}};
  const clearLive=(id:string)=>{try{const value=JSON.parse(live?.getItem(LIVE_PREFIX+id)??'null');if(value?.documentId===documentId)live?.removeItem(LIVE_PREFIX+id);}catch{}};
  let occupied=occupiedInStorage(windowId),channel:IdentityChannel|undefined;if(!occupied)markLive(windowId);
  const openChannel=options.openChannel??(typeof BroadcastChannel==='undefined'?undefined:(name:string)=>new BroadcastChannel(name));
  try{channel=openChannel?.(CHANNEL_NAME);}catch{}
  if(channel){
    channel.onmessage=event=>{
      const message=event.data;
      if(!message||message.windowId!==windowId||message.documentId===documentId)return;
      if(message.type==='probe')channel?.postMessage({type:'present',windowId,documentId,targetDocumentId:message.documentId});
      else if(message.type==='present'&&message.targetDocumentId===documentId)occupied=true;
    };
    try{channel.postMessage({type:'probe',windowId,documentId});await new Promise(resolve=>setTimeout(resolve,options.probeMs??40));}
    catch{channel.close();channel=undefined;}
  }
  if(occupied){clearLive(windowId);windowId=createId();}
  try{storage?.setItem(STORAGE_KEY,windowId);}catch{}
  markLive(windowId);
  let closed=false;
  const close=()=>{if(closed)return;closed=true;clearLive(windowId);channel?.close();if(typeof window!=='undefined')window.removeEventListener('pagehide',close);};
  if(typeof window!=='undefined')window.addEventListener('pagehide',close);
  return{windowId,close};
}
