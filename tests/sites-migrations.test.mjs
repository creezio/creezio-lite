import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {checkMigrations,inspectMigration,inspectRemoteD1TriggerCases} from '../template/scripts/check-sites-migrations.mjs';
const migrations=fileURLToPath(new URL('../template/drizzle/',import.meta.url));
test('Wrangler regression: CASE without operator spacing fragments a valid SQLite trigger',()=>{
 const sql="CREATE TRIGGER example AFTER INSERT ON items BEGIN INSERT INTO history SELECT new.id,CASE WHEN new.id > 0 THEN 1 ELSE 0 END; END;";
 const db=new DatabaseSync(':memory:');
 try {db.exec('CREATE TABLE items(id INTEGER); CREATE TABLE history(id INTEGER, flag INTEGER);');db.exec(sql);db.exec('INSERT INTO items VALUES(1)');assert.equal(db.prepare('SELECT flag FROM history').get().flag,1);} finally {db.close();}
 assert.ok(inspectMigration(sql).length>0);
 assert.deepEqual(inspectMigration(sql.replace(',CASE',', CASE')),[]);
 const multiplied=sql.replace('new.id,CASE','new.id*CASE');
 assert.ok(inspectMigration(multiplied).length>0);
 assert.deepEqual(inspectMigration(multiplied.replace('*CASE','* CASE')),[]);
});
test('canonical template migrations pass the installed Wrangler splitter',async()=>{
 const result=await checkMigrations(migrations);
 assert.equal(result.ok,true,JSON.stringify(result.failures));
 assert.ok(result.files>0);
 const searchIndex=await readFile(new URL('../template/drizzle/0003_search_index.sql',import.meta.url),'utf8');
 assert.doesNotMatch(searchIndex,/[,*]CASE\b/);
});
test('ordinary statements and semicolons in literals stay intact',()=>{
 assert.deepEqual(inspectMigration("CREATE TABLE items(id INTEGER);\n--> statement-breakpoint\nINSERT INTO items VALUES ('a;b');"),[]);
});
test('complete trigger without CASE remains one statement',()=>{
 assert.deepEqual(inspectMigration("CREATE TRIGGER example AFTER INSERT ON items BEGIN DELETE FROM history; INSERT INTO history VALUES(new.id); END;"),[]);
});
test('remote D1 guard rejects only unparenthesized SELECT CASE inside triggers',()=>{
 const unsafe=`CREATE TRIGGER allocate AFTER INSERT ON moves BEGIN
  SELECT CASE WHEN new.qty > 0 THEN 1 ELSE RAISE(ABORT, 'stock_insuffisant') END;
 END;`;
 assert.deepEqual(inspectRemoteD1TriggerCases(unsafe),[{rule:'remote-d1-select-case',line:2,column:10}]);
 assert.deepEqual(inspectRemoteD1TriggerCases(unsafe.replace('SELECT CASE','SELECT (CASE').replace(' END;\n END;',' END);\n END;')),[]);
 assert.deepEqual(inspectRemoteD1TriggerCases("SELECT CASE WHEN 1 THEN 1 END;"),[]);
});
test('remote D1 guard masks comments and literals without hiding executable trigger syntax',()=>{
 const safe=`CREATE TRIGGER notes AFTER INSERT ON items BEGIN
  SELECT 'SELECT CASE WHEN hidden', "SELECT CASE", \`SELECT CASE\`;
  /* SELECT CASE WHEN hidden */ SELECT 1; -- SELECT CASE WHEN hidden
 END;`;
 assert.deepEqual(inspectRemoteD1TriggerCases(safe),[]);
 assert.equal(inspectRemoteD1TriggerCases(safe.replace('SELECT 1','SELECT /* kept */ CASE WHEN 1 THEN 1 END')).length,1);
});
test('remote D1 guard scans past nested CASE endings into a following trigger',()=>{
 const sql=`CREATE TRIGGER first AFTER INSERT ON items BEGIN
  SELECT (CASE WHEN new.id > 0 THEN CASE WHEN new.id > 1 THEN 2 ELSE 1 END ELSE 0 END);
 END;
 CREATE TRIGGER second AFTER INSERT ON items BEGIN
  SELECT CASE WHEN new.id > 0 THEN 1 ELSE 0 END;
 END;`;
 assert.deepEqual(inspectRemoteD1TriggerCases(sql),[{rule:'remote-d1-select-case',line:5,column:10}]);
});
