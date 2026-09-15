import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';

test('Email Routing parses actual MIME attachments and refuses an unconfirmed reception',async()=>{
  const mime=['From: Supplier <supplier@example.net>','To: team@example.com','Subject: =?UTF-8?B?RmFjdHVyZSDDqQ==?=','Message-ID: <fixture@example.net>','MIME-Version: 1.0','Content-Type: multipart/mixed; boundary="fixture"','','--fixture','Content-Type: text/plain; charset=utf-8','','Bonjour','--fixture','Content-Type: application/pdf','Content-Disposition: attachment; filename="facture.pdf"','Content-Transfer-Encoding: base64','','cGRmLWZpeHR1cmU=','--fixture--',''].join('\r\n');
  const env={INBOUND_URL:'https://site.example.com/api/v1/email/inbound/workspace',EMAIL_INBOUND_SECRET:'fixture-secret',MAIL_DOMAIN:'example.com'};
  let calls=0,rejected='',received;const oldFetch=globalThis.fetch;
  const message=()=>({from:'supplier@example.net',to:'team@example.com',rawSize:Buffer.byteLength(mime),raw:new Blob([mime]).stream(),setReject(value){rejected=value;}});
  try{
    globalThis.fetch=async(url,init)=>{calls++;assert.equal(String(url),env.INBOUND_URL);assert.equal(init.headers.Authorization,'Bearer fixture-secret');received=JSON.parse(init.body);return Response.json({ok:true,id:'fixture'});};
    await worker.email(message(),env);assert.equal(calls,1);assert.equal(received.message_id,'<fixture@example.net>');assert.equal(received.subject,'Facture é');assert.match(received.text,/Bonjour/);assert.equal(received.attachments[0].filename,'facture.pdf');assert.equal(atob(received.attachments[0].content_base64),'pdf-fixture');
    await worker.email({...message(),to:'team@other.example.com'},env);assert.match(rejected,/Domaine/);assert.equal(calls,1);
    globalThis.fetch=async()=>new Response('',{status:503});await assert.rejects(worker.email(message(),env),/HTTP 503/);
  }finally{globalThis.fetch=oldFetch;}
});
