import test from 'node:test';
import assert from 'node:assert/strict';
import { localDb, fakeBucket, client, boot, alice } from './helpers.mjs';

test('failed R2 deletion is inaccessible and retryable without a duplicate audit',async()=>{
  const db=await localDb();const bucket=fakeBucket();const call=client(db,alice,bucket);
  try {
    await boot(call);const base='files';
    const upload=await call(base,{method:'POST',body:new Uint8Array([1,2]),headers:{'x-file-name':'test.bin'}});
    assert.equal(upload.status,201);const path=`${base}/${upload.body.id}`;
    const remove=bucket.delete;bucket.delete=async()=>{throw new Error('R2 unavailable');};
    assert.equal((await call(path,{method:'DELETE'})).status,503);
    assert.equal((await call(path)).status,404);
    assert.equal(bucket.store.size,1);
    bucket.delete=remove;
    assert.equal((await call(path,{method:'DELETE'})).status,200);
    assert.equal(bucket.store.size,0);
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM lite_audit WHERE action='file.delete'").get().n,1);
  } finally {db.close();}
});

test('a failed D1 metadata transaction rolls back and compensates the R2 upload',async()=>{
  const db=await localDb();const bucket=fakeBucket();const call=client(db,alice,bucket);
  try {
    await boot(call);
    db.raw.exec("CREATE TRIGGER deny_file_audit BEFORE INSERT ON lite_audit WHEN NEW.action='file.upload' BEGIN SELECT RAISE(ABORT,'test failure'); END");
    const result=await call('files',{method:'POST',body:new Uint8Array([1]),headers:{'x-file-name':'test.bin'}});
    assert.equal(result.status,503);
    assert.equal(bucket.store.size,0);
    assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM lite_files').get().n,0);
  } finally {db.close();}
});
