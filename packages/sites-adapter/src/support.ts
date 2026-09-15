import { createSupportServerMount } from '@creezio/support';
import type { ApiMount } from '../../api-kernel/src/types.ts';
import { audit, admin, write, textValue, uid, type NativeContext } from './context';
export function supportMount(c:NativeContext):ApiMount {
  const db=c.db,org=c.workspace.id;
  const mount=createSupportServerMount({persistence:{
    async list(){return (await db.prepare(`SELECT t.id,t.created_at,t.updated_at,t.sujet,t.statut,t.auteur,
      (SELECT COUNT(*) FROM support_messages m WHERE m.ticket_id=t.id AND m.org_id=t.org_id) AS messages_count,
      (SELECT corps FROM support_messages m WHERE m.ticket_id=t.id AND m.org_id=t.org_id ORDER BY created_at DESC,id DESC LIMIT 1) AS dernier_message
      FROM support_tickets t WHERE t.org_id=? ORDER BY t.updated_at DESC,t.id DESC`).bind(org).all<Record<string,unknown>>()).results;},
    get:id=>db.prepare('SELECT id,created_at,updated_at,sujet,statut,auteur FROM support_tickets WHERE org_id=? AND id=?').bind(org,id).first<Record<string,unknown>>(),
    async messages(id){return (await db.prepare('SELECT id,ticket_id,created_at,origine,auteur,corps FROM support_messages WHERE org_id=? AND ticket_id=? ORDER BY created_at,id').bind(org,id).all<Record<string,unknown>>()).results;},
    async create(t){write(c);textValue(t.sujet,300);textValue(t.corps,20000,false);await db.batch([
      db.prepare('INSERT INTO support_tickets(id,org_id,created_at,updated_at,sujet,statut,auteur) VALUES(?,?,?,?,?,?,?)').bind(t.id,org,t.ts,t.ts,t.sujet,'ouvert',c.user.displayName),
      ...(t.corps?[db.prepare('INSERT INTO support_messages(id,org_id,ticket_id,created_at,origine,auteur,corps) VALUES(?,?,?,?,?,?,?)').bind(uid(),org,t.id,t.ts,'client',c.user.displayName,t.corps)]:[]),audit(c,'support.create',t.id)]);},
    async reply(m){write(c);if(m.origine==='admin')admin(c);textValue(m.corps,20000);await db.batch([
      db.prepare('INSERT INTO support_messages(id,org_id,ticket_id,created_at,origine,auteur,corps) VALUES(?,?,?,?,?,?,?)').bind(uid(),org,m.id,m.ts,m.origine,c.user.displayName,m.corps),
      db.prepare('UPDATE support_tickets SET statut=?,updated_at=? WHERE org_id=? AND id=?').bind(m.statut,m.ts,org,m.id),audit(c,'support.reply',m.id)]);},
    async setStatus(id,status,ts){write(c);await db.batch([db.prepare('UPDATE support_tickets SET statut=?,updated_at=? WHERE org_id=? AND id=?').bind(status,ts,org,id),audit(c,'support.status',id)]);},
  }});
  return {...mount,operations:[{id:'list',method:'GET',path:'/',description:'Lister les tickets'},{id:'create',method:'POST',path:'/',description:'Créer un ticket'},{id:'detail',method:'GET',path:'/:id',description:'Lire un ticket'},{id:'message',method:'POST',path:'/:id/messages',description:'Ajouter un message'},{id:'reply',method:'POST',path:'/:id/reply',description:'Répondre comme administrateur',permission:'platform.access.manage'},{id:'status',method:'POST',path:'/:id/statut',description:'Modifier le statut'},{id:'export',method:'GET',path:'/export',description:'Exporter les tickets',permission:'platform.access.manage'}],
    handle:ctx=>{if(ctx.subPath==='export'||ctx.subPath.endsWith('/reply'))admin(c);if(ctx.req.method!=='GET')write(c);return mount.handle(ctx);}};
}
