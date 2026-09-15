import PostalMime from 'postal-mime';
// Email Routing handler for one Lite workspace. There is no unauthenticated HTTP relay.
export default {
  async email(message,env){
    if(!env.INBOUND_URL||!env.EMAIL_INBOUND_SECRET||!env.MAIL_DOMAIN)throw Error('Configuration de réception manquante.');
    const url=new URL(env.INBOUND_URL);if(url.protocol!=='https:'||url.username||url.password)throw Error('URL de réception invalide.');
    if(message.to.split('@')[1]?.toLowerCase()!==env.MAIL_DOMAIN.toLowerCase()){message.setReject('Domaine non autorisé.');return;}
    if(message.rawSize>4*1024*1024){message.setReject('Message trop volumineux (4 Mo maximum).');return;}
    const parsed=await PostalMime.parse(await new Response(message.raw).arrayBuffer());
    const base64=content=>{const bytes=new Uint8Array(content);let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);};
    const attachments=(parsed.attachments||[]).map(a=>({filename:a.filename||'fichier',content_type:a.mimeType,content_base64:base64(a.content)}));
    const body={message_id:parsed.messageId||`<cf-${await crypto.subtle.digest('SHA-256',new TextEncoder().encode([message.from,message.to,parsed.date,parsed.subject,parsed.text].join('|'))).then(b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join(''))}>`,from:parsed.from?.name?`${parsed.from.name} <${message.from}>`:message.from,to:[message.to],received_at:parsed.date,subject:parsed.subject||'(sans objet)',text:parsed.text||'',html:parsed.html||'',inReplyTo:parsed.inReplyTo||'',references:(parsed.references||'').split(/\s+/).filter(Boolean),attachments};
    const response=await fetch(url,{method:'POST',redirect:'manual',headers:{'content-type':'application/json',Authorization:`Bearer ${env.EMAIL_INBOUND_SECRET}`},body:JSON.stringify(body)});
    if(!response.ok)throw Error(`Réception Lite refusée (HTTP ${response.status}).`);
  },
};
