import './register-native-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
const {createApiKernel}=await import('../packages/api-kernel/src/kernel.ts');
const {createNavMount,NAV_SCHEMA_SQL}=await import('../packages/nav/src/index.ts');
const {createSupportServerMount,SUPPORT_CORE_SQL}=await import('../packages/support/src/index.ts');
const {createInteractiveDemoMount,INTERACTIVE_DEMO_SCHEMA_SQL,genericOsTourScenario}=await import('../packages/interactive-demo/src/index.ts');
test('Optional D1 persistence preserves original synchronous SQLite handlers',async()=>{
  const db=new DatabaseSync(':memory:');
  try {
    db.exec(NAV_SCHEMA_SQL+SUPPORT_CORE_SQL+INTERACTIVE_DEMO_SCHEMA_SQL);
    const nav=createNavMount({getSession:()=>({role:'owner',sub:'owner'})});
    const support=createSupportServerMount();
    const demo=createInteractiveDemoMount({defaults:[genericOsTourScenario({productName:'Creezio'})]});
    const call=(mount,path,method='GET',body,query)=>mount.handle({db,subPath:path,req:{path,method,body,query},space:'module',mountId:'test'});
    assert.equal((await call(nav,'overrides','PUT',{entryId:'os.taches',label:'Nos tâches'})).status,200);
    assert.equal((await call(nav,'catalog')).body.overrides[0].label,'Nos tâches');
    const ticket=await call(support,'','POST',{sujet:'Question SQLite',corps:'Original',auteur:'Auteur'});assert.equal(ticket.status,201);
    assert.equal((await call(support,`${ticket.body.item.id}/reply`,'POST',{corps:'Réponse',auteur:'Admin'})).status,200);
    assert.equal((await call(support,ticket.body.item.id)).body.messages.length,2);
    assert.equal((await call(support,'export')).body.tickets.length,1);
    const scenario=(await call(demo,'scenarios')).body.scenarios[0];
    assert.equal((await call(demo,`scenarios/${scenario.id}`,'PUT',{title:'Visite SQLite'})).status,200);
    assert.equal((await call(demo,`scenarios/${scenario.id}`)).body.scenario.title,'Visite SQLite');
    await call(demo,'preferences','PUT',{user:'owner',answers:{seen:true}});
    assert.equal((await call(demo,'preferences','GET',undefined,{user:'owner'})).body.answers.seen,true);
    const kernel=createApiKernel();assert.equal((await kernel.handle({path:'/api/v1/core/version',method:'GET'})).status,200);
  }finally{db.close();}
});
