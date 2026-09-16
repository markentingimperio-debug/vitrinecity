/** Old receipts keep their provider. Selecting another provider never migrates jobs. */
export function mediaJobPolicy(job, config) {
  const image = job?.format === 'image';
  const provider = String((image ? job?.image_provider : job?.video_provider) || 'openrouter');
  const enabled = image ? config.imageConfigured : config.videoEnabled;
  let code = '', reason = '';
  if (provider !== (image ? config.provider : (config.videoProvider || config.provider))) {
    code = 'ai_media_job_provider_mismatch';
    reason = 'Este projeto pertence ao provedor anterior e foi preservado. Crie um novo projeto para usar o provedor atual; nenhuma tentativa anterior será reenviada.';
  } else if (!enabled) {
    code = image ? 'ai_image_unavailable' : 'ai_video_unavailable';
    reason = image ? 'A geração de imagens precisa de uma configuração válida.' : (config.videoReason || 'A geração de vídeos está indisponível no provedor selecionado.');
  }
  return {provider,generationAvailable:!code,syncAvailable:!image&&!code,generationBlockCode:code||null,generationBlockReason:reason||null};
}

export function requireMediaJob(job, config) {
  const access = mediaJobPolicy(job, config);
  if (!access.generationAvailable) throw Object.assign(new Error(access.generationBlockReason), {code:access.generationBlockCode,status:access.generationBlockCode==='ai_media_job_provider_mismatch'?409:503});
  return access;
}
