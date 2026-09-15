import type { TaskCard, TaskAssignee } from '../../tasks/ui/tasks-types.ts';
import { KANBAN_COLUMNS } from '../../tasks/ui/tasks-types.ts';
import type { ApiMount } from '../../api-kernel/src/types.ts';
import { fail } from '@lite/core/validation';
import { audit, now, uid, textValue, write, type NativeContext } from './context';

/** Human kanban contract for D1. Host AI/Hermes runners are never simulated. */
export function tasksMount(c:NativeContext):ApiMount {
  const org=c.workspace.id,db=c.db;
  const columns=['id','title','body','status','position','executor_kind','assignee_user_id','parent_task_id','created_by','priority','hermes_task_id','hermes_status','recurring_schedule','source','result','last_synced_at','created_at','updated_at'];
  const select=columns.map(k=>`t.${k}`).join(',');
  async function assignees():Promise<TaskAssignee[]>{return (await db.prepare("SELECT u.id,u.name AS username,'human' AS kind FROM lite_members m JOIN lite_users u ON u.id=m.user_id WHERE m.org_id=? AND m.role!='viewer' ORDER BY u.name").bind(org).all<TaskAssignee>()).results;}
  async function get(id:string):Promise<TaskCard>{const row=await db.prepare(`SELECT ${select},u.name AS assignee_name FROM tasks t LEFT JOIN lite_users u ON u.id=t.assignee_user_id WHERE t.org_id=? AND t.id=?`).bind(org,id).first<TaskCard & {assignee_name:string|null}>();if(!row)fail(404,'task_not_found','Tâche introuvable.');const {assignee_name,...task}=row;return {...task,assignee:row.assignee_user_id?{id:row.assignee_user_id,username:assignee_name??'',kind:'human'}:null};}
  const statuses=[...KANBAN_COLUMNS.map(c=>c.key),'cancelled'];
  return {dbLayer:'brand',operations:[
    {id:'list',method:'GET',path:'/',description:'Lire le kanban'}, {id:'meta',method:'GET',path:'/meta',description:'Lister les personnes assignables'},
    {id:'create',method:'POST',path:'/',description:'Créer une tâche humaine'}, {id:'get',method:'GET',path:'/:id',description:'Lire une tâche'},
    {id:'update',method:'PATCH',path:'/:id',description:'Modifier une tâche'}, {id:'delete',method:'DELETE',path:'/:id',description:'Supprimer une tâche'},
  ],handle:async({req,subPath})=>{
    const parts=subPath.split('/').filter(Boolean),id=parts[0],method=req.method;
    if(method!=='GET')write(c);
    if(id==='meta'&&method==='GET')return {status:200,body:{ready:true,assignable_users:await assignees(),hermes_configured:false,host_bridge_ready:false,executors:['human']}};
    if(!id&&method==='GET'){
      const rows=await db.prepare(`SELECT ${select},u.name AS assignee_name FROM tasks t LEFT JOIN lite_users u ON u.id=t.assignee_user_id WHERE t.org_id=? ORDER BY t.position,t.created_at,t.id LIMIT 1000`).bind(org).all<TaskCard & {assignee_name:string|null}>();
      const grouped=Object.fromEntries(statuses.map(s=>[s,[] as TaskCard[]]));for(const row of rows.results){const {assignee_name,...task}=row;grouped[row.status]?.push({...task,assignee:row.assignee_user_id?{id:row.assignee_user_id,username:assignee_name??'',kind:'human'}:null});}
      return {status:200,body:{columns:grouped,hermes_configured:false,host_bridge_ready:false}};
    }
    if(!id&&method==='POST'){
      const b=(req.body??{}) as Record<string,unknown>,title=textValue(b.title,300),body=textValue(b.body,20000,false);
      if((b.executor_kind??'human')!=='human'||b.dispatch===true||b.launch===true||b.recurring_schedule)fail(422,'executor_unavailable','Cet exécuteur nécessite un hôte Lite.');
      const assignee=b.assignee_user_id==null||b.assignee_user_id===''?null:textValue(b.assignee_user_id,160);
      if(assignee&&!(await assignees()).some(u=>u.id===assignee))fail(400,'invalid_assignee','Personne non assignable dans cet espace.');
      const taskId=uid(),ts=now();await db.batch([
        db.prepare("INSERT INTO tasks(id,org_id,title,body,status,position,executor_kind,assignee_user_id,created_by,priority,source,created_at,updated_at) SELECT ?,?,?,?,'backlog',COALESCE(MAX(position),0)+10,'human',?,?,0,'ui',?,? FROM tasks WHERE org_id=? AND status='backlog'").bind(taskId,org,title,body,assignee,c.user.userId,ts,ts,org),audit(c,'task.create',taskId)]);
      return {status:201,body:{task:await get(taskId)}};
    }
    if(id==='sync'||parts.length>1)fail(422,'host_runner_unavailable','Cette opération nécessite un hôte Lite ; aucun run n’a été lancé.');
    if(id){const task=await get(id);
      if(method==='GET')return {status:200,body:{task,hermes:null,hermesError:null,runs:[],subtasks:[]}};
      if(method==='PATCH'){
        const b=(req.body??{}) as Record<string,unknown>;const updates:string[]=[],values:unknown[]=[];
        const add=(k:string,v:unknown)=>{updates.push(`${k}=?`);values.push(v);};
        if(b.title!==undefined)add('title',textValue(b.title,300));if(b.body!==undefined)add('body',textValue(b.body,20000,false));
        if(b.status!==undefined){if(!statuses.includes(String(b.status)))fail(400,'invalid_status','Statut invalide.');add('status',b.status);}
        if(b.position!==undefined){if(typeof b.position!=='number'||!Number.isFinite(b.position)||Math.abs(b.position)>1e9)fail(400,'invalid_position','Position invalide.');add('position',b.position);}
        if(b.priority!==undefined){if(!Number.isInteger(b.priority)||Number(b.priority)<0||Number(b.priority)>5)fail(400,'invalid_priority','Priorité invalide.');add('priority',b.priority);}
        if(b.assignee_user_id!==undefined){const assignee=b.assignee_user_id===null||b.assignee_user_id===''?null:textValue(b.assignee_user_id,160);if(assignee&&!(await assignees()).some(u=>u.id===assignee))fail(400,'invalid_assignee','Personne non assignable.');add('assignee_user_id',assignee);}
        if(Object.keys(b).some(k=>!['title','body','status','position','priority','assignee_user_id'].includes(k)))fail(400,'unsupported_patch','Champ de tâche non modifiable.');
        if(updates.length){add('updated_at',now());await db.batch([db.prepare(`UPDATE tasks SET ${updates.join(',')} WHERE org_id=? AND id=?`).bind(...values,org,id),audit(c,'task.update',id)]);}
        return {status:200,body:{task:await get(id)}};
      }
      if(method==='DELETE'){await db.batch([db.prepare('DELETE FROM tasks WHERE org_id=? AND id=?').bind(org,id),audit(c,'task.delete',id)]);return {status:200,body:{ok:true}};}
    }
    return {status:405,body:{ok:false,error:'method_not_allowed'}};
  }};
}
