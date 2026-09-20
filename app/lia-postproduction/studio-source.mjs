/** Concrete PR #216 scene ownership bridge. It reads existing completed scenes;
 * it NEVER invokes /jobs (which would reserve quota and create another generation).
 */
import fs from 'node:fs';
import path from 'node:path';
import {hashBytes} from './media.mjs';
import {requireValue} from './providers.mjs';
export function createLiaStudioSceneResolver({db,generatedMediaRoot,reviewSpeaker=()=>false}={}) {
  requireValue(db?.prepare&&path.isAbsolute(generatedMediaRoot)&&typeof reviewSpeaker==='function','studio_source_configuration_invalid');
  const root=path.resolve(generatedMediaRoot);
  return async function resolve(scope,sourceJobId,scene){
    requireValue(/^user:[1-9]\d{0,14}$/.test(scope),'source_not_authorized');
    const userId=Number(scope.slice(5));
    const job=db.prepare('SELECT id,status FROM lia_video_jobs WHERE id=? AND user_id=?').get(sourceJobId,userId);
    requireValue(job&&job.status!=='cancelled','source_not_authorized');
    // The source asset key is explicit and independent of the scene's editing label.
    const key=scene.source==='existing_video'?scene.sourceAssetId:scene.id;
    const match=/^scene_([1-9]\d{0,2})$/.exec(key||'');requireValue(match,'source_scene_invalid');
    const stored=db.prepare("SELECT * FROM lia_video_scenes WHERE job_id=? AND scene_number=? AND status='downloaded'").get(job.id,Number(match[1]));
    requireValue(stored?.local_path,'source_not_ready');
    const file=path.resolve(stored.local_path);requireValue(path.dirname(file)===root,'source_outside_root');
    const stat=fs.lstatSync(file);requireValue(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<20_000_000,'source_file_invalid');
    const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    let data;try{const live=fs.fstatSync(fd);requireValue(live.isFile()&&live.size<20_000_000,'source_file_invalid');data=fs.readFileSync(fd);}finally{fs.closeSync(fd);}
    const sha256=hashBytes(data);
    return {scope,root,localPath:file,sha256,singleSpeakerApproved:await reviewSpeaker({scope,sourceJobId,sceneNumber:Number(match[1]),sha256})===true};
  };
}
