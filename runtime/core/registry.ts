import type { AppDefinition, Field, Module, Role } from './types.ts';
import { roles } from './validation.ts';

export type RegisteredModule = {
  id: string; name: string; description: string; kind: 'business' | 'system';
  href: string; titleField: string; fields: Field[]; readRoles: Role[]; writeRoles: Role[];
  search: { enabled: boolean; fields: string[] };
  api: string; mcp: boolean;
};
const admin: Role[] = ['owner', 'admin'];
const writers: Role[] = ['owner', 'admin', 'member'];
const field = (key: string, label: string): Field => ({ key, label, type: 'text' });
const systems: RegisteredModule[] = [
  { id:'tasks', name:'Tâches', description:'Le travail de l’équipe', href:'/taches', titleField:'title',
    fields:[field('title','Titre'),field('body','Description'),field('status','Statut')], api:'tasks', readRoles:roles, writeRoles:writers },
  { id:'files', name:'Documents', description:'Noms et métadonnées des fichiers', href:'/documents', titleField:'name',
    fields:[field('name','Nom du fichier'),field('content_type','Type de fichier')], api:'files', readRoles:roles, writeRoles:writers },
  { id:'support', name:'Support', description:'Tickets et messages', href:'/support', titleField:'title',
    fields:[field('title','Sujet'),field('body','Message'),field('author','Auteur'),field('status','Statut')], api:'platform/platform-support', readRoles:roles, writeRoles:writers },
  { id:'members', name:'Collaborateurs', description:'Personnes de cet espace', href:'/collaborateurs', titleField:'name',
    fields:[field('name','Nom'),field('email','E-mail'),field('role','Rôle')], api:'members', readRoles:admin, writeRoles:admin },
  { id:'audit', name:'Activité', description:'Historique des modifications', href:'/admin/activity', titleField:'action',
    fields:[field('action','Action'),field('resource_id','Référence'),field('user_name','Personne')], api:'audit', readRoles:admin, writeRoles:[] },
].map(m=>({...m,kind:'system' as const,mcp:true,search:{enabled:true,fields:m.fields.map(f=>f.key)}}));

/** A business module is registered once; every surface consumes this catalogue. */
export function moduleRegistry(app: AppDefinition): RegisteredModule[] {
  return [...systems.map(m=>({...m})), ...app.modules.map((m): RegisteredModule => ({
    id:m.id, name:m.name, description:m.description, kind:'business', href:`/${m.id}`,
    titleField:m.titleField, fields:m.fields, readRoles:m.readRoles??roles, writeRoles:m.writeRoles??writers,
    search:{enabled:m.search?.enabled!==false,fields:m.search?.fields??m.fields.filter(f=>f.searchable!==false).map(f=>f.key)},
    api:`modules/${m.id}/records`, mcp:true,
  }))];
}
export function visibleModules(app: AppDefinition, role: Role) { return moduleRegistry(app).filter(m=>m.readRoles.includes(role)); }
export function businessModule(app: AppDefinition, id: string): Module | undefined { return app.modules.find(m=>m.id===id); }
export function recordHref(module: RegisteredModule, id: string, data: Record<string, unknown>): string {
  if(module.id==='support')return `${module.href}?ticket=${encodeURIComponent(String(data._ticketId??id.replace(/^ticket:/,'')))}`;
  return `${module.href}?record=${encodeURIComponent(id)}`;
}
