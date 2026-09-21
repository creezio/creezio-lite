import type { Field } from '../core/types';
/** Same stored units for API, forms and lists; presentation never guesses from a field name. */
export function fieldInputValue(field: Field, value: unknown): string {
  if(value===null||value===undefined||value==='')return '';
  return field.type==='number'?String(Number(value)/(field.scale??1)):String(value);
}
export function parseFieldInput(field: Field, value: string): unknown {
  if(field.type!=='number')return value;
  if(value==='')return null;
  const number=Number(value)*(field.scale??1);
  return field.scale&&field.integer?Math.round(number):number;
}
export function formatFieldValue(field: Field,value: unknown): string {
  if(value===null||value===undefined||value==='')return '—';
  if(field.type==='boolean')return value?'Oui':'Non';
  if(field.type==='number'){
    const number=Number(value)/(field.scale??1);
    if(field.unit==='EUR')return number.toLocaleString('fr-FR',{style:'currency',currency:'EUR'});
    return number.toLocaleString('fr-FR')+(field.unit?' '+field.unit:'');
  }
  if(field.type==='date')return String(value).split('-').reverse().join('/');
  return String(value);
}
