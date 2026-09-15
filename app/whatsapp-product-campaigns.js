import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {rasterSize} from './web-story-assets.js';
import {validAffiliateUrl} from './affiliate-catalog.js';
import {ensureWhatsAppScheduleConfirmation,countWhatsAppSchedules} from './whatsapp-schedule-worker.js';
import {isWhatsAppCommercialGroupAllowed,WHATSAPP_COMMERCIAL_EXCLUDED_REASON} from './whatsapp-commercial-policy.js';
import {whatsappCampaignDirectory,WHATSAPP_THEMATIC_GROUPS} from './whatsapp-group-directory.js';

const API = '/api/admin/whatsapp-qr/product-campaigns';
const MAX_BYTES = 8 * 1024 * 1024;
const GROUP = /^[0-9A-Za-z._:-]{1,140}@g\.us$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IMAGE_NAME = /^[a-f0-9]{64}\.jpg$/;
const DISCLOSURE = 'Publicidade · Link de afiliado: a VitrineCity pode receber comissão.';
const digest = value => createHash('sha256').update(value).digest('hex');
const fail = (message, status=400) => Object.assign(new Error(message), {status, campaignSafe:true});
const safeText = value => typeof value === 'string' ? value.trim() : '';

function catalogImage(value) {
  try {
    if(typeof value !== 'string' || value.length > 1000 || /[\\\x00-\x20]/.test(value))return '';
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'http2.mlstatic.com' &&
      !url.username && !url.password && !url.port && !url.hash ? url.href : '';
  } catch { return ''; }
}

function usableProduct(row) {
  return row && SLUG.test(row.slug) && row.slug.length <= 100 && row.platform === 'mercadolivre' &&
    row.status === 'published' && row.availability !== 'unavailable' && row.health !== 'broken' &&
    validAffiliateUrl(row.affiliate_url, 'mercadolivre') && catalogImage(row.image) && safeText(row.title);
}

function productFingerprint(row) {
  return digest(JSON.stringify([row.slug,row.title,row.description,row.category,row.image,row.affiliate_url,row.revision]));
}

function checkRaster(bytes, jpegOnly=false) {
  if(!bytes.length || bytes.length > MAX_BYTES)throw fail('A foto precisa ter até 8 MB.');
  let size;
  try { size = rasterSize(bytes); } catch { throw fail('A foto precisa ser uma imagem JPEG, PNG ou WebP válida.'); }
  if(!size.width || !size.height || size.width > 10000 || size.height > 10000 || size.width * size.height > 40000000 || (jpegOnly && size.type !== 'jpeg'))
    throw fail('A foto não atende aos limites de formato e dimensões.');
  return size;
}

async function convertJpeg({inputPath, outputPath}) {
  await new Promise((resolve,reject) => {
    // The input is an inspected local raster. No shell or remote input protocols.
    const child = spawn('ffmpeg', ['-nostdin','-hide_banner','-loglevel','error','-threads','1',
      '-protocol_whitelist','file,pipe','-i',inputPath,'-frames:v','1','-vf',
      'scale=min(1600\\,iw):min(1600\\,ih):force_original_aspect_ratio=decrease',
      '-q:v','3','-threads','1','-y',outputPath], {windowsHide:true,stdio:'ignore'});
    const timer = setTimeout(() => { child.kill(); reject(fail('A preparação da foto demorou demais. Tente novamente.',502)); },20000);
    child.once('error',() => { clearTimeout(timer); reject(fail('A preparação de fotos está indisponível.',503)); });
    child.once('exit',code => { clearTimeout(timer); code === 0 ? resolve() : reject(fail('Não foi possível preparar esta foto.',502)); });
  });
}

export function registerWhatsAppProductCampaigns({app,db,requireAdmin,sameOriginOnly,siteUrl,dataDir,
  whatsappQrRequest,whatsappQrData,fetchImpl=globalThis.fetch,convertImage=convertJpeg,now=Date.now,isGroupAllowed=isWhatsAppCommercialGroupAllowed}) {
  const origin = new URL(siteUrl).origin;
  const imageRoot = path.resolve(dataDir,'whatsapp-product-images');
  const previews = new Map();
  db.exec(`CREATE TABLE IF NOT EXISTS whatsapp_product_campaigns (
    id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','queued')),
    products_json TEXT NOT NULL, groups_json TEXT NOT NULL, start_at TEXT NOT NULL,
    interval_minutes INTEGER NOT NULL, created_at TEXT NOT NULL, published_at TEXT
  );
  CREATE TABLE IF NOT EXISTS whatsapp_product_images (
    source_url TEXT PRIMARY KEY, file_name TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );`);
  const columns = new Set(db.prepare('PRAGMA table_info(whatsapp_qr_schedules)').all().map(column => column.name));
  if(!columns.size)throw Error('whatsapp_qr_schedules must be initialized before product campaigns');
  ensureWhatsAppScheduleConfirmation(db);
  for(const column of ['campaign_id','product_slug','image_path'])if(!columns.has(column))db.exec(`ALTER TABLE whatsapp_qr_schedules ADD COLUMN ${column} TEXT`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_whatsapp_product_schedule_campaign ON whatsapp_qr_schedules(campaign_id)');

  const getRow = id => db.prepare('SELECT * FROM whatsapp_product_campaigns WHERE id=?').get(id);
  const currentProduct = slug => db.prepare('SELECT * FROM affiliate_catalog WHERE slug=?').get(slug);
  const getSchedules = id => db.prepare('SELECT * FROM whatsapp_qr_schedules WHERE campaign_id=? ORDER BY scheduled_at,id').all(id);
  const publicUrl = (slug,id) => {
    const url = new URL('/ofertas/'+slug,origin);
    if(id)for(const [key,value] of Object.entries({utm_source:'whatsapp',utm_medium:'group',utm_campaign:id,utm_content:slug}))url.searchParams.set(key,value);
    return url.href;
  };
  const caption = (product,id) => `${product.title}\n\n${product.message}\n\n${DISCLOSURE}\n\n${publicUrl(product.slug,id)}`;
  function campaignDto(row) {
    const products = JSON.parse(row.products_json), groups = JSON.parse(row.groups_json);
    const counts = countWhatsAppSchedules(getSchedules(row.id),now());
    const total = products.length * groups.length;
    const settled = row.status === 'queued' && !counts.pending && !counts.processing;
    const status = settled && (counts.failed||counts.unknown) ? 'needs_review' : settled && counts.sent + counts.cancelled === total ? 'completed' : row.status;
    return {id:row.id,status,products:products.map(product => ({slug:product.slug,title:product.title,
      image:`${API}/${row.id}/images/${product.slug}`,caption:caption(product,row.id),url:publicUrl(product.slug,row.id)})),
      groups,startAt:row.start_at,intervalMinutes:row.interval_minutes,total,counts,createdAt:row.created_at,publishedAt:row.published_at};
  }
  async function currentGroups() {
    let history,state;
    try {
      state = whatsappQrData(await whatsappQrRequest('/session/status'));
      if(!(state.connected || state.Connected) || !(state.loggedIn || state.LoggedIn))throw fail('Conecte o WhatsApp no painel antes de preparar os envios.',409);
      history = whatsappQrData(await whatsappQrRequest('/chat/history?chat_jid=index'));
    } catch(error) { if(error.campaignSafe)throw error; throw fail('Não foi possível consultar os grupos da sessão conectada.',502); }
    // A failed canonical lookup cannot authorize additions. Historical choices
    // retain their previous behavior; only four named destinations may be added.
    let groupData;try{groupData=whatsappQrData(await whatsappQrRequest('/group/list'));}catch{}
    return whatsappCampaignDirectory({history,groupData,state,isGroupAllowed});
  }
  async function imageBytes(fileName) {
    if(!IMAGE_NAME.test(fileName || ''))throw fail('A foto preparada precisa ser revisada.',409);
    try {
      const root = await fs.realpath(imageRoot), file = await fs.realpath(path.join(imageRoot,fileName));
      if(path.dirname(file) !== root)throw Error('outside_image_root');
      const stat = await fs.stat(file);
      if(!stat.isFile() || stat.size > MAX_BYTES)throw Error('invalid_image_file');
      const bytes = await fs.readFile(file);
      checkRaster(bytes,true);
      if(digest(bytes)+'.jpg' !== fileName)throw Error('image_integrity');
      return bytes;
    } catch { throw fail('A foto preparada não está disponível ou foi alterada. Prepare uma nova prévia.',409); }
  }
  async function prepareImage(url) {
    const cached = db.prepare('SELECT * FROM whatsapp_product_images WHERE source_url=?').get(url);
    if(cached)try { await imageBytes(cached.file_name); return cached.file_name; } catch { /* Rebuild the cache, never substitute another photo. */ }
    await fs.mkdir(imageRoot,{recursive:true,mode:0o700});
    let bytes;
    try {
      const response = await fetchImpl(url,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(15000),headers:{Accept:'image/jpeg,image/png,image/webp'}});
      if(!response.ok || response.status >= 300 || (response.url && catalogImage(response.url) !== url)) {
        await response.body?.cancel().catch(() => {});
        throw fail('Não foi possível baixar a foto original do catálogo.',502);
      }
      const length = Number(response.headers.get('content-length') || 0);
      if(length > MAX_BYTES) { await response.body?.cancel().catch(() => {}); throw fail('A foto precisa ter até 8 MB.'); }
      if(!response.body)throw fail('A foto do catálogo está vazia.');
      const reader = response.body.getReader(), chunks = [];
      let total = 0;
      try {
        for(;;) {
          const {done,value} = await reader.read();
          if(done)break;
          total += value.byteLength;
          if(total > MAX_BYTES)throw fail('A foto precisa ter até 8 MB.');
          chunks.push(Buffer.from(value));
        }
      } finally { await reader.cancel().catch(() => {}); }
      bytes = Buffer.concat(chunks);
    } catch(error) { if(error.campaignSafe)throw error; throw fail('Não foi possível baixar a foto original do catálogo. Tente novamente.',502); }
    const size = checkRaster(bytes);
    const temp = await fs.mkdtemp(path.join(imageRoot,'prepare-'));
    try {
      const inputPath = path.join(temp,'input.'+(size.type === 'jpeg' ? 'jpg' : size.type)), outputPath = path.join(temp,'prepared.jpg');
      await fs.writeFile(inputPath,bytes,{mode:0o600,flag:'wx'});
      try { await convertImage({inputPath,outputPath}); }
      catch(error) { if(error.campaignSafe)throw error; throw fail('Não foi possível preparar esta foto.',502); }
      const outputStat = await fs.stat(outputPath);
      if(!outputStat.isFile() || outputStat.size > MAX_BYTES)throw fail('A foto preparada excede o limite.');
      const output = await fs.readFile(outputPath), dimensions = checkRaster(output,true), fileName = digest(output)+'.jpg';
      // Content-addressed files never overwrite a different image snapshot.
      await fs.writeFile(path.join(imageRoot,fileName),output,{mode:0o600,flag:'wx'}).catch(error => { if(error.code !== 'EEXIST')throw error; });
      await imageBytes(fileName);
      db.prepare(`INSERT INTO whatsapp_product_images(source_url,file_name,width,height,created_at) VALUES (?,?,?,?,?)
        ON CONFLICT(source_url) DO UPDATE SET file_name=excluded.file_name,width=excluded.width,height=excluded.height,created_at=excluded.created_at`)
        .run(url,fileName,dimensions.width,dimensions.height,new Date(now()).toISOString());
      return fileName;
    } finally {
      // This directory was created immediately above under our dedicated image root.
      for(const name of await fs.readdir(temp).catch(() => []))await fs.unlink(path.join(temp,name)).catch(() => {});
      await fs.rmdir(temp).catch(() => {});
    }
  }
  function validateRequest(input) {
    if(!input || !Array.isArray(input.products) || input.products.length < 1 || input.products.length > 5)throw fail('Selecione de 1 a 5 produtos.');
    if(!Array.isArray(input.groupJids) || input.groupJids.length < 1 || input.groupJids.length > 50 || input.groupJids.some(jid => typeof jid !== 'string' || !GROUP.test(jid)))throw fail('Selecione de 1 a 50 grupos conectados.');
    if(new Set(input.groupJids).size !== input.groupJids.length)throw fail('Há grupos repetidos na seleção.');
    if(input.groupJids.some(jid => !isGroupAllowed(jid)))throw fail(WHATSAPP_COMMERCIAL_EXCLUDED_REASON,409);
    const products = input.products.map(item => {
      const slug = safeText(item?.slug), message = safeText(item?.message);
      if(!SLUG.test(slug) || slug.length > 100 || !message || message.length > 1200 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(message))throw fail('Cada produto precisa de uma mensagem de até 1.200 caracteres.');
      if(/https?:\/\/|www\.|meli\.la\//i.test(message))throw fail('Escreva somente a mensagem. O link da página será incluído automaticamente.');
      return {slug,message};
    });
    if(new Set(products.map(item => item.slug)).size !== products.length)throw fail('Há produtos repetidos na seleção.');
    const intervalMinutes = input.intervalMinutes ?? 120;
    if(!Number.isInteger(intervalMinutes) || intervalMinutes < 30 || intervalMinutes > 1440)throw fail('O intervalo deve ser de 30 a 1.440 minutos.');
    const start = typeof input.startAtISO === 'string' ? Date.parse(input.startAtISO) : NaN;
    if(!Number.isFinite(start) || start > now()+30*86400000)throw fail('Escolha uma data futura nos próximos 30 dias.');
    const idempotencyKey = safeText(input.idempotencyKey);
    if(!/^[a-zA-Z0-9_-]{16,100}$/.test(idempotencyKey))throw fail('Atualize a página para preparar uma nova prévia.');
    return {products,groupJids:[...input.groupJids].sort(),startAt:new Date(start).toISOString(),intervalMinutes,idempotencyKey};
  }
  function assertProducts(products) {
    for(const product of products) {
      const row = currentProduct(product.slug);
      if(!usableProduct(row))throw fail('Um produto foi pausado, ficou indisponível ou não possui uma foto válida. Revise a seleção.',409);
      if(product.fingerprint && product.fingerprint !== productFingerprint(row))throw fail('Um produto foi atualizado. Prepare uma nova prévia antes de enviar.',409);
    }
  }
  async function createPreview(input, requestHash) {
    const groups = await currentGroups(), selected = input.groupJids.map(jid => groups.find(group => group.jid === jid));
    if(selected.some(group => !group))throw fail('Um grupo selecionado não está mais na sessão conectada. Atualize a lista.',409);
    assertProducts(input.products);
    const products = [];
    for(const item of input.products) {
      const row = currentProduct(item.slug), fingerprint = productFingerprint(row);
      const imagePath = await prepareImage(catalogImage(row.image));
      products.push({...item,title:row.title,fingerprint,imagePath});
    }
    assertProducts(products);
    if(input.groupJids.some(jid => !isGroupAllowed(jid)))throw fail(WHATSAPP_COMMERCIAL_EXCLUDED_REASON,409);
    return db.transaction(() => {
      const existing = db.prepare('SELECT * FROM whatsapp_product_campaigns WHERE idempotency_key=?').get(input.idempotencyKey);
      if(existing) {
        if(existing.request_hash !== requestHash)throw fail('Esta chave já pertence a outra seleção. Prepare uma nova prévia.',409);
        return campaignDto(existing);
      }
      const id = randomUUID();
      db.prepare(`INSERT INTO whatsapp_product_campaigns(id,idempotency_key,request_hash,products_json,groups_json,start_at,interval_minutes,created_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(id,input.idempotencyKey,requestHash,JSON.stringify(products),JSON.stringify(selected),input.startAt,input.intervalMinutes,new Date(now()).toISOString());
      return campaignDto(getRow(id));
    })();
  }
  const route = fn => async(req,res) => {
    res.set('Cache-Control','no-store');
    try { return await fn(req,res); }
    catch(error) { return res.status(error.campaignSafe ? error.status : 500).json({error:error.campaignSafe ? error.message : 'Não foi possível concluir esta operação. Tente novamente.'}); }
  };
  app.get(API+'/catalog',requireAdmin,route(async(_req,res) => {
    const items = db.prepare("SELECT * FROM affiliate_catalog WHERE platform='mercadolivre' AND status='published' ORDER BY updated_at DESC,title LIMIT 5000").all()
      .filter(usableProduct).map(row => ({slug:row.slug,title:row.title,description:row.description,category:row.category,image:catalogImage(row.image),url:publicUrl(row.slug)}));
    return res.json({items,groups:await currentGroups()});
  }));
  app.get(API,requireAdmin,route((_req,res) => res.json({campaigns:db.prepare('SELECT * FROM whatsapp_product_campaigns ORDER BY created_at DESC LIMIT 30').all().map(campaignDto)})));
  app.post(API+'/preview',requireAdmin,sameOriginOnly,route(async(req,res) => {
    const input = validateRequest(req.body), requestHash = digest(JSON.stringify(input));
    const existing = db.prepare('SELECT * FROM whatsapp_product_campaigns WHERE idempotency_key=?').get(input.idempotencyKey);
    if(existing) {
      if(existing.request_hash !== requestHash)throw fail('Esta chave já pertence a outra seleção. Prepare uma nova prévia.',409);
      return res.json(campaignDto(existing));
    }
    if(Date.parse(input.startAt) < now()-30000)throw fail('Escolha uma data futura nos próximos 30 dias.');
    const pending = previews.get(input.idempotencyKey);
    if(pending && pending.hash !== requestHash)throw fail('Há outra seleção em preparação com esta chave.',409);
    if(pending)return res.json(await pending.promise);
    if(previews.size >= 2)throw fail('Há duas prévias em preparação. Aguarde alguns segundos.',429);
    const promise = createPreview(input,requestHash);
    previews.set(input.idempotencyKey,{hash:requestHash,promise});
    try { return res.status(201).json(await promise); }
    finally { previews.delete(input.idempotencyKey); }
  }));
  app.get(API+'/:id/images/:slug',requireAdmin,route(async(req,res) => {
    const row = getRow(String(req.params.id)), product = row && JSON.parse(row.products_json).find(item => item.slug === req.params.slug);
    if(!product)throw fail('Foto não encontrada.',404);
    const bytes = await imageBytes(product.imagePath);
    return res.set({'Content-Type':'image/jpeg','X-Content-Type-Options':'nosniff'}).send(bytes);
  }));
  app.get(API+'/:id',requireAdmin,route((req,res) => {
    const row = getRow(String(req.params.id));
    if(!row)throw fail('Campanha não encontrada.',404);
    return res.json(campaignDto(row));
  }));
  app.post(API+'/:id/publish',requireAdmin,sameOriginOnly,route(async(req,res) => {
    let row = getRow(String(req.params.id));
    if(!row)throw fail('Campanha não encontrada.',404);
    if(row.status === 'queued')return res.json(campaignDto(row));
    const products = JSON.parse(row.products_json), groups = JSON.parse(row.groups_json);
    if(groups.some(group => !isGroupAllowed(group.jid)))throw fail(WHATSAPP_COMMERCIAL_EXCLUDED_REASON,409);
    if(Date.parse(row.start_at) < now()-30000)throw fail('O horário da prévia já passou. Prepare outra prévia com um novo horário.',409);
    const connected = new Set((await currentGroups()).map(group => group.jid));
    if(groups.some(group => !connected.has(group.jid)))throw fail('Um grupo da prévia não está mais conectado. Prepare uma nova seleção.',409);
    assertProducts(products);
    for(const product of products)await imageBytes(product.imagePath);
    db.transaction(() => {
      row = getRow(row.id);
      if(row.status === 'queued')return;
      if(groups.some(group => !isGroupAllowed(group.jid)))throw fail(WHATSAPP_COMMERCIAL_EXCLUDED_REASON,409);
      assertProducts(products);
      const insert = db.prepare(`INSERT INTO whatsapp_qr_schedules(id,group_jid,group_name,sitemap_url,message,scheduled_at,campaign_id,product_slug,image_path)
        VALUES (?,?,?,?,?,?,?,?,?)`);
      products.forEach((product,index) => {
        const scheduledAt = new Date(Date.parse(row.start_at)+index*row.interval_minutes*60000).toISOString();
        groups.forEach((group,groupIndex) => insert.run(digest(`${row.id}\n${product.slug}\n${group.jid}`).slice(0,32),group.jid,group.name,
          publicUrl(product.slug,row.id),caption(product,row.id),new Date(Date.parse(scheduledAt)+groupIndex*2000).toISOString(),row.id,product.slug,product.imagePath));
      });
      db.prepare("UPDATE whatsapp_product_campaigns SET status='queued',published_at=? WHERE id=? AND status='draft'").run(new Date(now()).toISOString(),row.id);
    })();
    return res.json(campaignDto(getRow(row.id)));
  }));
  async function prepareScheduledMessage(item) {
    const schedule = db.prepare('SELECT * FROM whatsapp_qr_schedules WHERE id=?').get(String(item?.id || ''));
    if(!schedule)throw fail('Agendamento não encontrado.',409);
    if(!isGroupAllowed(schedule.group_jid))throw fail(WHATSAPP_COMMERCIAL_EXCLUDED_REASON,409);
    if(!schedule.product_slug && !schedule.image_path)return null;
    if(WHATSAPP_THEMATIC_GROUPS.some(group=>group.jid===schedule.group_jid)&&!(await currentGroups()).some(group=>group.jid===schedule.group_jid))
      throw fail('A permissão deste grupo mudou. Revise antes de continuar.',409);
    const campaign = getRow(schedule.campaign_id), product = campaign && JSON.parse(campaign.products_json).find(value => value.slug === schedule.product_slug);
    const group = campaign && JSON.parse(campaign.groups_json).find(value => value.jid === schedule.group_jid);
    if(!campaign || campaign.status !== 'queued' || schedule.status !== 'processing' || !product || !group ||
      schedule.image_path !== product.imagePath || schedule.sitemap_url !== publicUrl(product.slug,campaign.id) || schedule.message !== caption(product,campaign.id))
      throw fail('Este envio precisa ser revisado antes de continuar.',409);
    assertProducts([product]);
    const bytes = await imageBytes(product.imagePath);
    // A pause/cancellation may arrive while the file is being read. Recheck at
    // the last synchronous boundary before returning a provider payload.
    assertProducts([product]);
    const latest = db.prepare('SELECT status,product_slug,image_path,group_jid,sitemap_url,message FROM whatsapp_qr_schedules WHERE id=?').get(schedule.id);
    if(!latest || latest.status !== 'processing' || latest.product_slug !== schedule.product_slug || latest.image_path !== schedule.image_path ||
      latest.group_jid !== schedule.group_jid || latest.sitemap_url !== schedule.sitemap_url || latest.message !== schedule.message)
      throw fail('Este envio foi alterado ou cancelado e precisa ser revisado.',409);
    return {pathname:'/chat/send/image',body:{Phone:group.jid,Caption:caption(product,campaign.id),
      Image:'data:image/jpeg;base64,'+bytes.toString('base64'),Id:schedule.id.replaceAll('-','').toUpperCase()}};
  }
  return {prepareScheduledMessage};
}
