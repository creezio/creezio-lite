import {createServer} from 'node:http';
import {lookup} from 'node:dns/promises';
import {createHash,timingSafeEqual} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {chmodSync} from 'node:fs';
import nodemailer from 'nodemailer';
import {ImapFlow} from 'imapflow';
import {simpleParser} from 'mailparser';
import ipaddr from 'ipaddr.js';
import {pathToFileURL} from 'node:url';

const digest=value=>createHash('sha256').update(value).digest();
const error=(status,message)=>Object.assign(new Error(message),{status});
const text=(value,max=500)=>{if(typeof value!=='string'||!value.trim()||value.length>max||/[\r\n\0]/.test(value))throw error(400,'Paramètre invalide.');return value.trim();};
const recipients=value=>{if(!Array.isArray(value)||value.length>50||value.some(v=>typeof v!=='string'||!/^\S+@[^\s@]+\.[^\s@]+$/.test(v)||/[\r\n]/.test(v)))throw error(400,'Destinataires invalides.');return value;};
export function gatewayHandler({token,allowedHosts,db,resolveHost=lookup,createTransport=nodemailer.createTransport}){
  if(!token||token.length<32||!allowedHosts?.length)throw Error('MAIL_GATEWAY_TOKEN (32 caractères minimum) et MAIL_ALLOWED_HOSTS sont requis.');
  db.exec('CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, state TEXT NOT NULL, response TEXT, created_at TEXT NOT NULL)');
  return async(req,res)=>{
    const reply=(status,body)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));};
    try{
      if(!timingSafeEqual(digest(req.headers.authorization||''),digest(`Bearer ${token}`)))throw error(401,'Accès refusé.');
      const route=/^\/v1\/(smtp|imap)\/(verify|send|sync)$/.exec(req.url||'');if(req.method!=='POST'||!route||route[1]==='imap'&&route[2]==='send'||route[1]==='smtp'&&route[2]==='sync')throw error(404,'Route inconnue.');
      let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>5*1024*1024)throw error(413,'Message trop volumineux.');chunks.push(chunk);}const body=JSON.parse(Buffer.concat(chunks).toString());
      const host=text(body.host,253).toLowerCase(),port=Number(body.port),user=text(body.user,250),password=body.password;
      if(!allowedHosts.includes(host)||!Number.isInteger(port)||port<1||port>65535||typeof password!=='string'||!password||password.length>8192||!['tls','starttls'].includes(body.security))throw error(400,'Connexion invalide ou serveur non autorisé.');
      const targets=await resolveHost(host,{all:true});if(!targets.length||targets.some(t=>ipaddr.process(t.address).range()!=='unicast'))throw error(400,'Le serveur doit avoir une adresse publique.');
      // Pin the validated address; TLS still verifies the configured hostname.
      const connection={host:targets[0].address,port,secure:body.security==='tls',auth:{user,pass:password},tls:{servername:host,rejectUnauthorized:true},logger:false,connectionTimeout:15000,socketTimeout:20000};
      if(route[1]==='smtp'){
        const transport=createTransport({...connection,requireTLS:true,greetingTimeout:10000,disableFileAccess:true,disableUrlAccess:true});
        try{
          if(route[2]==='verify'){await transport.verify();return reply(200,{ok:true});}
          const message=body.message||{},id=text(body.idempotencyKey,200),fingerprint=digest(JSON.stringify(message)).toString('hex');
          const from=text(message.from,300),to=recipients(message.to),cc=recipients(message.cc||[]),bcc=recipients(message.bcc||[]),subject=text(message.subject,500);
          if(!to.length||typeof message.text!=='string'&&typeof message.html!=='string')throw error(400,'Message incomplet.');
          const attachments=(message.attachments||[]).map(a=>({filename:text(a.filename,180),content:Buffer.from(text(a.content,4300000),'base64'),contentType:text(a.type||'application/octet-stream',150)}));
          if(attachments.length>20||attachments.reduce((n,a)=>n+a.content.length,0)>3*1024*1024)throw error(413,'Pièces jointes trop volumineuses.');
          const headers=Object.fromEntries(Object.entries(message.headers||{}).filter(([name])=>['Message-ID','In-Reply-To','References'].includes(name)).map(([name,value])=>[name,text(value,25000)]));
          const prior=db.prepare('SELECT * FROM deliveries WHERE id=?').get(id);if(prior){if(prior.fingerprint!==fingerprint)throw error(409,'Identifiant déjà utilisé pour un autre message.');if(prior.state==='sent')return reply(200,JSON.parse(prior.response));throw error(409,'Envoi déjà tenté. Vérifiez son résultat avant toute nouvelle demande.');}
          db.prepare("INSERT INTO deliveries(id,fingerprint,state,created_at) VALUES(?,?,'sending',?)").run(id,fingerprint,new Date().toISOString());
          try{const result=await transport.sendMail({from,to,cc,bcc,subject,text:message.text,html:message.html,headers,attachments});
            const output={ok:true,messageId:result.messageId,accepted:result.accepted,rejected:result.rejected};db.prepare("UPDATE deliveries SET state='sent',response=? WHERE id=?").run(JSON.stringify(output),id);return reply(200,output);
          }catch(e){db.prepare("UPDATE deliveries SET state='unknown' WHERE id=?").run(id);throw error(502,'Le serveur n’a pas confirmé l’envoi. Vérifiez la boîte avant de renvoyer.');}
        }finally{transport.close();}
      }
      const client=new ImapFlow({...connection,doSTARTTLS:body.security==='starttls',disableAutoIdle:true});
      try{
        await client.connect();if(route[2]==='verify')return reply(200,{ok:true});
        const lock=await client.getMailboxLock(text(body.folder||'INBOX',200));
        try{
          const validity=String(client.mailbox.uidValidity),scope=digest([host,user,body.folder||'INBOX'].join('|')).toString('hex').slice(0,16),parts=String(body.cursor||'').split(':'),since=parts[0]===scope&&parts[1]===validity?Number(parts[2])||0:0,limit=Math.min(20,Math.max(1,Number(body.limit)||20));
          let cursor=since,total=0;const messages=[],uids=[];let rawSize=0;
          for await(const msg of client.fetch(`${since+1}:*`,{uid:true,size:true},{uid:true})){
            if(msg.uid<=since)continue;if(uids.length>=limit)break;if(msg.size>4*1024*1024)throw error(413,'Un message dépasse la limite de synchronisation de 4 Mo.');
            if(rawSize+msg.size>4*1024*1024)break;rawSize+=msg.size;uids.push(msg.uid);
          }
          if(uids.length)for await(const msg of client.fetch(uids.join(','),{uid:true,source:true},{uid:true})){
            const full=msg;if(!full?.source)throw error(502,'Message IMAP indisponible.');
            const p=await simpleParser(full.source),array=v=>(Array.isArray(v)?v:[v]).flatMap(item=>(item?.value||[]).map(a=>a.address).filter(Boolean));
            const message={message_id:p.messageId||`<imap-${scope}-${validity}-${msg.uid}>`,from:p.from?.text||user,to:array(p.to).length?array(p.to):[user],cc:array(p.cc),received_at:p.date?.toISOString(),subject:p.subject||'(sans objet)',text:p.text||'',html:typeof p.html==='string'?p.html:'',inReplyTo:p.inReplyTo||'',references:Array.isArray(p.references)?p.references:p.references?[p.references]:[],attachments:(p.attachments||[]).map(a=>({filename:a.filename||'fichier',content_type:a.contentType,content_base64:a.content.toString('base64')}))};
            const bytes=Buffer.byteLength(JSON.stringify(message));if(total+bytes>4*1024*1024){if(!messages.length)throw error(413,'Le message dépasse la taille prise en charge.');break;}total+=bytes;messages.push(message);cursor=msg.uid;
          }
          return reply(200,{ok:true,messages,cursor:`${scope}:${validity}:${cursor}`});
        }finally{lock.release();}
      }finally{await client.logout().catch(()=>client.close());}
    }catch(e){reply(e.status||502,{ok:false,error:e.status?e.message:'Connexion mail refusée. Vérifiez les paramètres du serveur.'});}
  };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const file=process.env.MAIL_GATEWAY_STATE||'./mail-gateway.sqlite',db=new DatabaseSync(file);chmodSync(file,0o600);
  const handler=gatewayHandler({token:process.env.MAIL_GATEWAY_TOKEN,allowedHosts:(process.env.MAIL_ALLOWED_HOSTS||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean),db});
  createServer(handler).listen(Number(process.env.MAIL_GATEWAY_PORT||8787),'127.0.0.1',()=>console.log('Passerelle mail disponible sur la boucle locale.'));
}
