import test from 'node:test';
import assert from 'node:assert/strict';
import { checkUpstream } from '../scripts/check-upstream.mjs';
test('All upstream packages and files are preserved with only explicit fingerprinted patches',async()=>{const r=await checkUpstream();assert.equal(r.packages,36);assert.equal(r.originalFiles,1740);assert.ok(r.identicalFiles>1700);});
