const MAX_REPLY=600,MAX_JSON=8192;
const invalid=()=>Object.assign(Error('A resposta automática não contém uma mensagem final válida para o cliente.'),{code:'invalid_service_reply',status:422});
const reasoning=/\b(?:think(?:ing)?|analysis|reasoning|chain[ -]of[ -]thought|thinking\s+process|system\s+prompt|(?:the|this)\s+user|user(?:'s)?\s+(?:request|message))\b|(?:^|\n)\s*(?:análise|analise|raciocínio|raciocinio|pensamento|resposta\s+final)\s*:|\b(?:meu raciocínio|meu raciocinio|preciso responder|devo responder|vou elaborar a resposta|cadeia de pensamento)\b/iu;

/** Validate the actual outbound text too: old approval rows did not use JSON. */
export function validateServiceReply(value){
  if(typeof value!=='string')throw invalid();
  const reply=value.trim(),inspect=reply.normalize('NFKC').replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g,'');
  if(!reply||Array.from(reply).length>MAX_REPLY||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(reply)||reasoning.test(inspect)||/```|<\/?[a-z!][^>]*>|\{\s*"(?:reply|analysis|reasoning)"\s*:/iu.test(inspect))throw invalid();
  return reply;
}

/** No substring recovery, truncation, markdown preamble or extra JSON keys. */
export function parseServiceReply(raw){
  if(typeof raw!=='string'||raw.length>MAX_JSON)throw invalid();
  let source=raw.trim();
  if(source.startsWith('```')){const fence=source.match(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/iu);if(!fence)throw invalid();source=fence[1].trim();}
  // A single canonical property also rejects duplicate keys that JSON.parse
  // would otherwise silently overwrite.
  if(!/^\{\s*"reply"\s*:\s*"(?:[^"\\]|\\[\s\S])*"\s*\}$/u.test(source))throw invalid();
  let result;try{result=JSON.parse(source);}catch{throw invalid();}
  if(!result||Array.isArray(result)||Object.keys(result).length!==1||typeof result.reply!=='string')throw invalid();
  return validateServiceReply(result.reply);
}

/** Only completed assistant final-content fields are eligible. Provider
 * reasoning, summaries, tool calls and partial outputs never become messages. */
export function serviceReplyFromResponse(payload){
  if(!payload||typeof payload!=='object'||(payload.status&&payload.status!=='completed'))throw invalid();
  if(Array.isArray(payload.output)&&payload.output.length){
    const messages=payload.output.filter(item=>item?.type==='message');
    if(messages.length!==1||payload.output.some(item=>!['reasoning','message'].includes(item?.type)))throw invalid();
    const message=messages[0];if(message.role!=='assistant'||(message.status&&message.status!=='completed')||!Array.isArray(message.content)||message.content.length!==1||message.content[0]?.type!=='output_text')throw invalid();
    return parseServiceReply(message.content[0].text);
  }
  if(typeof payload.output_text==='string')return parseServiceReply(payload.output_text);
  if(Array.isArray(payload.choices)&&payload.choices.length===1){
    const choice=payload.choices[0],message=choice?.message;
    if((choice.finish_reason&&choice.finish_reason!=='stop')||message?.role!=='assistant'||message.tool_calls?.length||message.refusal)throw invalid();
    if(typeof message.content==='string')return parseServiceReply(message.content);
    if(Array.isArray(message.content)&&message.content.length===1&&message.content[0]?.type==='text')return parseServiceReply(message.content[0].text);
  }
  throw invalid();
}
