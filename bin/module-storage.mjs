import {readFile,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {relationalEntityMigration} from '../runtime/core/entity-storage.ts';
import {storedFields} from '../runtime/core/entity-fields.ts';

/** New modules own real D1 tables. Existing SQL and snapshots are never rewritten. */
export async function scaffoldModuleStorage(app,schema,{table:tableName}={}){
 const table=tableName??'mod_'+schema.id.replaceAll('-','_'),spec={schema,storage:{kind:'relational',table}};
 const directory=join(app,'drizzle'),meta=join(directory,'meta');
 const files=await readdir(directory),sequence=Math.max(-1,...files.filter(f=>/^\d{4}_.*\.sql$/.test(f)).map(f=>Number(f.slice(0,4))))+1;
 if(sequence>9999)throw new Error('Migration sequence exhausted');
 const tag=String(sequence).padStart(4,'0')+'_mod_'+schema.id.replaceAll('-','_');
 const journal=JSON.parse(await readFile(join(meta,'_journal.json'),'utf8'));
 const snapshots=(await readdir(meta)).filter(f=>/^\d{4}_snapshot\.json$/.test(f)).sort();
 const previous=JSON.parse(await readFile(join(meta,snapshots.at(-1)),'utf8'));
 if(previous.tables[table])throw new Error('Module table already exists: '+table);
 const column=(name,type,notNull=false,extra={})=>({name,type,primaryKey:false,notNull,autoincrement:false,...extra});
 const columns={id:column('id','text',true,{primaryKey:true}),org_id:column('org_id','text',true),version:column('version','integer',true,{default:1}),created_by:column('created_by','text',true),created_at:column('created_at','text',true),updated_at:column('updated_at','text',true),deleted_at:column('deleted_at','text')};
 for(const field of storedFields(schema))columns[field.key]=column(field.key,field.type==='number'?(field.integer?'integer':'real'):field.type==='boolean'?'integer':'text',!!field.required);
 const indexName=table+'_org',checkName=table+'_version',fkName=table+'_org_id_lite_orgs_id_fk';
 const tableSnapshot={name:table,columns,indexes:{[indexName]:{name:indexName,columns:['org_id','deleted_at','updated_at'],isUnique:false}},foreignKeys:{[fkName]:{name:fkName,tableFrom:table,tableTo:'lite_orgs',columnsFrom:['org_id'],columnsTo:['id'],onDelete:'no action',onUpdate:'no action'}},compositePrimaryKeys:{},uniqueConstraints:{},checkConstraints:{[checkName]:{name:checkName,value:'"'+table+'"."version" >= 1'}}};
 const snapshot={...previous,id:randomUUID(),prevId:previous.id,tables:{...previous.tables,[table]:tableSnapshot}};
 const declaration=Object.values(columns).map(c=>' '+JSON.stringify(c.name)+':'+({text:'d1Text',integer:'d1Integer',real:'d1Real'}[c.type])+'('+JSON.stringify(c.name)+')'+(c.primaryKey?'.primaryKey()':'')+(c.notNull?'.notNull()':'')+(c.default!==undefined?'.default('+c.default+')':'')+(c.name==='org_id'?'.references(()=>liteOrganizations.id)':'')).join(',\n');
 const source=`// Module-owned relational schema; change it through a new additive migration.\nimport {sqliteTable,text as d1Text,integer as d1Integer,real as d1Real,index as d1Index,check as d1Check} from 'drizzle-orm/sqlite-core';\nimport {sql as d1Sql} from 'drizzle-orm';\nimport {organizations as liteOrganizations} from '../../../db/schema';\nexport const ${table}=sqliteTable('${table}',{\n${declaration}\n},t=>[d1Index('${indexName}').on(t.org_id,t.deleted_at,t.updated_at),d1Check('${checkName}',d1Sql\`\${t.version} >= 1\`)]);\n`;
 const statements=relationalEntityMigration(spec).map(sql=>sql.replace('CHECK(version>=1)',`CONSTRAINT "${checkName}" CHECK(version>=1)`));
 await writeFile(join(app,'app/modules',schema.id,'db-schema.ts'),source);
 await writeFile(join(directory,tag+'.sql'),statements.map(sql=>sql+';').join('\n--> statement-breakpoint\n')+'\n');
 await writeFile(join(meta,String(sequence).padStart(4,'0')+'_snapshot.json'),JSON.stringify(snapshot,null,2)+'\n');
 journal.entries.push({idx:sequence,version:'6',when:Math.max(Date.now(),...journal.entries.map(e=>e.when+1)),tag,breakpoints:true});
 await writeFile(join(meta,'_journal.json'),JSON.stringify(journal,null,2)+'\n');
 return {table,migration:{id:'mod_'+schema.id.replaceAll('-','_')+'_initial',file:'drizzle/'+tag+'.sql',tables:[table]}};
}
