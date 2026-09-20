/** Optional host wiring for PR #216/#217. Importing does nothing.
 * Call only after the host has reconciled the legacy chat, credentials and budget.
 */
import {createVoiceSyncProviders,createSyncDownloader,requireValue} from './providers.mjs';
import {createLocalEditor} from './media.mjs';
import {createLiaPostProduction} from './executor.mjs';
import {mountLiaPostProductionApi} from './http.mjs';
import {createLiaStudioSceneResolver} from './studio-source.mjs';
import {createPostProductionCoinBilling} from './coin-billing.mjs';
export function setupLiaVideoPostProduction({enabled=false,app,db,root,generatedMediaRoot,coinAiWallet,
  requireUser,sameOriginOnly,accountAllowed,voiceProfiles,reviewSpeaker,tariff,
  elevenLabsKey,syncKey,allowedSyncOutputHosts=[]}={}) {
  if(enabled!==true)return {enabled:false,start(){},async close(){}};
  requireValue(typeof accountAllowed==='function'&&voiceProfiles&&typeof reviewSpeaker==='function','postproduction_host_policy_required');
  const executor=createLiaPostProduction({enabled:true,db,root,sourceRoots:[generatedMediaRoot],
    authorize:(scope,conversationId)=>{
      const userId=Number(scope.slice(5));return accountAllowed(userId)===true&&
        !!db.prepare('SELECT 1 FROM neural_chat_conversations WHERE id=? AND scope=?').get(conversationId,scope);
    },
    resolveSource:createLiaStudioSceneResolver({db,generatedMediaRoot,reviewSpeaker}),
    resolveVoice:(scope,profileId,language)=>{
      const profile=Object.hasOwn(voiceProfiles,profileId)?voiceProfiles[profileId]:null;
      requireValue(profile&&profile.licensed===true&&profile.allowedUserIds?.includes(Number(scope.slice(5)))&&profile.languages?.includes(language),'voice_not_authorized');
      return {scope,licensed:true,voiceId:profile.voiceId,model:profile.model,language};
    },
    providers:createVoiceSyncProviders({elevenLabsKey,syncKey}),editor:createLocalEditor(),
    downloadSync:createSyncDownloader({allowedHosts:allowedSyncOutputHosts}),
    billing:createPostProductionCoinBilling({wallet:coinAiWallet,tariff})
  });
  const api=mountLiaPostProductionApi({app,executor,requireUser,sameOriginOnly});
  return {enabled:true,executor,start:api.start,close:api.close};
}
