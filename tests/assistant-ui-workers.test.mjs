import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {root,migrationSql,alice,client,boot} from './helpers.mjs';

test('workerd: native UI relay crosses independent requests through real D1',async()=>{
  const require=createRequire(join(root,'template/package.json')),wrangler=createRequire(require.resolve('wrangler/package.json'));
  const {Miniflare}=await import(pathToFileURL(wrangler.resolve('miniflare')).href),{build}=await import(pathToFileURL(wrangler.resolve('esbuild')).href);
  const bundle=await build({absWorkingDir:root,bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',stdin:{resolveDir:root,loader:'ts',contents:`
    import {dispatchUiAction,uiActionRoute} from './runtime/core/assistant-ui.ts';
    export default {async fetch(request,env,ctx){
      const url=new URL(request.url),org={id:url.searchParams.get('workspace'),name:'Fixture',role:'owner'};
      const c={env,identity:{userId:'alice'},operations:[{id:'assistant.chat',roles:['owner']}]};
      if(url.pathname==='/start'){
        const encoder=new TextEncoder();
        return new Response(new ReadableStream({start(output){
          const emit=(event,data)=>output.enqueue(encoder.encode(JSON.stringify({event,data})+'\\n'));
          ctx.waitUntil(dispatchUiAction(c,org,'fixture-conversation','fixture-run',emit,'click',{ref:'t1-1'},request.signal)
            .then(result=>emit('result',result)).catch(e=>emit('error',{message:e.message})).finally(()=>output.close()));
        }}),{headers:{"content-type":"text/event-stream; charset=utf-8","cache-control":"no-store"}});
      }
      try{return await uiActionRoute(request,c,org);}catch(e){return Response.json({error:e.message},{status:e.status||500});}
    }};
  `}});
  const mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-05-15',d1Databases:['DB'],cf:false});
  try{
    const db=await mf.getD1Database('DB');for(const sql of (await migrationSql()).split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean))await db.prepare(sql).run();
    const org=await boot(client(db,alice)),time=new Date().toISOString();
    await db.prepare('INSERT INTO lite_assistant_conversations(id,org_id,user_id,title,mode,model,active_run,locked_until,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind('fixture-conversation',org,'alice','Test','chat','fixture','fixture-run',new Date(Date.now()+60000).toISOString(),time,time).run();
    const stream=await mf.dispatchFetch(`http://localhost/start?workspace=${org}`),reader=stream.body.getReader(),decoder=new TextDecoder();
    const first=JSON.parse(decoder.decode((await reader.read()).value));assert.equal(first.event,'ui_action');
    const endpoint=`http://localhost/api/v1/assistant/ui-actions/${first.data.actionId}`;
    assert.equal((await mf.dispatchFetch(`${endpoint}/claim?workspace=${org}`,{method:'POST'})).status,200);
    assert.equal((await mf.dispatchFetch(`${endpoint}/claim?workspace=${org}`,{method:'POST'})).status,409);
    assert.equal((await mf.dispatchFetch(`${endpoint}/result?workspace=${org}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ok:true,clicked:'Mail'})})).status,200);
    let tail='';while(true){const r=await reader.read();if(r.done)break;tail+=decoder.decode(r.value);}
    assert.deepEqual(JSON.parse(tail),{event:'result',data:{ok:true,clicked:'Mail'}});
    assert.equal(await db.prepare('SELECT count(*) n FROM lite_assistant_ui_actions').first('n'),0);
  }finally{await mf.dispose();}
});
