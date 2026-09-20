import {readdir,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {unstable_splitSqlQuery as splitSqlQuery} from 'wrangler';

function sqlTokens(sql){
 const tokens=[];
 for(let i=0;i<sql.length;){
  const char=sql[i],next=sql[i+1];
  if(/\s/.test(char)){i++;continue;}
  if(char==='-'&&next==='-'){i+=2;while(i<sql.length&&sql[i]!=='\n')i++;continue;}
  if(char==='/'&&next==='*'){i+=2;while(i<sql.length&&!(sql[i]==='*'&&sql[i+1]==='/'))i++;i=Math.min(i+2,sql.length);continue;}
  if(char==="'"||char==='"'||char==='`'){
   const quote=char;i++;
   while(i<sql.length){if(sql[i]===quote){if(sql[i+1]===quote){i+=2;continue;}i++;break;}i++;}
   continue;
  }
  if(char==='['){i++;while(i<sql.length&&sql[i]!==']')i++;i=Math.min(i+1,sql.length);continue;}
  if(/[A-Za-z_]/.test(char)){
   const start=i++;while(i<sql.length&&/[A-Za-z0-9_$]/.test(sql[i]))i++;
   tokens.push({value:sql.slice(start,i).toUpperCase(),offset:start});continue;
  }
  tokens.push({value:char,offset:i++});
 }
 return tokens;
}

function positionAt(sql,offset){
 const before=sql.slice(0,offset),line=before.split('\n').length;
 return {line,column:offset-before.lastIndexOf('\n')};
}

// Remote Cloudflare D1 rejects this valid SQLite form inside triggers. Parenthesizing
// the CASE expression (`SELECT (CASE ... END)`) keeps the hosted parser unambiguous.
export function inspectRemoteD1TriggerCases(sql){
 const tokens=sqlTokens(sql),issues=[];
 for(let i=0;i<tokens.length;i++){
  if(tokens[i].value!=='CREATE')continue;
  let cursor=i+1;
  if(tokens[cursor]?.value==='TEMP'||tokens[cursor]?.value==='TEMPORARY')cursor++;
  if(tokens[cursor]?.value!=='TRIGGER')continue;
  while(cursor<tokens.length&&tokens[cursor].value!=='BEGIN')cursor++;
  if(cursor===tokens.length)continue;
  let caseDepth=0;
  for(cursor++;cursor<tokens.length;cursor++){
   const token=tokens[cursor];
   if(token.value==='SELECT'&&tokens[cursor+1]?.value==='CASE'){
    issues.push({rule:'remote-d1-select-case',...positionAt(sql,tokens[cursor+1].offset)});
   }
   if(token.value==='CASE')caseDepth++;
   else if(token.value==='END'){
    if(caseDepth>0)caseDepth--;
    else {i=cursor;break;}
   }
  }
 }
 return issues;
}

// Diagnostic only: never rewrite migration history or claim a hosted deployment passed.
export function inspectMigration(sql, split=splitSqlQuery) {
 const statements=sql.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean);
 return statements.flatMap((statement,index)=>{
  const parts=split(statement);
  const issues=parts.length===1?[]:[{statement:index+1,fragments:parts.length}];
  return issues.concat(inspectRemoteD1TriggerCases(statement).map(issue=>({statement:index+1,...issue})));
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
  scope:'Wrangler splitter and known remote D1 trigger syntax guards only; successful Sites deployment still required'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const result=await checkMigrations(process.argv[2]);console.log(JSON.stringify(result,null,2));process.exitCode=result.ok?0:1;}
 catch(error){console.error(error.message);process.exitCode=1;}
}
