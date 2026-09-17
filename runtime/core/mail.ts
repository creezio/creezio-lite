import { coreOperations, operationAllowed } from './operations.ts';
import type { ApiContext, Workspace } from './types.ts';
import { ApiError, fail, boundedInteger } from './validation.ts';
import { json, readBytes, hash, inviteToken } from './http.ts';
import { integrationRows, getIntegration, resolveIntegration, resolveMailCredentials, mailProviders, mailAddress, hermesUrl, textField, type IntegrationRow } from './integrations.ts';

type MailRow={id:string;org_id:string;external_key:string;status:string;folder:string;data_json:string;read_at:string|null;version:number;created_at:string;updated_at:string};
type Part={id:string;org_id:string;mail_id:string;object_key:string;filename:string;content_type:string;size_bytes:number};
const now=()=>new Date().toISOString();
const folders=['inbox','sent','drafts','outbox','archive','trash'];
const safeError=(e:unknown)=>e instanceof ApiError?e.message:'Le service mail est indisponible. Réessayez après vérification de la connexion.';
const value=(v:unknown,name:string,max=300)=>textField(v,name,max,true);
function line(v:unknown,name:string,max=300){const text=value(v,name,max);if(/[\r\n\0]/.test(text))fail(400,'invalid_header',`Champ ${name} invalide.`);return text;}
function addresses(v:unknown){if(v===undefined||v===null)return [];const list=typeof v==='string'?v.split(','):v;if(!Array.isArray(list)||list.length>50)fail(400,'invalid_recipients','Maximum 50 destinataires.');return list.map(mailAddress);}
async function readMailJson(r:Request){if(!r.headers.get('content-type')?.startsWith('application/json'))fail(415,'json_required','Une requête JSON est attendue.');try{const body=JSON.parse(new TextDecoder().decode(await readBytes(r,5*1024*1024)));if(!body||typeof body!=='object'||Array.isArray(body))throw Error();return body as Record<string,any>;}catch(e){if(e instanceof ApiError)throw e;fail(400,'invalid_json','Requête invalide.');}}
function publicMail(r:MailRow){const d=JSON.parse(r.data_json);delete d.saveId;return {...d,id:r.id,status:r.status,folder:r.folder,read_at:r.read_at,version:r.version,received_at:r.created_at,updated_at:r.updated_at,preview:(d.text_body||'').slice(0,240),has_attachments:Number(Boolean(d.attachmentCount))};}
async function getMail(c:ApiContext,org:string,id:string){const row=await c.env.DB.prepare('SELECT * FROM lite_mail_messages WHERE org_id=? AND id=?').bind(org,id).first<MailRow>();if(!row)fail(404,'mail_missing','Message introuvable.');return row;}
const parts=async(c:ApiContext,org:string,id:string)=>(await c.env.DB.prepare('SELECT * FROM lite_mail_attachments WHERE org_id=? AND mail_id=? ORDER BY id').bind(org,id).all<Part>()).results;
async function detail(c:ApiContext,row:MailRow){return {...publicMail(row),attachments:(await parts(c,row.org_id,row.id)).map(({object_key,org_id,mail_id,...p})=>p)};}
function checkVersion(body:Record<string,any>,row:MailRow){if(body.version!==row.version)fail(409,'conflict','Ce message a changé. Actualisez avant de réessayer.');}
function editable(row:MailRow){if(row.status!=='draft')fail(409,'not_draft','Seul un brouillon peut être modifié.');}
async function activeConnections(c:ApiContext,org:string){const result:IntegrationRow[]=[];for(const row of await integrationRows(c,{id:org} as Workspace))if(row.enabled&&mailProviders.includes(row.provider)){try{await resolveIntegration(c,row);result.push(row);}catch{}}return result;}
async function readySender(c:ApiContext,row:IntegrationRow){const m=JSON.parse(row.meta_json);if(!m.from)return false;if(row.provider==='smtp')return Boolean(m.host&&m.user&&m.gatewayUrl&&(await resolveMailCredentials(c,row)).gatewayToken);return row.provider==='resend'||row.provider==='cloudflare'&&Boolean(m.accountId);}
async function sender(c:ApiContext,org:string,id?:string){const rows=await activeConnections(c,org);const selected=id?rows.find(r=>r.id===id):undefined;if(id&&!selected)fail(409,'mail_connection','La connexion mail choisie est indisponible.');if(selected&&await readySender(c,selected))return selected;for(const row of rows)if(!id&&await readySender(c,row))return row;fail(409,'mail_unconfigured','Configurez une adresse d’expédition et une connexion Cloudflare, Resend ou SMTP dans Intégrations.');}

async function remote(url:string,key:string,body?:unknown,extra:Record<string,string>={}){
  let response:Response;try{response=await fetch(url,{method:body===undefined?'GET':'POST',redirect:'manual',signal:AbortSignal.timeout(25000),headers:{Authorization:`Bearer ${key}`,...(body===undefined?{}:{'content-type':'application/json'}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});}catch{fail(502,'mail_delivery_unknown','Le service n’a pas confirmé le résultat. Vérifiez chez le fournisseur avant de renvoyer le message.');}
  if(response.status>=300&&response.status<400){await response.body?.cancel();fail(502,'mail_rejected','La connexion mail redirige la demande. Vérifiez son adresse HTTPS finale.');}
  if(!response.ok){await response.body?.cancel();if([400,401,403,404,413,422,429].includes(response.status))fail(502,'mail_rejected',response.status===429?'Le fournisseur refuse temporairement l’envoi (quota ou débit).':'Le fournisseur a refusé la demande. Vérifiez les identifiants, les destinataires, les droits et le domaine d’expédition.');fail(502,'mail_delivery_unknown','Résultat non confirmé par le fournisseur. Vérifiez avant de renvoyer.');}
  try{const data=JSON.parse(new TextDecoder().decode(await readBytes(response as unknown as Request,5*1024*1024)));if(!data||typeof data!=='object'||Array.isArray(data))throw Error();return data;}catch{fail(502,'mail_delivery_unknown','La réponse du service mail est invalide ou trop volumineuse.');}
}
export async function mailGateway(c:ApiContext,row:IntegrationRow,action:'verify'|'send'|'sync',extra:Record<string,unknown>={}){
  const m=JSON.parse(row.meta_json),secret=await resolveMailCredentials(c,row);
  if(!m.gatewayUrl||!secret.gatewayToken)fail(409,'mail_gateway_required','Configurez votre passerelle HTTPS dans cette connexion SMTP/IMAP.');
  return remote(hermesUrl(m.gatewayUrl)+`/v1/${row.provider}/${action}`,secret.gatewayToken,{host:m.host,port:m.port,user:m.user,password:secret.password,security:m.security??(m.secure===false?'starttls':'tls'),folder:m.folder??'INBOX',...extra});
}
export async function testMailConnection(c:ApiContext,row:IntegrationRow){
  if(['smtp','imap'].includes(row.provider)){const data=await mailGateway(c,row,'verify');if(data.ok!==true)fail(502,'mail_rejected','La passerelle a refusé la connexion.');return {ok:true,message:`Connexion ${row.provider.toUpperCase()} acceptée.`};}
  const m=JSON.parse(row.meta_json),key=await resolveIntegration(c,row);
  if(row.provider==='cloudflare'){const data=await remote('https://api.cloudflare.com/client/v4/user/tokens/verify',key);if(data.success!==true||data.result?.status!=='active')fail(502,'mail_rejected','Cloudflare a refusé le jeton.');return {ok:true,message:'Jeton Cloudflare actif. Les droits Email Sending et le domaine seront vérifiés lors de l’envoi.'};}
  await remote('https://api.resend.com/domains',key);return {ok:true,message:'Accès Resend accepté. Aucun e-mail de test envoyé.'};
}
async function putParts(c:ApiContext,org:string,id:string,input:unknown){
  if(input===undefined)return [] as Part[];if(!Array.isArray(input)||input.length>20)fail(400,'invalid_attachments','Maximum 20 pièces jointes.');
  if(input.length&&!c.env.BUCKET)fail(503,'storage_unavailable','Stockage des pièces jointes indisponible.');
  const existing=await parts(c,org,id);if(existing.length+input.length>20)fail(400,'invalid_attachments','Maximum 20 pièces jointes.');let total=existing.reduce((n,p)=>n+p.size_bytes,0);const pending=input.map(a=>{
    const filename=line(a?.filename,'nom du fichier',180).replace(/[\\/]/g,'_')||'fichier',type=line(a?.content_type??'application/octet-stream','type',150),encoded=value(a?.content_base64,'pièce jointe',4_300_000);
    let bytes:Uint8Array;try{bytes=Uint8Array.from(atob(encoded),x=>x.charCodeAt(0));}catch{fail(400,'invalid_attachment','Pièce jointe invalide.');}total+=bytes.length;if(total>3*1024*1024)fail(413,'attachments_limit','Les pièces jointes sont limitées à 3 Mo au total.');
    const partId=crypto.randomUUID();return {part:{id:partId,org_id:org,mail_id:id,object_key:`mail/${org}/${id}/${partId}`,filename,content_type:type,size_bytes:bytes.length},bytes};
  });
  const uploaded:Part[]=[];try{for(const item of pending){await c.env.BUCKET!.put(item.part.object_key,item.bytes);uploaded.push(item.part);}return uploaded;}catch(e){await Promise.all(uploaded.map(p=>c.env.BUCKET!.delete(p.object_key).catch(()=>{})));throw e;}
}
async function saveMail(c:ApiContext,org:string,body:Record<string,any>,previous?:MailRow,inbound=false){
  const id=previous?.id??crypto.randomUUID(),time=now(),received=inbound&&body.received_at&&Number.isFinite(Date.parse(body.received_at))?new Date(body.received_at).toISOString():time,old=previous?JSON.parse(previous.data_json):{};
  const to=addresses(body.to),cc=addresses(body.cc),bcc=addresses(body.bcc),subject=line(body.subject,'objet',500);
  const from=inbound?line(body.from,'expéditeur',300):old.from_addr??'';
  if(inbound&&!from)fail(400,'sender_required','Expéditeur requis.');
  const referenceList=body.references??[];if(!Array.isArray(referenceList)||referenceList.length>50)fail(400,'invalid_references','Références invalides.');
  const messageId=line(body.message_id,'Message-ID',500),external=inbound?`inbound:${body.integrationId??''}:${messageId}`:previous?.external_key??`compose:${textField(body.idempotencyKey??crypto.randomUUID(),'identifiant d’envoi',160)}`;
  if(inbound&&!messageId)fail(400,'message_id_required','Message-ID requis pour dédupliquer la réception.');
  const existing=await c.env.DB.prepare('SELECT * FROM lite_mail_messages WHERE org_id=? AND external_key=?').bind(org,external).first<MailRow>();if(existing&&!previous)return {row:existing,duplicate:true};
  const reply=line(body.inReplyTo,'réponse à',500);let threadId=old.thread_id??id;
  if(reply){const parent=await c.env.DB.prepare("SELECT data_json FROM lite_mail_messages WHERE org_id=? AND json_extract(data_json,'$.message_id')=? LIMIT 1").bind(org,reply).first<{data_json:string}>();if(parent)threadId=JSON.parse(parent.data_json).thread_id;}
  const data={...old,saveId:crypto.randomUUID(),from_addr:from,to_addr:to.join(', '),cc:cc.join(', '),bcc:bcc.join(', '),subject,text_body:value(body.text,'message',500_000),html_body:value(body.html,'message HTML',500_000),message_id:messageId||old.message_id||`<${id}@lite.local>`,thread_id:threadId,in_reply_to:reply||null,references:referenceList.map((v:unknown)=>line(v,'référence',500)).join(' '),reply_to:body.replyTo?mailAddress(body.replyTo):null,account_id:body.integrationId??old.account_id??null,last_error:null,attachmentCount:old.attachmentCount??0};
  const uploaded=await putParts(c,org,id,body.attachments);data.attachmentCount+=uploaded.length;
  try{
    const statements=[previous?c.env.DB.prepare("UPDATE lite_mail_messages SET data_json=?,updated_at=?,version=version+1 WHERE org_id=? AND id=? AND version=? AND status='draft'").bind(JSON.stringify(data),time,org,id,previous.version):c.env.DB.prepare('INSERT INTO lite_mail_messages(id,org_id,external_key,status,folder,data_json,version,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?) ON CONFLICT(org_id,external_key) DO NOTHING').bind(id,org,external,inbound?'inbound':'draft',inbound?'inbox':'drafts',JSON.stringify(data),received,time)];
    for(const part of uploaded)statements.push(c.env.DB.prepare(`INSERT INTO lite_mail_attachments(id,org_id,mail_id,object_key,filename,content_type,size_bytes) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM lite_mail_messages WHERE id=? AND org_id=? AND version=? AND json_extract(data_json,'$.saveId')=?)`).bind(part.id,org,id,part.object_key,part.filename,part.content_type,part.size_bytes,id,org,previous?previous.version+1:1,data.saveId));
    const result=await c.env.DB.batch(statements);if(!result[0].meta.changes){if(previous)fail(409,'conflict','Le brouillon a changé.');const row=await c.env.DB.prepare('SELECT * FROM lite_mail_messages WHERE org_id=? AND external_key=?').bind(org,external).first<MailRow>();if(!row)fail(409,'conflict','Le message a changé.');await Promise.all(uploaded.map(p=>c.env.BUCKET!.delete(p.object_key)));return {row,duplicate:true};}
    return {row:await getMail(c,org,id),duplicate:false};
  }catch(e){await Promise.all(uploaded.map(p=>c.env.BUCKET!.delete(p.object_key).catch(()=>{})));throw e;}
}
async function sendMail(c:ApiContext,org:string,row:MailRow){
  const data=JSON.parse(row.data_json);if(!data.to_addr||!data.subject.trim()||(!data.text_body&&!data.html_body))fail(400,'mail_required','Destinataire, objet et message requis.');
  const connection=await sender(c,org,data.account_id||undefined),meta=JSON.parse(connection.meta_json);data.account_id=connection.id;data.from_addr=meta.from;data.message_id=`<${row.id}@${String(meta.from).split('@')[1]}>`;
  const claim=await c.env.DB.prepare("UPDATE lite_mail_messages SET status='sending',folder='outbox',data_json=?,updated_at=?,version=version+1 WHERE org_id=? AND id=? AND version=? AND status IN ('draft','failed_permanent')").bind(JSON.stringify(data),now(),org,row.id,row.version).run();
  if(!claim.meta.changes)fail(409,'mail_busy','Ce message a déjà été envoyé ou est en cours d’envoi.');
  let status='sent',folder='sent',error:string|null=null;
  try{
    const attachments=[];for(const part of await parts(c,org,row.id)){const object=await c.env.BUCKET!.get(part.object_key);if(!object)fail(409,'attachment_missing','Une pièce jointe est indisponible.');const bytes=await readBytes(new Response(object.body as unknown as ReadableStream) as unknown as Request,3*1024*1024);let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));attachments.push({filename:part.filename,content:btoa(raw),type:part.content_type});}
    const headers:Record<string,string>={'Message-ID':data.message_id};if(data.in_reply_to)headers['In-Reply-To']=data.in_reply_to;if(data.references)headers.References=data.references;
    const payload={from:meta.fromName?{email:meta.from,name:meta.fromName}:meta.from,to:addresses(data.to_addr),...(data.cc?{cc:addresses(data.cc)}:{}),...(data.bcc?{bcc:addresses(data.bcc)}:{}),subject:data.subject,...(data.text_body?{text:data.text_body}:{}),...(data.html_body?{html:data.html_body}:{}),headers,...(attachments.length?{attachments}:{})};
    const key=await resolveIntegration(c,connection);
    if(connection.provider==='cloudflare'){
      const result=await remote(`https://api.cloudflare.com/client/v4/accounts/${meta.accountId}/email/sending/send`,key,payload);
      if(result.success!==true)fail(502,'mail_rejected','Cloudflare a refusé l’envoi. Vérifiez Email Sending et le domaine.');
      if(!result.result||!Array.isArray(result.result.delivered)||!Array.isArray(result.result.queued)||!Array.isArray(result.result.permanent_bounces))fail(502,'mail_delivery_unknown','Réponse Cloudflare non confirmée. Vérifiez avant de renvoyer.');
      data.delivery=result.result;
      const accepted=result.result.delivered.length+result.result.queued.length;
      if(result.result.permanent_bounces.length){status=accepted?'partial':'bounced';folder=accepted?'sent':'outbox';error=accepted?'Certains destinataires ont été refusés. Consultez les détails avant tout nouvel envoi.':'Les destinataires ont été refusés par le fournisseur.';}
      else if(!accepted)fail(502,'mail_delivery_unknown','Cloudflare n’a confirmé aucun destinataire. Vérifiez avant de renvoyer.');
    }else if(connection.provider==='resend'){
      const result=await remote('https://api.resend.com/emails',key,{...payload,from:meta.fromName?`${meta.fromName} <${meta.from}>`:meta.from,...(attachments.length?{attachments:attachments.map(p=>({filename:p.filename,content:p.content,content_type:p.type}))}:{})},{'Idempotency-Key':`lite-mail-${row.id}`});
      if(!result.id)fail(502,'mail_delivery_unknown','Resend n’a pas confirmé le message.');data.provider_message_id=String(result.id);
    }else{const result=await mailGateway(c,connection,'send',{idempotencyKey:`${org}:${row.id}`,message:{...payload,from:meta.fromName?`${meta.fromName} <${meta.from}>`:meta.from}});if(result.ok!==true||!Array.isArray(result.accepted)||!Array.isArray(result.rejected)||!result.accepted.length&&!result.rejected.length)fail(502,'mail_delivery_unknown','La passerelle n’a pas confirmé l’envoi.');data.provider_message_id=result.messageId??null;if(result.rejected?.length){status=result.accepted?.length?'partial':'bounced';folder=result.accepted?.length?'sent':'outbox';error='Le serveur SMTP a refusé un ou plusieurs destinataires.';data.delivery={accepted:result.accepted,rejected:result.rejected};}}
    data.sent_at=now();
  }catch(e){status=e instanceof ApiError&&['mail_rejected','attachment_missing','mail_gateway_required'].includes(e.code)?'failed_permanent':'delivery_unknown';folder='outbox';error=safeError(e);}
  data.last_error=error;
  await c.env.DB.prepare("UPDATE lite_mail_messages SET status=?,folder=?,data_json=?,updated_at=?,version=version+1 WHERE org_id=? AND id=? AND status='sending'").bind(status,folder,JSON.stringify(data),now(),org,row.id).run();
  const result=await detail(c,await getMail(c,org,row.id));return json({mail:result,...(error?{error:{code:status,message:error}}:{ok:true})},error?502:200);
}

export async function mailInboundRoute(request:Request,c:ApiContext):Promise<Response|null>{
  const match=/^\/api\/v1\/email\/inbound\/([^/]+)$/.exec(new URL(request.url).pathname);if(!match)return null;if(request.method!=='POST')fail(405,'method_not_allowed','Méthode non autorisée.');
  const org=decodeURIComponent(match[1]),token=request.headers.get('authorization')?.replace(/^Bearer /i,'')??request.headers.get('x-email-inbound-secret')??'';
  const receiver=await c.env.DB.prepare('SELECT r.integration_id FROM lite_mail_receivers r JOIN lite_integrations i ON i.id=r.integration_id AND i.org_id=r.org_id WHERE r.org_id=? AND r.token_hash=? AND i.enabled=1').bind(org,await hash(token)).first<{integration_id:string}>();if(!token||!receiver)fail(401,'invalid_inbound_token','Authentification de réception invalide.');
  const connection=await getIntegration(c,{id:org} as Workspace,receiver.integration_id),meta=JSON.parse(connection.meta_json),body=await readMailJson(request);
  const recipients=addresses(body.to),domain=String(meta.from??'').split('@')[1];if(!domain||!recipients.some(address=>address.split('@')[1].toLowerCase()===domain.toLowerCase()))fail(403,'mail_domain','Ce destinataire n’appartient pas au domaine configuré.');
  const {row,duplicate}=await saveMail(c,org,{...body,integrationId:connection.id},undefined,true);return json({ok:true,id:row.id,duplicate},duplicate?200:201);
}

export async function mailRoute(request:Request,c:ApiContext,org:Workspace):Promise<Response|null>{
  const url=new URL(request.url);if(!/^\/api\/v1\/email(?:\/|$)/.test(url.pathname))return null;
  const path=url.pathname.slice('/api/v1/email'.length).replace(/^\//,''),method=request.method,db=c.env.DB;
  if(path==='meta'){
    const connections=await activeConnections(c,org.id),senders=[];for(const row of connections)if(await readySender(c,row)){const m=JSON.parse(row.meta_json);senders.push({id:row.id,label:`${m.fromName||m.from} · ${row.provider}`,from:m.from});}
    const receiver=await db.prepare('SELECT integration_id FROM lite_mail_receivers WHERE org_id=?').bind(org.id).first<{integration_id:string}>();
    const allowed=(id:string)=>coreOperations(c.app).some(op=>op.id===id&&operationAllowed(op,org,c.access));
    return json({ready:connections.length>0,uiEnabled:true,domain:null,inboundConfigured:Boolean(receiver&&connections.some(r=>r.id===receiver.integration_id))||connections.some(r=>r.provider==='imap'),canManage:allowed('mail.receiving'),canWrite:allowed('mail.draft.create'),canSync:allowed('mail.sync'),senders,syncAvailable:connections.some(r=>r.provider==='imap'),cloudflare:connections.filter(r=>r.provider==='cloudflare').map(r=>({id:r.id,from:JSON.parse(r.meta_json).from})),transport:{configured:senders.length>0,kind:senders.length?'configured':null,source:'integrations',preset:null,error:senders.length?null:'Configurez une connexion mail et une adresse d’expédition dans Intégrations.',send:{state:senders.length?'unknown':'unconfigured'}}});
  }
  if(path==='receiving'&&method==='POST'){
    const body=await readMailJson(request),connection=await getIntegration(c,org,textField(body.integrationId,'connexion',160));if(!connection.enabled||connection.provider!=='cloudflare'||!JSON.parse(connection.meta_json).from)fail(409,'mail_unconfigured','Configurez Cloudflare Email avec une adresse de votre domaine.');
    const token=inviteToken();await db.prepare('INSERT INTO lite_mail_receivers(org_id,integration_id,token_hash,updated_at) VALUES(?,?,?,?) ON CONFLICT(org_id) DO UPDATE SET integration_id=excluded.integration_id,token_hash=excluded.token_hash,updated_at=excluded.updated_at').bind(org.id,connection.id,await hash(token),now()).run();
    return json({url:`${url.origin}/api/v1/email/inbound/${encodeURIComponent(org.id)}`,token,domain:JSON.parse(connection.meta_json).from.split('@')[1]});
  }
  if(path==='sync'&&method==='POST'){
    const rows=(await activeConnections(c,org.id)).filter(r=>r.provider==='imap');if(!rows.length)fail(409,'imap_required','Configurez une connexion IMAP active.');let inserted=0;
    for(const row of rows){await db.prepare("INSERT INTO lite_mail_sync(integration_id,org_id,cursor,version,updated_at) VALUES(?,?,'',1,?) ON CONFLICT(integration_id) DO NOTHING").bind(row.id,org.id,now()).run();
      const state=await db.prepare('SELECT * FROM lite_mail_sync WHERE integration_id=? AND org_id=?').bind(row.id,org.id).first<{cursor:string;version:number}>();const locked=await db.prepare('UPDATE lite_mail_sync SET lock_until=?,version=version+1 WHERE integration_id=? AND org_id=? AND version=? AND (lock_until IS NULL OR lock_until<?)').bind(new Date(Date.now()+60000).toISOString(),row.id,org.id,state!.version,now()).run();if(!locked.meta.changes)fail(409,'sync_busy','Une synchronisation est déjà en cours.');
      try{const result=await mailGateway(c,row,'sync',{cursor:state!.cursor,limit:20});if(result.ok!==true||!Array.isArray(result.messages)||result.messages.length>20||typeof result.cursor!=='string'||result.cursor.length>1000)fail(502,'imap_response','Réponse de synchronisation invalide.');
        for(const message of result.messages){const saved=await saveMail(c,org.id,{...message,integrationId:row.id},undefined,true);if(!saved.duplicate)inserted++;}
        await db.prepare('UPDATE lite_mail_sync SET cursor=?,updated_at=?,lock_until=NULL WHERE integration_id=? AND org_id=? AND version=?').bind(result.cursor,now(),row.id,org.id,state!.version+1).run();
      }finally{await db.prepare('UPDATE lite_mail_sync SET lock_until=NULL WHERE integration_id=? AND org_id=? AND version=?').bind(row.id,org.id,state!.version+1).run();}
    }return json({ok:true,inserted});
  }
  if(!path&&method==='GET'){
    const folder=url.searchParams.get('folder')??'inbox';if(!folders.includes(folder))fail(400,'folder_invalid','Dossier inconnu.');const conditions=['org_id=?','folder=?'],bindings:unknown[]=[org.id,folder],q=value(url.searchParams.get('q'),'recherche',120);if(q){conditions.push("instr(lower(json_extract(data_json,'$.subject') || ' ' || json_extract(data_json,'$.from_addr') || ' ' || json_extract(data_json,'$.text_body')),lower(?))>0");bindings.push(q);}if(url.searchParams.get('unread')==='1')conditions.push('read_at IS NULL');
    const where=conditions.join(' AND '),limit=boundedInteger(url.searchParams.get('limit'),80,100),offset=boundedInteger(url.searchParams.get('offset'),0,100000);
    const [rows,count,unread]=await db.batch([db.prepare(`SELECT * FROM lite_mail_messages WHERE ${where} ORDER BY created_at DESC,id LIMIT ? OFFSET ?`).bind(...bindings,limit,offset),db.prepare(`SELECT count(*) AS n FROM lite_mail_messages WHERE ${where}`).bind(...bindings),db.prepare("SELECT count(*) AS n FROM lite_mail_messages WHERE org_id=? AND folder='inbox' AND read_at IS NULL").bind(org.id)]);return json({rows:(rows.results as unknown as MailRow[]).map(publicMail),total:(count.results[0] as {n:number}).n,unread:(unread.results[0] as {n:number}).n});
  }
  if(path.startsWith('threads/')&&method==='GET'){const id=decodeURIComponent(path.slice(8));return json({rows:(await db.prepare("SELECT * FROM lite_mail_messages WHERE org_id=? AND json_extract(data_json,'$.thread_id')=? ORDER BY created_at LIMIT 100").bind(org.id,id).all<MailRow>()).results.map(publicMail)});}
  if(['send','drafts'].includes(path)&&method==='POST'){
    const body=await readMailJson(request);if(path==='send')await sender(c,org.id,body.integrationId);const saved=await saveMail(c,org.id,body);if(path==='send'){if(!saved.duplicate||saved.row.status==='draft')return sendMail(c,org.id,saved.row);if(['failed_permanent','delivery_unknown','bounced','partial'].includes(saved.row.status))return json({mail:await detail(c,saved.row),error:{code:saved.row.status,message:JSON.parse(saved.row.data_json).last_error||'Envoi non confirmé.'}},502);}return json({mail:await detail(c,saved.row),duplicate:saved.duplicate},saved.duplicate?200:201);
  }
  const match=/^(?:drafts\/)?([^/]+)(?:\/(send|retry|events|attachments)(?:\/([^/]+))?)?$/.exec(path);
  if(match){const row=await getMail(c,org.id,decodeURIComponent(match[1])),action=match[2];
    if(action==='events'&&method==='GET'){const d=JSON.parse(row.data_json);return json({events:[{id:row.id,mail_id:row.id,type:row.status,detail:d.last_error??null,provider:null,created_at:row.updated_at}]});}
    if(action==='attachments'&&method==='GET'){const part=(await parts(c,org.id,row.id)).find(p=>p.id===match[3]);if(!part)fail(404,'attachment_missing','Pièce jointe introuvable.');const object=await c.env.BUCKET?.get(part.object_key);if(!object)fail(404,'attachment_missing','Pièce jointe indisponible.');return new Response(object.body as unknown as ReadableStream,{headers:{'content-type':part.content_type,'content-disposition':`attachment; filename*=UTF-8''${encodeURIComponent(part.filename)}`,'x-content-type-options':'nosniff','cache-control':'private, no-store'}});}
    if(['send','retry'].includes(action)&&method==='POST'){if(action==='send')editable(row);return sendMail(c,org.id,row);}
    if(!action&&method==='GET')return json(await detail(c,row));
    if(!action&&method==='PUT'){editable(row);const body=await readMailJson(request);checkVersion(body,row);const saved=await saveMail(c,org.id,body,row);return json({mail:await detail(c,saved.row)});}
    if(!action&&method==='PATCH'){const body=await readMailJson(request);checkVersion(body,row);if(row.status==='sending')fail(409,'mail_busy','Envoi en cours.');if(body.folder!==undefined&&!folders.includes(body.folder))fail(400,'folder_invalid','Dossier inconnu.');if(body.folder!==undefined&&!['inbox','archive','trash'].includes(body.folder))fail(400,'folder_invalid','Les dossiers d’envoi sont gérés automatiquement.');if(body.read!==undefined&&typeof body.read!=='boolean')fail(400,'invalid_read','État lu invalide.');
      const result=await db.prepare('UPDATE lite_mail_messages SET folder=?,read_at=?,version=version+1,updated_at=? WHERE org_id=? AND id=? AND version=?').bind(body.folder??row.folder,body.read===undefined?row.read_at:body.read?now():null,now(),org.id,row.id,row.version).run();if(!result.meta.changes)fail(409,'conflict','Le message a changé.');return json(await detail(c,await getMail(c,org.id,row.id)));}
    if(!action&&method==='DELETE'){if(row.folder!=='trash'||row.status==='sending')fail(409,'trash_required','Placez le message dans la corbeille avant de le supprimer.');if(Number(url.searchParams.get('version'))!==row.version)fail(409,'conflict','Le message a changé.');const attachments=await parts(c,org.id,row.id);const result=await db.prepare('DELETE FROM lite_mail_messages WHERE org_id=? AND id=? AND version=?').bind(org.id,row.id,row.version).run();if(!result.meta.changes)fail(409,'conflict','Le message a changé.');await Promise.all(attachments.map(p=>c.env.BUCKET?.delete(p.object_key).catch(()=>{})));return json({ok:true});}
  }
  fail(404,'not_found','Route Mail introuvable.');
}
