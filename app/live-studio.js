import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const LIVE_PLATFORMS = ['instagram', 'youtube', 'tiktok'];
export function validateLiveServer(server, platform = 'instagram') {
  if (!LIVE_PLATFORMS.includes(platform)) throw Error('Selecione uma rede válida.');
  if (!server) return;
  let url;
  try { url = new URL(server); } catch { throw Error('Servidor de transmissão inválido.'); }
  const domains = {instagram: ['instagram.com','facebook.com','fbcdn.net'], youtube: ['youtube.com'], tiktok: ['tiktok.com','tiktokv.com']}[platform];
  const official = domains.some(domain => url.hostname === domain || url.hostname.endsWith('.' + domain));
  const protocol = url.protocol === 'rtmps:' || (platform === 'tiktok' && url.protocol === 'rtmp:');
  const port = url.protocol === 'rtmp:' ? '1935' : '443';
  if (!official || !protocol || url.username || url.password || url.hash || (url.port && url.port !== port) || /[\s\x00]/.test(server)) throw Error('Use o servidor oficial da rede selecionada: RTMPS/443 (TikTok também aceita RTMP/1935).');
}

function profilesOf(config) {
  const profiles = {...(config.profiles || {})};
  const platform = config.platform || 'instagram';
  if (!profiles[platform]) profiles[platform] = {server: config.server || '', key: config.key || ''};
  return profiles;
}

export function selectedPlatforms(config) {
  const targets = config.targets ?? [config.platform || 'instagram'];
  if (!Array.isArray(targets) || targets.length < 1 || targets.length > 3 || new Set(targets).size !== targets.length || targets.some(p=>!LIVE_PLATFORMS.includes(p))) throw Error('Selecione de uma a três redes distintas.');
  return targets;
}

export function validateLiveConfig(input) {
  const title = String(input.title || '').trim();
  const media = String(input.media || '');
  const destination = new URL(input.destination || 'https://vitrinecity.com');
  if (!title || title.length > 120) throw Error('Informe um título de até 120 caracteres.');
  if (destination.protocol !== 'https:' || destination.hostname !== 'vitrinecity.com' || destination.username || destination.password) throw Error('Use uma página HTTPS da VitrineCity.');
  if (!/^[a-zA-Z0-9_-]+\.mp4$/.test(media)) throw Error('Selecione um vídeo da biblioteca.');
  if (![0, 1, 2, 3, '0', '1', '2', '3'].includes(input.repetitions)) throw Error('Selecione o modo de repetição.');
  const repetitions = Number(input.repetitions);
  if (![0, 1, 2, 3].includes(repetitions)) throw Error('Use repetição contínua ou de 1 a 3 repetições.');
  const server = String(input.server || '').trim();
  const platform = String(input.platform || 'instagram');
  validateLiveServer(server, platform);
  const key = String(input.key || '').trim();
  if (key.length > 2048 || /[\r\n\x00]/.test(key)) throw Error('Chave de transmissão inválida.');
  return { title, media, destination: destination.href, repetitions, platform, server, key, targets:selectedPlatforms(input) };
}

export function setupLiveStudio({ app, requireAdmin, sameOriginOnly, root = process.env.LIVE_STUDIO_DIR || '/live-studio' }) {
  fs.mkdirSync(root, { recursive: true });
  const file = name => path.join(root, name);
  const read = (name, fallback) => { try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch { return fallback; } };
  const write = (name, value) => {
    const temp = file(`${name}.${randomUUID()}.tmp`);
    fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
    if (process.getuid?.() === 0) fs.chownSync(temp, 10001, 10001);
    fs.renameSync(temp, file(name));
  };
  const catalog = () => read('media.json', []).filter(m => /^[a-zA-Z0-9_-]+\.mp4$/.test(m.file) && Number.isFinite(m.duration) && m.duration > 0 && m.duration <= 601);
  const snapshot = () => {
    const status = read('status.json', {});
    return { ...status, online: Date.now() - Number(status.updatedAt || 0) < 20000 };
  };
  app.get('/api/admin/live-studio', requireAdmin, (_req, res) => {
    const saved = read('config.json', {});
    const { key, profiles: _privateProfiles, ...config } = saved;
    config.platform ||= 'instagram';
    const profiles = profilesOf(saved);
    const publicProfiles = Object.fromEntries(LIVE_PLATFORMS.map(platform => [platform, {server: profiles[platform]?.server || '', hasKey: Boolean(profiles[platform]?.key)}]));
    res.set('Cache-Control', 'no-store').json({ config, profiles: publicProfiles, hasKey: Boolean(key), status: snapshot(), media: catalog(), commentsConnected: false });
  });
  app.put('/api/admin/live-studio/config', requireAdmin, sameOriginOnly, (req, res) => {
    try {
      const status = snapshot();
      if (status.recording || fs.existsSync(file('command.json')) || fs.existsSync(file('executing-command.json'))) return res.status(409).json({ error: 'Aguarde a operação atual ou pare o teste antes de alterar.' });
      const config = validateLiveConfig(req.body || {});
      const media = catalog().find(m => m.file === config.media);
      if (!media) throw Error('Vídeo não disponível.');
      const previous = read('config.json', {});
      if (status.streaming) {
        const state = status.networks?.[config.platform]?.state;
        if (!status.online || !['failed', 'stopped'].includes(state)) return res.status(409).json({ error: 'Só é possível editar credenciais de uma saída confirmada como parada ou com falha. A rede em transmissão está protegida.' });
        const sharedUnchanged = ['title','media','destination','repetitions'].every(field => config[field] === previous[field])
          && JSON.stringify([...config.targets].sort()) === JSON.stringify([...selectedPlatforms(previous)].sort());
        if (!sharedUnchanged) return res.status(409).json({ error: 'Durante a live, altere somente servidor/chave da rede parada. Vídeo, título, destino, repetição e redes devem permanecer iguais.' });
      }
      const profiles = profilesOf(previous);
      const profile = profiles[config.platform] || {};
      config.key = req.body.clearKey ? '' : (config.key || (config.server === profile.server ? profile.key : '') || '');
      profiles[config.platform] = {server: config.server, key: config.key};
      config.profiles = profiles;
      config.duration = media.duration;
      config.updatedAt = Date.now();
      write('config.json', config);
      res.json({ ok: true, credentialsOnly: Boolean(status.streaming) });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.post('/api/admin/live-studio/control', requireAdmin, sameOriginOnly, (req, res) => {
    const action = req.body?.action;
    if (!['preview', 'start', 'stop', 'stop-network'].includes(action)) return res.status(400).json({ error: 'Ação inválida.' });
    const stopping = action === 'stop' || action === 'stop-network';
    if(action==='stop-network' && !LIVE_PLATFORMS.includes(req.body.platform)) return res.status(400).json({error:'Rede inválida.'});
    const status = snapshot();
    if (!status.online) return res.status(503).json({ error: 'OBS indisponível. Nenhuma ação foi enviada.' });
    if (fs.existsSync(file('command.json')) || fs.existsSync(file('executing-command.json'))) return res.status(409).json({ error: 'Já existe uma operação pendente ou em execução.' });
    const config = read('config.json', {});
    if (!stopping && (status.streaming || status.recording)) return res.status(409).json({ error: 'Uma sessão já está ativa.' });
    if (!stopping && !catalog().some(m => m.file === config.media)) return res.status(400).json({ error: 'Salve um vídeo válido antes de continuar.' });
    if (action === 'start' && req.body.confirm !== 'TRANSMITIR') return res.status(400).json({ error: 'Confirme TRANSMITIR.' });
    if (action === 'start') {
      try {
        const profiles=profilesOf(config);
        for(const platform of selectedPlatforms(config)){
          const profile=profiles[platform];
          if(!profile?.server || !profile?.key) throw Error('Servidor/chave ausente para '+platform+'. Nenhuma rede foi iniciada.');
          validateLiveServer(profile.server,platform);
          if(new URL(profile.server).search || profile.key.startsWith('/') || profile.key.includes('#')) throw Error('Separe servidor e chave em '+platform+'.');
        }
      }
      catch (e) { return res.status(400).json({error:e.message}); }
    }
    write('command.json', { id: randomUUID(), action, platform:action==='stop-network'?req.body.platform:undefined, createdAt: Date.now(), actor: req.user?.id });
    res.status(202).json({ ok: true, message: 'Comando recebido; acompanhe o status do OBS.' });
  });
  app.get('/api/admin/live-studio/media/:name', requireAdmin, (req, res) => {
    if (!catalog().some(m => m.file === req.params.name)) return res.sendStatus(404);
    res.set('Cache-Control', 'no-store').sendFile(path.join(root, 'media', req.params.name));
  });
}
