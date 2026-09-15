import type { ApiContext, Workspace } from './types.ts';
import { fail } from './validation.ts';
import { workspace } from './api.ts';
import { assertOperationAllowed } from './operations.ts';
import { pollWindow, windowId, requireWindow, uiLog } from './browser-session.ts';

type Socket = {accept():void;send(data:string):void;close(code?:number,reason?:string):void;addEventListener(event:string,fn:(event:any)=>void):void};
export async function browserSocket(request:Request,c:ApiContext,org:Workspace) {
  const url=new URL(request.url);
  if(request.headers.get('origin')!==url.origin||request.headers.get('sec-fetch-site')==='cross-site')fail(403,'invalid_origin','Origine de la connexion non autorisée.');
  if(request.headers.get('upgrade')?.toLowerCase()!=='websocket')fail(426,'websocket_required','Connexion WebSocket attendue.');
  const id=windowId(url.searchParams.get('windowId'));await requireWindow(c,org,id);
  const Pair=(globalThis as unknown as {WebSocketPair?:new()=>{0:Socket;1:Socket}}).WebSocketPair;
  if(!Pair)fail(503,'websocket_unavailable','La connexion HTTP prend le relais.');
  const pair=new Pair(),socket=pair[1];socket.accept();
  let busy=false,last=0,closed=false;const started=Date.now();
  socket.addEventListener('close',()=>{closed=true;});
  socket.addEventListener('error',()=>{closed=true;});
  socket.addEventListener('message',async event=>{
    if(closed||busy)return;
    if(typeof event.data!=='string'||event.data.length>2048){socket.close(1009,'Message trop long');return;}
    if(Date.now()-last<500)return;last=Date.now();busy=true;
    try {
      if(Date.now()-started>120000){socket.close(1000,'Reconnect');return;}
      const data=JSON.parse(event.data);if(data.type!=='pulse')return;
      const live=await workspace(c.env.DB,c.identity!,org.id);
      const op=c.operations?.find(o=>o.id==='assistant.chat');if(!op)fail(403,'ui_forbidden','Assistant indisponible.');assertOperationAllowed(op,live);
      const state=await pollWindow(c,live,id,typeof data.path==='string'?data.path:undefined);
      socket.send(JSON.stringify({type:'state',...state}));
      if(!state.active)socket.close(1000,'Window replaced');
    }catch(e){socket.send(JSON.stringify({type:'error',code:'connection_refused'}));socket.close(1008,'Session unavailable');}
    finally{busy=false;}
  });
  await uiLog(c,org,'transport.connected',{windowId:id,transport:'websocket'});
  return new Response(null,{status:101,webSocket:pair[0]} as ResponseInit);
}
