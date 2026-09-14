/**
 * Deterministic drafts from caller-supplied, complete factual statements.
 *
 * Contract: {facts: [{id, text, required?}], selection?: {factIds: [...]}, format?}.
 * `required` defaults to true. Without selection every fact is rendered in
 * registry order. Selection can only select/order IDs; it cannot supply prose.
 * Format is lines (default), paragraphs, or bullets; each fact is a single line.
 *
 * Callers must supply reviewed statements suitable for the intended audience,
 * including any qualifications needed to understand each statement. This module
 * preserves their literal text; it does not establish external truth, verify
 * sources, extract facts from prose, or make a selected subset semantically safe.
 * Render the resulting text as text, never as trusted HTML.
 */
export const FACT_GROUNDED_DRAFT_LIMITS=Object.freeze({
  maxFacts:30,
  maxIdLength:64,
  maxFactLength:500,
  maxTotalFactLength:15000
});
export const FACT_GROUNDED_DRAFT_FORMATS=Object.freeze(['lines','paragraphs','bullets']);

const FACT_ID=/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;
const CONTROL_CHARACTERS=/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

export class FactGroundedDraftError extends TypeError {
  constructor(code,path){
    super(`Rascunho factual inválido: ${code} (${path}).`);
    this.name='FactGroundedDraftError';
    this.code=code;
    this.path=path;
  }
}

function fail(code,path){throw new FactGroundedDraftError(code,path);}

function record(value,allowedKeys,requiredKeys,path){
  if(value===null||typeof value!=='object'||Array.isArray(value))fail('invalid_object',path);
  const prototype=Object.getPrototypeOf(value);
  if(prototype!==Object.prototype&&prototype!==null)fail('invalid_object',path);
  for(const key of Reflect.ownKeys(value)){
    if(typeof key!=='string'||!allowedKeys.includes(key))fail('unexpected_field',path);
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(!Object.hasOwn(descriptor,'value')||!descriptor.enumerable)fail('invalid_field',`${path}.${key}`);
  }
  for(const key of requiredKeys)if(!Object.hasOwn(value,key))fail('missing_field',`${path}.${key}`);
  return value;
}

function boundedArray(value,path){
  if(!Array.isArray(value))fail('invalid_array',path);
  if(value.length<1||value.length>FACT_GROUNDED_DRAFT_LIMITS.maxFacts)fail('invalid_count',path);
  // JSON-like arrays only: no holes, accessors, custom properties or symbols.
  const keys=Reflect.ownKeys(value);
  if(keys.length!==value.length+1)fail('invalid_array',path);
  for(let index=0;index<value.length;index++){
    const descriptor=Object.getOwnPropertyDescriptor(value,String(index));
    if(!descriptor||!Object.hasOwn(descriptor,'value')||!descriptor.enumerable)fail('invalid_array',path);
  }
  return value;
}

function factId(value,path){
  if(typeof value!=='string'||value.length>FACT_GROUNDED_DRAFT_LIMITS.maxIdLength||!FACT_ID.test(value))fail('invalid_fact_id',path);
  return value;
}

function factText(value,path){
  if(typeof value!=='string'||value.length>FACT_GROUNDED_DRAFT_LIMITS.maxFactLength||!value.trim()||CONTROL_CHARACTERS.test(value))fail('invalid_fact_text',path);
  // Deliberately no trim, rewriting, model processing or semantic inference.
  return value;
}

export function createFactGroundedDraft(input){
  record(input,['facts','selection','format'],['facts'],'input');
  const format=Object.hasOwn(input,'format')?input.format:'lines';
  if(!FACT_GROUNDED_DRAFT_FORMATS.includes(format))fail('invalid_format','format');
  const suppliedFacts=boundedArray(input.facts,'facts');
  const facts=new Map(),texts=new Set();
  let totalLength=0;
  for(let index=0;index<suppliedFacts.length;index++){
    const path=`facts[${index}]`;
    const fact=record(suppliedFacts[index],['id','text','required'],['id','text'],path);
    const id=factId(fact.id,`${path}.id`),text=factText(fact.text,`${path}.text`);
    if(Object.hasOwn(fact,'required')&&typeof fact.required!=='boolean')fail('invalid_required',`${path}.required`);
    if(facts.has(id))fail('duplicate_fact_id',`${path}.id`);
    if(texts.has(text))fail('duplicate_fact_text',`${path}.text`);
    totalLength+=text.length;
    if(totalLength>FACT_GROUNDED_DRAFT_LIMITS.maxTotalFactLength)fail('facts_too_large','facts');
    facts.set(id,{id,text,required:Object.hasOwn(fact,'required')?fact.required:true});
    texts.add(text);
  }

  let factIds;
  if(Object.hasOwn(input,'selection')){
    const selection=record(input.selection,['factIds'],['factIds'],'selection');
    const selected=boundedArray(selection.factIds,'selection.factIds');
    const seen=new Set();
    factIds=selected.map((value,index)=>{
      const path=`selection.factIds[${index}]`,id=factId(value,path);
      if(!facts.has(id))fail('unknown_fact_id',path);
      if(seen.has(id))fail('duplicate_selected_id',path);
      seen.add(id);
      return id;
    });
    for(const fact of facts.values())if(fact.required&&!seen.has(fact.id))fail('missing_required_fact','selection.factIds');
  }else factIds=[...facts.keys()];

  return Object.freeze({
    text:factIds.map(id=>(format==='bullets'?'- ':'')+facts.get(id).text).join(format==='paragraphs'?'\n\n':'\n'),
    factIds:Object.freeze(factIds),
    grounding:Object.freeze({method:'literal_facts',scope:'supplied_facts_only',externallyVerified:false}),
    draft:true
  });
}
