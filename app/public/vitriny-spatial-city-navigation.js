import {parseSpatialReturnState} from './vitriny-spatial-session.js';

/** Resolve the newest valid return point without mixing cities or inventing state. */
export function resolveCityReturnState(worldKey,{checkpoint=null,legacy=null,now=Date.now()}={}){
  if(typeof worldKey!=='string'||!/^br:go:[a-z0-9][a-z0-9-]{0,79}$/.test(worldKey))return null;
  let latest=null;
  // Legacy comes last so a store return wins when timestamps happen to be equal.
  for(const raw of [checkpoint,legacy]){
    try{
      const state=parseSpatialReturnState(raw,{now});
      if(!state||state.worldKey!==worldKey)continue;
      if(!latest||Date.parse(state.createdAt)>=Date.parse(latest.createdAt))latest=state;
    }catch{ /* Corrupt browser storage must not prevent valid fallback navigation. */ }
  }
  return latest;
}
