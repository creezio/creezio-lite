import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {checkMigrations,inspectMigration} from '../template/scripts/check-sites-migrations.mjs';
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
