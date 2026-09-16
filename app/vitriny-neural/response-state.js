// Completion of an HTTP request is not completion of its generated answer.
export function isIncompleteResponse(output){
  return output?.incomplete===true||['length','content_filter'].includes(output?.finishReason);
}
