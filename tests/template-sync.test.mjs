import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,rename,cp,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {syncTemplate} from '../scripts/sync-template.mjs';
const script=new URL('../scripts/sync-template.mjs',import.meta.url).href;
async function fixture(t){
 const prefix=join(await realpath(tmpdir()),'lite-template-sync-'),root=await mkdtemp(prefix);
 t.after(async()=>{assert.ok(resolve(root).startsWith(prefix));await rm(root,{recursive:true,force:true});});
 await mkdir(join(root,'runtime'),{recursive:true});await mkdir(join(root,'template/runtime'),{recursive:true});
 await writeFile(join(root,'runtime/current.txt'),'new runtime');await writeFile(join(root,'template/runtime/old.txt'),'previous runtime');
 return root;
}
const clean=async root=>assert.deepEqual((await readdir(join(root,'template'))).filter(n=>n.startsWith('.runtime-')),[]);
const child=(root,slow=false)=>{
 const source='import {syncTemplate} from '+JSON.stringify(script)+';import {cp} from "node:fs/promises";await syncTemplate({root:'+JSON.stringify(root)+(slow?',copy:async(...args)=>{console.log("copy-started");await new Promise(r=>setTimeout(r,300));return cp(...args);}':'')+'});';
 const p=spawn(process.execPath,['--input-type=module','-e',source],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 let stderr='';p.stderr.on('data',data=>stderr+=data);const done=once(p,'exit').then(([code])=>assert.equal(code,0,stderr));
 return {p,done};
};
test('two processes serialize and leave one complete runtime without lock or staging',async t=>{
 const root=await fixture(t);await mkdir(join(root,'runtime/dist'));await writeFile(join(root,'runtime/dist/excluded'),'compiled');await mkdir(join(root,'runtime/node_modules'));await writeFile(join(root,'runtime/node_modules/excluded'),'package');
 const first=child(root,true);await once(first.p.stdout,'data');const second=child(root);await Promise.all([first.done,second.done]);
 assert.equal(await readFile(join(root,'template/runtime/current.txt'),'utf8'),'new runtime');assert.deepEqual(await readdir(join(root,'template/runtime')),['current.txt']);await clean(root);
});
test('copy failure preserves old target and cleans only its own staging',async t=>{
 const root=await fixture(t);
 await assert.rejects(syncTemplate({root,copy:async(_source,target)=>{await mkdir(target);await writeFile(join(target,'partial'),'partial');throw new Error('copy failed');}}),/copy failed/);
 assert.equal(await readFile(join(root,'template/runtime/old.txt'),'utf8'),'previous runtime');await clean(root);
});
test('installation rename failure restores previous runtime',async t=>{
 const root=await fixture(t);
 await assert.rejects(syncTemplate({root,move:async(source,target)=>{if(source.includes('.runtime-sync-'))throw new Error('install failed');return rename(source,target);}}),/install failed/);
 assert.equal(await readFile(join(root,'template/runtime/old.txt'),'utf8'),'previous runtime');await clean(root);
});
test('failed rollback retains recoverable backup and releases the owned lock',async t=>{
 const root=await fixture(t);
 await assert.rejects(syncTemplate({root,move:async(source,target)=>{if(source.includes('.runtime-sync-')||source.includes('.runtime-backup-'))throw new Error('rename failed');return rename(source,target);}}),/previous runtime retained/);
 const names=await readdir(join(root,'template'));assert.equal(names.length,1);assert.ok(names[0].startsWith('.runtime-backup-'));assert.equal(await readFile(join(root,'template',names[0],'old.txt'),'utf8'),'previous runtime');
});
test('bounded lock timeout never steals an existing lock',async t=>{
 const root=await fixture(t);await mkdir(join(root,'template/.runtime-sync.lock'));
 await assert.rejects(syncTemplate({root,lockTimeoutMs:25}),/explicit recovery/);
 assert.equal(await readFile(join(root,'template/runtime/old.txt'),'utf8'),'previous runtime');assert.ok((await readdir(join(root,'template'))).includes('.runtime-sync.lock'));
});
