import test from 'node:test';
import assert from 'node:assert/strict';
import {runPnpm} from '../scripts/validate-examples.mjs';
function stub(results){const calls=[];return {calls,spawn:(...args)=>{calls.push(args);assert.ok(results.length,'unexpected retry');return results.shift();}};}
test('Linux: pnpm task failure is propagated without Corepack retry',()=>{
 const s=stub([{status:1}]);assert.throws(()=>runPnpm('/app',['run','typecheck'],{platform:'linux',spawn:s.spawn}),/typecheck: 1/);assert.equal(s.calls.length,1);
});
test('Linux: Corepack is used only when pnpm executable is absent',()=>{
 const s=stub([{error:Object.assign(new Error('missing'),{code:'ENOENT'})},{status:0}]);runPnpm('/app',['run','build'],{platform:'linux',spawn:s.spawn});assert.equal(s.calls.length,2);assert.equal(s.calls[1][0],'corepack');assert.deepEqual(s.calls[1][1],['pnpm','run','build']);
});
test('Linux: permission failures are not hidden by fallback',()=>{
 const s=stub([{error:Object.assign(new Error('denied'),{code:'EACCES'})}]);assert.throws(()=>runPnpm('/app',['install'],{platform:'linux',spawn:s.spawn}),/denied/);assert.equal(s.calls.length,1);
});
test('Windows: present pnpm command failure is never retried',()=>{
 const s=stub([{status:0},{status:2}]);assert.throws(()=>runPnpm('C:/app',['run','build'],{platform:'win32',spawn:s.spawn,comspec:'cmd.exe'}),/build: 2/);assert.equal(s.calls.length,2);assert.equal(s.calls[1][1].at(-1),'pnpm run build');
});
test('Windows: absent pnpm uses Corepack through cmd once',()=>{
 const s=stub([{status:1},{status:0}]);runPnpm('C:/app',['install','--frozen-lockfile'],{platform:'win32',spawn:s.spawn,comspec:'cmd.exe'});assert.equal(s.calls[1][1].at(-1),'corepack pnpm install --frozen-lockfile');assert.equal(s.calls.length,2);
});
