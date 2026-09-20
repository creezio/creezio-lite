import test from 'node:test';
import assert from 'node:assert/strict';
import {readResponseError,responseErrorMessage} from '../runtime/modules/nav/ui/response-error.ts';

test('Navigation admin turns structured API errors into renderable text',async()=>{
 assert.equal(responseErrorMessage({error:{code:'operation_forbidden',message:'Accès refusé.'}},'fallback'),'Accès refusé.');
 assert.equal(responseErrorMessage({error:{code:'operation_forbidden'}},'fallback'),'operation_forbidden');
 assert.equal(responseErrorMessage({error:['not','renderable']},'fallback'),'fallback');
 const response=Response.json({error:{code:'operation_forbidden',message:'Votre groupe n’a pas accès à cette opération.'}},{status:403});
 assert.equal(await readResponseError(response),'Votre groupe n’a pas accès à cette opération.');
});
