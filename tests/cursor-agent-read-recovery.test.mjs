
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, relative, isAbsolute} from 'node:path';
import * as agents from '../.cursor/skills/lite-orchestration/scripts/cursor-agents.mjs';

const AGENT='bc-00000000-0000-4000-8000-000000000001';
const OTHER='bc-00000000-0000-4000-8000-000000000002';
const OLD='run-00000000-0000-4000-8000-000000000001';
const NEW='run-00000000-0000-4000-8000-000000000002';
const NEXT='run-00000000-0000-4000-8000-000000000003';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const run=(id=NEW,status='FINISHED',extra={})=>({id,agentId:AGENT,status,createdAt:id===OLD?'2026-01-01T00:00:00Z':'2026-01-02T00:00:00Z',...extra});
const selection={key:'grok',modelId:'grok-4.6',params:[{id:'effort',value:'high'},{id:'fast',value:'false'}]};
async function fixture(fn,overrides={}) {
  const dir=await mkdtemp(join(tmpdir(),'lite-read-recovery-'));
  try {
    const registryFile=join(dir,'registry.json');
    await writeFile(registryFile,JSON.stringify({formatVersion:1,missions:{M:{agentId:AGENT,repo:'https://github.com/example/app',ref:'main',state:'launched',runId:OLD,selection,...overrides}}}));
    await fn({registryFile,key:'FAKE_READ_RECOVERY_TEST_KEY',mission:'M',promptText:'Continue existing work',timeoutMs:10},async()=>JSON.parse(await readFile(registryFile,'utf8')));
  } finally {
    const root=resolve(tmpdir()),target=resolve(dir),part=relative(root,target);
    assert.ok(part&&!part.startsWith('..')&&!isAbsolute(part),'temporary cleanup must remain inside tmpdir');
    await rm(target,{recursive:true,force:true});
  }
}
function transport({metadata='network',items=[run(),run(OLD)],direct,post='ok',listStatus=200}={}) {
  const calls=[];
  const fetchImpl=async(url,init={})=>{
    const path=new URL(url).pathname,method=init.method??'GET';
    calls.push({path,method,body:init.body?JSON.parse(init.body):null});
    if(path==='/v1/agents/'+AGENT&&method==='GET') {
      if(metadata==='network')throw Error('fixture network error');
      if(metadata==='timeout')return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));
      return json({},metadata);
    }
    if(path==='/v1/agents/'+AGENT+'/runs'&&method==='GET')return json({items},listStatus);
    if(path.startsWith('/v1/agents/'+AGENT+'/runs/')&&method==='GET') {
      const id=path.split('/').at(-1);
      return json(direct??items?.find(x=>x.id===id)??run(id));
    }
    if(path==='/v1/agents/'+AGENT+'/runs'&&method==='POST') {
      if(post==='lost')throw Error('fixture lost reply');
      return json({run:run(NEXT,'CREATING')},201);
    }
    throw Error('Unexpected fixture route');
  };
  return {fetchImpl,calls,posts:()=>calls.filter(x=>x.method==='POST')};
}
for(const metadata of ['network','timeout',503])test('known mission recovers safely after '+metadata,async()=>{
  await fixture(async(args,load)=>{
    const t=transport({metadata,items:[run(),run(OLD)]});
    const result=await agents.followup({...args,fetchImpl:t.fetchImpl});
    assert.equal(result.status,'launched');
    assert.equal(result.priorRunId,NEW);
    assert.equal(result.agentReadSource,'run_list_verified');
    assert.equal(t.posts().length,1);
    assert.deepEqual(t.posts()[0].body,{prompt:{text:args.promptText}});
    assert.deepEqual((await load()).missions.M.selection,selection);
    assert.equal((await load()).missions.M.agentId,AGENT);
  });
});
test('fresh active run blocks continuation even when registry points to a finished run',async()=>{
  await fixture(async(args)=>{
    const t=transport({items:[run(NEW,'RUNNING'),run(OLD)]});
    const result=await agents.followup({...args,fetchImpl:t.fetchImpl});
    assert.equal(result.reason,'run_active');assert.equal(result.runId,NEW);assert.equal(t.posts().length,0);
  });
});
for(const metadata of [401,403,404,429,302])test('HTTP '+metadata+' never enters metadata fallback',async()=>{
  await fixture(async(args)=>{
    const t=transport({metadata});
    const result=await agents.followup({...args,fetchImpl:t.fetchImpl});
    assert.notEqual(result.status,'launched');assert.equal(t.calls.length,1);assert.equal(t.posts().length,0);
  });
});
const invalidLists=[
  [],null,
  [run(NEW,'FINISHED',{agentId:OTHER}),run(OLD)],
  [run(OLD),run(NEW)],
  [run(),run(),run(OLD)],
  [run('invalid'),run(OLD)],
  [run(NEW,'FINISHED',{createdAt:'invalid'}),run(OLD)],
];
for(const [i,items]of invalidLists.entries())test('invalid list '+i+' never permits POST',async()=>{
  await fixture(async(args)=>{
    const t=transport({items});
    assert.equal((await agents.followup({...args,fetchImpl:t.fetchImpl})).reason,'latest_run_unverified');
    assert.equal(t.posts().length,0);
  });
});
test('direct latest run must match both identities and a known execution state',async()=>{
  for(const direct of [run(NEW,'FINISHED',{agentId:OTHER}),run(OLD),run(NEW,'UNKNOWN')])await fixture(async(args)=>{
    const t=transport({direct});
    assert.equal((await agents.followup({...args,fetchImpl:t.fetchImpl})).reason,'latest_run_unverified');
    assert.equal(t.posts().length,0);
  });
});
test('unavailable list does not reuse a stale recorded run',async()=>{
  await fixture(async(args)=>{
    const t=transport({listStatus:503});
    assert.equal((await agents.followup({...args,fetchImpl:t.fetchImpl})).reason,'latest_run_unverified');
    assert.equal(t.posts().length,0);
  });
});
test('uncertain creation without known run cannot acquire proof from fallback',async()=>{
  await fixture(async(args,load)=>{
    const t=transport();
    const result=await agents.reconcile({...args,fetchImpl:t.fetchImpl});
    assert.equal(result.status,'uncertain');assert.equal(t.calls.length,1);
    assert.equal((await load()).missions.M.delivery.state,'unknown');
    assert.equal(t.posts().length,0);
  },{state:'uncertain',runId:undefined,delivery:{state:'unknown',reason:'timeout'}});
});
test('lost POST stays unresolved when the fallback list is unchanged',async()=>{
  await fixture(async(args,load)=>{
    const t=transport({items:[run(OLD)],post:'lost'});
    assert.equal((await agents.followup({...args,fetchImpl:t.fetchImpl})).status,'uncertain');
    assert.equal((await agents.followup({...args,fetchImpl:t.fetchImpl})).reason,'followup_unresolved');
    const rec=await agents.reconcile({...args,fetchImpl:t.fetchImpl});
    assert.equal(rec.followup.state,'uncertain');
    assert.equal(rec.followup.reason,'unchanged_run_list');
    assert.equal((await load()).missions.M.followup.state,'uncertain');
    assert.equal((await agents.followup({...args,fetchImpl:t.fetchImpl})).reason,'followup_unresolved');
    assert.equal(t.posts().length,1);
  });
});
test('new listed run settles a pending followup without issuing a POST',async()=>{
  await fixture(async(args,load)=>{
    const t=transport();
    const rec=await agents.reconcile({...args,fetchImpl:t.fetchImpl});
    assert.equal(rec.status,'reconciled');assert.equal(rec.agent.readSource,'run_list_verified');
    assert.equal(rec.followup.state,'accepted');assert.equal((await load()).missions.M.runId,NEW);
    assert.equal(t.posts().length,0);
  },{followup:{state:'uncertain',priorRunId:OLD}});
});

test('stale list cannot regress known run or settle an uncertain followup',async()=>{
  await fixture(async(args,load)=>{
    const t=transport({items:[run(OLD)]});
    await agents.reconcile({...args,fetchImpl:t.fetchImpl});
    const entry=(await load()).missions.M;
    assert.equal(entry.runId,NEW);
    assert.equal(entry.followup.state,'uncertain');
    await assert.rejects(agents.followup({...args,fetchImpl:t.fetchImpl}), /Mission en état uncertain/);
    assert.equal(t.posts().length,0);
  },{runId:NEW,followup:{state:'uncertain',priorRunId:NEW}});
});
test('missing known run is insufficient even when listed run looks newer',async()=>{
 await fixture(async(args)=>{const t=transport({items:[run(NEW)]});
 assert.equal((await agents.followup({...args,fetchImpl:t.fetchImpl})).reason,'latest_run_unverified');assert.equal(t.posts().length,0);});
});
