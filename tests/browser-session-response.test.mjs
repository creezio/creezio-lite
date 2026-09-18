import test from 'node:test';
import assert from 'node:assert/strict';



import {readBrowserSessionResponse} from '../runtime/modules/assistant/ui/browser-session-response.ts';

const state={active:true,kind:'desktop',desktopConnected:true,workspaceId:'fixture'};
test('session: successful and competing-window states remain distinct',async()=>{
  assert.deepEqual(await readBrowserSessionResponse(Response.json(state)),state);
  const blocked={...state,active:false,kind:null};
  assert.deepEqual(await readBrowserSessionResponse(Response.json(blocked)),blocked);
});
for(const [name,response,status,message] of [
  ['plain-text 503',()=>new Response('Your worker restarted mid-request.',{status:503}),503,'Connexion momentanément indisponible.'],
  ['HTML 502',()=>new Response('<html>gateway secret</html>',{status:502,headers:{'content-type':'text/html'}}),502,'Connexion momentanément indisponible.'],
  ['malformed JSON 503',()=>new Response('{',{status:503,headers:{'content-type':'application/json'}}),503,'Connexion momentanément indisponible.'],
  ['unauthorized',()=>new Response('',{status:401}),401,'Votre session a expiré. Reconnectez-vous.'],
  ['window conflict',()=>Response.json({error:{message:'Fenêtre inactive'}},{status:409}),409,'Fenêtre inactive'],
])test(`session: ${name}`,async()=>{await assert.rejects(readBrowserSessionResponse(response()),e=>e.status===status&&e.message===message&&!(e instanceof SyntaxError));});
test('session: reject a successful but invalid state instead of inventing a conflict',async()=>{
  await assert.rejects(readBrowserSessionResponse(Response.json({ok:true})),e=>e.status===502);
});

