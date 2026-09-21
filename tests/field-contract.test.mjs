import test from 'node:test';import assert from 'node:assert/strict';
import {defineApp,validateData} from '../runtime/core/validation.ts';
import {fieldSchema} from '../runtime/core/operations.ts';
import {fieldInputValue,parseFieldInput,formatFieldValue} from '../runtime/ui/field-value.ts';
const name={key:'name',label:'Nom',type:'text',required:true};
const price={key:'price',label:'Prix',type:'number',integer:true,min:0,scale:100,unit:'EUR'};
const app={id:'test',name:'Test',description:'Test',modules:[{id:'clients',name:'Clients',singular:'Client',description:'',titleField:'name',fields:[name,price]}]};
test('stored integer units share one validator and one form/list conversion',()=>{
 const mod=defineApp(app).modules[0];
 assert.equal(fieldSchema(price).type,'integer');
 assert.equal(fieldInputValue(price,1234),'12.34');
 assert.equal(parseFieldInput(price,'12.34'),1234);
 assert.match(formatFieldValue(price,1234),/12,34/);
 assert.throws(()=>validateData(mod,{name:'A',price:12.34}),/nombre/);
 assert.equal(validateData(mod,{name:'A',price:1234}).price,1234);
 assert.throws(()=>defineApp({...app,modules:[{...mod,fields:[name,{...price,scale:0}]}]}),/Échelle/);
 assert.throws(()=>defineApp({...app,modules:[{...mod,fields:[name,{...price,type:'text'}]}]}),/numérique/);
});
test('reference declarations point to a known module and declared label',()=>{
 const ref={key:'client_id',label:'Client',type:'text',reference:{moduleId:'clients',labelField:'name'}};
 const other={id:'orders',name:'Orders',singular:'Order',description:'',titleField:'name',fields:[name,ref]};
 assert.equal(defineApp({...app,modules:[...app.modules,other]}).modules.length,2);
 assert.throws(()=>defineApp({...app,modules:[{...other,fields:[name,{...ref,reference:{moduleId:'missing'}}]}]}),/référence/);
});
