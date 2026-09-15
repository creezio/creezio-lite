import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {DatabaseSync} from 'node:sqlite';
import {gatewayHandler} from './server.mjs';

test('gateway authenticates, rejects private hosts, pins TLS and deduplicates SMTP delivery',async()=>{
  const db=new DatabaseSync(':memory:'),token='fixture-token-with-at-least-32-characters';let sends=0,options;
  const config={token,db,allowedHosts:['smtp.example.com'],resolveHost:async()=>[{address:'93.184.216.34'}],createTransport:value=>{options=value;return {close(){},async sendMail(message){sends++;assert.equal(message.subject,'Contrat');return {messageId:'<fixture>',accepted:message.to,rejected:[]};}};}};
  const invoke=async(handler,body,authorization=`Bearer ${token}`)=>{const req=Readable.from([Buffer.from(JSON.stringify(body))]);Object.assign(req,{method:'POST',url:'/v1/smtp/send',headers:{authorization}});let status,result;await handler(req,{writeHead(code){status=code;},end(value){result=JSON.parse(value);}});return {status,result};};
  const body={host:'smtp.example.com',port:465,user:'team@example.com',password:'private-password',security:'tls',idempotencyKey:'workspace:mail',message:{from:'team@example.com',to:['customer@example.net'],subject:'Contrat',text:'Bonjour'}};
  try{
    const handler=gatewayHandler(config);
    assert.equal((await invoke(handler,body,'Bearer invalid')).status,401);
    assert.equal((await invoke(handler,{...body,host:'other.example.com'})).status,400);
    assert.equal((await invoke(gatewayHandler({...config,resolveHost:async()=>[{address:'127.0.0.1'}]}),body)).status,400);
    const first=await invoke(handler,body);assert.equal(first.status,200);assert.equal(first.result.ok,true);
    assert.equal(options.host,'93.184.216.34');assert.equal(options.tls.servername,'smtp.example.com');assert.equal(options.requireTLS,true);assert.equal(options.tls.rejectUnauthorized,true);
    assert.equal((await invoke(gatewayHandler(config),body)).status,200);assert.equal(sends,1);
    assert.equal((await invoke(handler,{...body,message:{...body.message,text:'Changed'}})).status,409);assert.equal(sends,1);
    const stored=JSON.stringify(db.prepare('SELECT * FROM deliveries').all());assert.equal(stored.includes(body.password),false);assert.equal(stored.includes('Bonjour'),false);
  }finally{db.close();}
});
