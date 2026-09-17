import './register-native-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {app,alice,bob,boot,client,localDb,fakeBucket} from './helpers.mjs';
const {dispatchRequest}=await import('../runtime/modules/sites-adapter/src/dispatch.ts');
const {resolveMailCredentials}=await import('../runtime/core/integrations.ts');
const {moduleRegistry}=await import('../runtime/core/registry.ts');
const secret='fixture-mail-password',gatewayToken='fixture-gateway-token-with-32-characters';
function call(db,bucket,identity,org){return async(path,{method='GET',body,raw=false,headers={}}={})=>{const url=new URL('/api/v1/'+path,'https://test.example');if(org)url.searchParams.set('workspace',org);const response=await dispatchRequest(new Request(url,{method,headers:{origin:url.origin,...(body?{'content-type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined}),{app,env:{DB:db,BUCKET:bucket,LITE_INTEGRATION_SECRET:'test-mail-vault'},identity});return raw?response:{status:response.status,body:await response.json()};};}
async function setup(){const db=await localDb(),bucket=fakeBucket(),org=await boot(client(db,alice)),other=await boot(client(db,bob));return {db,bucket,org,other,a:call(db,bucket,alice,org),b:call(db,bucket,bob,other)};}
async function integration(a,provider='cloudflare',meta={}){const defaults=provider==='cloudflare'?{accountId:'a'.repeat(32),from:'team@example.com'}:['smtp','imap'].includes(provider)?{host:`${provider}.example.com`,user:'team@example.com',port:provider==='smtp'?465:993,security:'tls',gatewayUrl:'https://gateway.example.com',from:'team@example.com'}:{from:'team@example.com'};const r=await a('platform/integrations',{method:'POST',body:{provider,secret,gatewayToken,meta:{...defaults,...meta}}});assert.equal(r.status,201,JSON.stringify(r.body));return r.body.integration;}
const outgoing=(extra={})=>({idempotencyKey:crypto.randomUUID(),to:['customer@example.com'],subject:'Proposition confidentielle',text:'Corps privé du message',...extra});

test('SMTP and IMAP store real connection settings and encrypt both passwords and gateway credentials',async()=>{
  const {db,a}=await setup();try{
    for(const provider of ['smtp','imap']){assert.equal((await a('platform/integrations',{method:'POST',body:{provider,secret}})).status,400);const connection=await integration(a,provider);assert.equal(connection.meta.user,'team@example.com');assert.equal(connection.gatewayConfigured,true);assert.equal(JSON.stringify(connection).includes(secret),false);assert.equal(JSON.stringify(connection).includes(gatewayToken),false);
      const row=db.raw.prepare('SELECT * FROM lite_integrations WHERE id=?').get(connection.id);assert.equal(row.secret_box.includes(secret),false);assert.deepEqual(await resolveMailCredentials({env:{LITE_INTEGRATION_SECRET:'test-mail-vault'}},row),{password:secret,gatewayToken});
      const update=await a(`platform/integrations/${row.id}`,{method:'PATCH',body:{version:1,secret:'changed-password',meta:{port:provider==='smtp'?587:143,security:'starttls'}}});assert.equal(update.status,200);assert.equal(update.body.integration.meta.secure,false);
      assert.equal((await resolveMailCredentials({env:{LITE_INTEGRATION_SECRET:'test-mail-vault'}},db.raw.prepare('SELECT * FROM lite_integrations WHERE id=?').get(row.id))).gatewayToken,gatewayToken);
    }
    assert.equal((await a('email/meta')).body.transport.configured,true);assert.ok(moduleRegistry(app).some(m=>m.id==='mail'));
  }finally{db.close();}
});

test('native mail drafts, attachments, concurrency, search and tenant permissions are durable',async()=>{
  const {db,bucket,a,b,org}=await setup();try{
    const draft=await a('email/drafts',{method:'POST',body:outgoing({attachments:[{filename:'devis.pdf',content_type:'application/pdf',content_base64:btoa('fixture-pdf')}]})});assert.equal(draft.status,201,JSON.stringify(draft.body));const mail=draft.body.mail;assert.equal(mail.attachments.length,1);assert.equal(bucket.store.size,1);
    assert.equal((await b(`email/${mail.id}`)).status,404);assert.equal((await b(`email/${mail.id}/attachments/${mail.attachments[0].id}`)).status,404);
    const download=await a(`email/${mail.id}/attachments/${mail.attachments[0].id}`,{raw:true});assert.equal(await download.text(),'fixture-pdf');assert.match(download.headers.get('content-disposition'),/^attachment/);
    const update=await a(`email/drafts/${mail.id}`,{method:'PUT',body:{...outgoing(),version:mail.version,text:'Révision du contrat'}});assert.equal(update.status,200,JSON.stringify(update.body));assert.equal(update.body.mail.attachments.length,1);
    assert.equal((await a(`email/drafts/${mail.id}`,{method:'PUT',body:{...outgoing(),version:1}})).status,409);
    const found=await a('search?q=Révision');assert.equal(found.status,200);assert.ok(JSON.stringify(found.body).includes(mail.id));
    db.raw.prepare('INSERT INTO lite_members(org_id,user_id,role) VALUES(?,?,?)').run(org,bob.userId,'viewer');const viewer=call(db,bucket,bob,org);assert.equal((await viewer('email/drafts',{method:'POST',body:outgoing()})).status,403);
    db.raw.prepare("UPDATE lite_members SET role='member' WHERE org_id=? AND user_id=?").run(org,bob.userId);
    const policy=await a('access/policies/role:member',{method:'PUT',body:{version:0,changes:[{operationId:'mail.draft.create',effect:'deny'}]}});assert.equal(policy.status,200);assert.equal((await viewer('email/meta')).body.canWrite,false);assert.equal((await viewer('email/drafts',{method:'POST',body:outgoing()})).status,403);
    const moved=await a(`email/${mail.id}`,{method:'PATCH',body:{version:2,folder:'trash'}});assert.equal(moved.status,200);assert.equal((await a(`email/${mail.id}?version=3`,{method:'DELETE'})).status,200);assert.equal(bucket.store.size,0);assert.equal((await a('search?q=Révision')).body.total,0);
  }finally{db.close();}
});

test('Cloudflare sends through its REST API once, reports failures honestly and keeps secrets/content out of logs',async()=>{
  const {db,a}=await setup(),oldFetch=globalThis.fetch;try{
    const connection=await integration(a);let calls=0;globalThis.fetch=async(url,init)=>{calls++;assert.equal(url,`https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/email/sending/send`);assert.equal(init.headers.Authorization,`Bearer ${secret}`);assert.equal(init.redirect,'manual');const body=JSON.parse(init.body);assert.equal(body.from,'team@example.com');assert.equal(body.text,'Corps privé du message');return Response.json({success:true,result:{delivered:[],queued:body.to,permanent_bounces:[]}});};
    const body=outgoing({integrationId:connection.id}),sent=await a('email/send',{method:'POST',body});assert.equal(sent.status,200,JSON.stringify(sent.body));assert.equal(sent.body.mail.status,'sent');assert.equal((await a('email/send',{method:'POST',body})).status,200);assert.equal(calls,1);
    const logs=JSON.stringify((await a('admin/request-logs')).body);for(const privateValue of [secret,'Corps privé du message','Proposition confidentielle'])assert.equal(logs.includes(privateValue),false);
    globalThis.fetch=async()=>new Response(secret,{status:401});const failed=await a('email/send',{method:'POST',body:outgoing()});assert.equal(failed.status,502);assert.equal(failed.body.mail.status,'failed_permanent');assert.equal(JSON.stringify(failed).includes(secret),false);
    globalThis.fetch=async()=>{throw Error(secret);};const unknown=await a('email/send',{method:'POST',body:outgoing()});assert.equal(unknown.status,502);assert.equal(unknown.body.mail.status,'delivery_unknown');assert.equal((await a(`email/${unknown.body.mail.id}/retry`,{method:'POST'})).status,409);
    globalThis.fetch=async()=>Response.json({success:true,result:{delivered:['one@example.com'],queued:[],permanent_bounces:['two@example.com']}});const partial=await a('email/send',{method:'POST',body:outgoing({to:['one@example.com','two@example.com']})});assert.equal(partial.status,502);assert.equal(partial.body.mail.status,'partial');
  }finally{globalThis.fetch=oldFetch;db.close();}
});

test('Cloudflare inbound is authenticated, domain-scoped, deduplicated, revocable and stores attachments',async()=>{
  const {db,bucket,a,org}=await setup();try{
    const connection=await integration(a),setup=await a('email/receiving',{method:'POST',body:{integrationId:connection.id}});assert.equal(setup.status,200);const token=setup.body.token,path=`email/inbound/${org}`,anonymous=call(db,bucket,null);
    const body={message_id:'<incoming@example.net>',from:'Supplier <supplier@example.net>',to:['team@example.com'],subject:'Facture du fournisseur',text:'Facture de septembre',attachments:[{filename:'facture.pdf',content_type:'application/pdf',content_base64:btoa('invoice')}]};
    assert.equal((await anonymous(path,{method:'POST',body})).status,401);
    const headers={Authorization:`Bearer ${token}`},first=await anonymous(path,{method:'POST',body,headers});assert.equal(first.status,201,JSON.stringify(first.body));assert.equal((await anonymous(path,{method:'POST',body,headers})).body.duplicate,true);assert.equal(bucket.store.size,1);
    assert.equal((await anonymous(path,{method:'POST',body:{...body,to:['someone@other.com']},headers})).status,403);
    const mail=(await a(`email/${first.body.id}`)).body;assert.equal(mail.status,'inbound');assert.equal(mail.attachments.length,1);assert.equal((await a('email')).body.unread,1);
    assert.equal((await a(`email/${mail.id}`,{method:'PATCH',body:{version:mail.version,read:true}})).status,200);
    await a('email/receiving',{method:'POST',body:{integrationId:connection.id}});assert.equal((await anonymous(path,{method:'POST',body,headers})).status,401);assert.equal(JSON.stringify((await a('admin/request-logs')).body).includes(token),false);
  }finally{db.close();}
});

test('inbound mail stays ahead of public ingress and keeps its token out of logs',async()=>{
  const {defineExtensions}=await import('../runtime/modules/sites-adapter/src/catalog.ts');
  const {db,bucket,a,org}=await setup();try{
    const connection=await integration(a),setupInbound=await a('email/receiving',{method:'POST',body:{integrationId:connection.id}});assert.equal(setupInbound.status,200);const token=setupInbound.body.token,path=`email/inbound/${org}`;
    const tenant=org;
    const extensions=defineExtensions(app,{publicIngress:{
      entries:[{id:'guest.mailprobe',method:'GET',path:'/api/v1/public/guest/:token',admission:'guest',tenantId:tenant,maxBytes:0,contentTypes:[],timeoutMs:1000,abuse:{policy:'guest-mail',requires:[]}}],
      resolveTenant:entry=>entry.tenantId,
      createRequestScope(){return {async admitGuest(){return {ok:true,admission:{kind:'guest',view:{ok:true}}};},async handle(){return {outcome:'success',status:200,body:{guest:true}};}};},
    }});
    const anonymous=(p,opts={})=>{const url=new URL('/api/v1/'+p,'https://test.example');return dispatchRequest(new Request(url,{method:opts.method??'GET',headers:{origin:url.origin,...(opts.body?{'content-type':'application/json'}:{}),...(opts.headers??{})},body:opts.body?JSON.stringify(opts.body):undefined}),{app,env:{DB:db,BUCKET:bucket,LITE_INTEGRATION_SECRET:'test-mail-vault'},identity:null},extensions);};
    const body={message_id:'<ingress-probe@example.net>',from:'Supplier <supplier@example.net>',to:['team@example.com'],subject:'Facture du fournisseur',text:'Facture de septembre'};
    assert.equal((await anonymous(path,{method:'POST',body})).status,401);
    const first=await anonymous(path,{method:'POST',body,headers:{Authorization:`Bearer ${token}`}});assert.equal(first.status,201,await first.text());
    const guest=await anonymous('public/guest/opaque',{method:'GET'});assert.equal(guest.status,200);assert.equal((await guest.json()).guest,true);
    assert.equal(JSON.stringify((await a('admin/request-logs')).body).includes(token),false);
  }finally{db.close();}
});

test('IMAP sync uses encrypted credentials and preserves cursor and messages across repeat requests',async()=>{
  const {db,a}=await setup(),oldFetch=globalThis.fetch;try{
    const connection=await integration(a,'imap');let calls=0;globalThis.fetch=async(url,init)=>{calls++;assert.equal(url,'https://gateway.example.com/v1/imap/sync');assert.equal(init.headers.Authorization,`Bearer ${gatewayToken}`);const body=JSON.parse(init.body);assert.equal(body.password,secret);assert.equal(body.user,'team@example.com');assert.equal(body.cursor,calls===1?'':'v1:1');return Response.json({ok:true,cursor:'v1:1',messages:[{message_id:'<imap-1>',from:'supplier@example.net',to:['team@example.com'],subject:'Commande IMAP',text:'Commande du jour',attachments:[{filename:'large.bin',content_type:'application/octet-stream',content_base64:Buffer.alloc(1700000,42).toString('base64')}]}]});};
    const first=await a('email/sync',{method:'POST'});assert.equal(first.status,200,JSON.stringify(first.body));assert.equal(first.body.inserted,1);assert.equal((await a('email/sync',{method:'POST'})).body.inserted,0);assert.equal((await a('email')).body.total,1);
    const state=db.raw.prepare('SELECT * FROM lite_mail_sync WHERE integration_id=?').get(connection.id);assert.equal(state.cursor,'v1:1');assert.equal(state.lock_until,null);
    assert.equal(JSON.stringify((await a('admin/request-logs')).body).includes(secret),false);
  }finally{globalThis.fetch=oldFetch;db.close();}
});
