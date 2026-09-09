const criteria=new Set(['approved','grounded','original','complete','nonRepetitive','commerceBalanced','risk']);
const codes=new Set(['quality_checks_passed','source_needs_verified_evidence','source_insufficient_for_ten_pages','catalog_photo_missing','catalog_photo_quality','catalog_photo_unavailable','source_asset_unavailable','ai_copy_limits','ai_ten_pages_required','ai_page_invalid','ai_repetitive_or_thin','ai_unbacked_numbers','ai_pressure_or_promise','ai_review_held','ai_text_unavailable','ai_invalid_json','ai_image_unavailable','story_image_invalid','story_image_quality','source_destination_invalid','local_editorial_preserved','local_source_needs_editing','local_source_needs_review','local_source_image_invalid']);
const clean=value=>typeof value==='string'?value.replace(/https?:\/\/\S+|www\.\S+|[\w.+-]+@[\w.-]+|\b(?:bearer|token|api[_ -]?key|password)\s*[:=]?\s*\S+|\bsk-[\w-]+/gi,'[removido]').replace(/[<>\x00-\x1f]/g,' ').replace(/\s+/g,' ').trim().slice(0,250):'';
codes.add('ai_provider_blocked');
/** Only editorial diagnostics; never persist provider responses, prompts or drafts. */
export function storyDiagnostics(input={}) {
  if(!input||typeof input!=='object'||Array.isArray(input))return {};
  const code=input.code??input.notes,review=input.review&&typeof input.review==='object'?input.review:{};
  return {code:codes.has(code)?code:'review_details_unavailable',method:input.method==='local_editorial'?'local_editorial':'ai',qualityFailures:Array.isArray(input.qualityFailures)?[...new Set(input.qualityFailures.filter(x=>criteria.has(x)))]:[],review:{risk:['low','medium','high'].includes(review.risk)?review.risk:'unknown',notes:clean(review.notes)},repair:{attempted:input.repair?.attempted===true,kind:['structural','editorial'].includes(input.repair?.kind)?input.repair.kind:null,outcome:['held','corrected'].includes(input.repair?.outcome)?input.repair.outcome:null}};
}
