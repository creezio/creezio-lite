import {readdir,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {unstable_splitSqlQuery as splitSqlQuery} from 'wrangler';

// Diagnostic only: never rewrite migration history or claim a hosted deployment passed.
export function inspectMigration(sql, split=splitSqlQuery) {
 const statements=sql.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean);
 return statements.flatMap((statement,index)=>{
  const parts=split(statement);
  return parts.length===1?[]:[{statement:index+1,fragments:parts.length}];
 });
}
export async function checkMigrations(directory=resolve('drizzle')) {
 const failures=[];
 const files=(await readdir(directory)).filter(name=>name.endsWith('.sql')).sort();
 if(!files.length)throw new Error('No SQL migrations found');
 for(const file of files){
  const issues=inspectMigration(await readFile(join(directory,file),'utf8'));
  if(issues.length)failures.push({file,issues});
 }
 return {ok:failures.length===0,files:files.length,failures,
  scope:'Local Wrangler splitter compatibility only; successful Sites deployment still required'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const result=await checkMigrations(process.argv[2]);console.log(JSON.stringify(result,null,2));process.exitCode=result.ok?0:1;}
 catch(error){console.error(error.message);process.exitCode=1;}
}
