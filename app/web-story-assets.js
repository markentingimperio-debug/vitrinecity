import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';

const assetError = message => Object.assign(Error(message), {status:400});

export function normalizeStoryImagePath(value,siteUrl) {
  if(typeof value!=='string')throw assetError('Escolha uma imagem da biblioteca da VitrineCity.');
  let url=value.trim();
  if(url.length>400||/[\\%?#\x00-\x20]/.test(url)||url.split('/').includes('..')||url.split('/').includes('.'))throw assetError('Escolha uma imagem local da biblioteca da VitrineCity.');
  if(/^https?:\/\//i.test(url)) {
    const parsed=new URL(url);
    if(!siteUrl||parsed.origin!==new URL(siteUrl).origin||parsed.username||parsed.password)throw assetError('A imagem precisa estar no mesmo endereço da VitrineCity.');
    url=parsed.pathname;
  }
  if(!url.startsWith('/')||url.startsWith('//'))throw assetError('Escolha uma imagem local da biblioteca da VitrineCity.');
  return url;
}

export function rasterSize(bytes) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    return {width:bytes.readUInt32BE(16), height:bytes.readUInt32BE(20), type:'png'};
  }
  if (bytes.length >= 12 && bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP') {
    for(let p=12;p+8<=bytes.length;) {
      const kind=bytes.toString('ascii',p,p+4), length=bytes.readUInt32LE(p+4), at=p+8;
      if(at+length>bytes.length)break;
      if(kind==='VP8X'&&length>=10)return {width:1+bytes.readUIntLE(at+4,3),height:1+bytes.readUIntLE(at+7,3),type:'webp'};
      if(kind==='VP8 '&&length>=10&&bytes.readUIntLE(at+3,3)===0x2a019d)return {width:bytes.readUInt16LE(at+6)&16383,height:bytes.readUInt16LE(at+8)&16383,type:'webp'};
      if(kind==='VP8L'&&length>=5&&bytes[at]===47){const bits=bytes.readUInt32LE(at+1);return {width:(bits&16383)+1,height:((bits>>>14)&16383)+1,type:'webp'};}
      p=at+length+(length%2);
    }
  }
  if(bytes[0]===255&&bytes[1]===216) {
    let p=2;
    while(p+4<bytes.length) {
      if(bytes[p++]!==255)break;
      while(bytes[p]===255)p++;
      const marker=bytes[p++];
      if(marker===217||marker===218)break;
      if(marker===1||(marker>=208&&marker<=215))continue;
      const length=bytes.readUInt16BE(p);
      if(length<2||p+length>bytes.length)break;
      if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&length>=7)return {width:bytes.readUInt16BE(p+5),height:bytes.readUInt16BE(p+3),type:'jpeg'};
      p+=length;
    }
  }
  throw assetError('Use uma imagem PNG, JPEG ou WebP válida.');
}

export function createStoryAssets({publicDir,dataDir,siteUrl}) {
  let conversions=0;
  const outputDir=path.join(dataDir,'web-stories');
  const roots=[['/assets/',path.join(publicDir,'assets')],['/uploads/generated-videos/',path.join(dataDir,'generated-videos')],['/uploads/store-assets/',path.join(dataDir,'store-assets')]];
  async function image(url,{logo=false,catalog=false}={}) {
    url=normalizeStoryImagePath(url,siteUrl);
    const mapping=roots.find(([prefix])=>url.startsWith(prefix));
    if(!mapping)throw assetError('A imagem deve pertencer à biblioteca local da VitrineCity.');
    const [prefix,root]=mapping, base=await fs.realpath(root), file=await fs.realpath(path.join(root,url.slice(prefix.length)));
    if(!file.startsWith(base+path.sep))throw assetError('Caminho de imagem inválido.');
    const stat=await fs.stat(file);
    if(!stat.isFile()||stat.size>8*1024*1024)throw assetError('Use uma imagem de até 8 MB.');
    const bytes=await fs.readFile(file), size=rasterSize(bytes);
    if(size.width>10000||size.height>10000||size.width*size.height>40000000)throw assetError('Dimensões da imagem excedem o limite.');
    const tooSmall=catalog===true?(size.width<640||size.height<360||size.width*size.height<230400):Math.min(size.width,size.height)<640;
    if(logo?(size.width!==size.height||size.width<96):tooSmall)throw assetError(logo?'O logo deve ser quadrado, com pelo menos 96 pixels.':catalog===true?'A foto do catálogo precisa ter pelo menos 640 × 360 pixels.':'Use uma imagem com pelo menos 640 pixels em cada lado.');
    return {...size,url,file,hash:createHash('sha256').update(bytes).digest('hex')};
  }
  async function poster(asset) {
    await fs.mkdir(outputDir,{recursive:true});
    const name=asset.hash.slice(0,32)+'.jpg', destination=path.join(outputDir,name);
    try { const size=rasterSize(await fs.readFile(destination));if(size.width===900&&size.height===1200)return '/story-assets/'+name; }catch{}
    if(conversions>=2)throw assetError('Há duas capas em preparação. Aguarde alguns segundos e tente novamente.');
    conversions++;
    const temporary=path.join(outputDir,randomUUID()+'.jpg');
    try {
      await new Promise((resolve,reject)=>{
        // Local raster only. No URL, shell, user-supplied arguments or network protocols.
        const child=spawn('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-protocol_whitelist','file,pipe','-i',asset.file,'-frames:v','1','-vf','scale=900:1200:force_original_aspect_ratio=increase,crop=900:1200','-q:v','3','-y',temporary],{windowsHide:true,stdio:'ignore'});
        const timer=setTimeout(()=>{child.kill();reject(assetError('A preparação da capa demorou demais. Tente outra imagem.'));},20000);
        child.on('error',()=>{clearTimeout(timer);reject(assetError('Preparação de imagens indisponível. O servidor precisa do FFmpeg.'));});
        child.on('exit',code=>{clearTimeout(timer);code===0?resolve():reject(assetError('Não foi possível preparar esta imagem. Escolha outra imagem local.'));});
      });
      const size=rasterSize(await fs.readFile(temporary));
      if(size.width!==900||size.height!==1200)throw assetError('A capa não atende às dimensões exigidas.');
      await fs.rename(temporary,destination);
      return '/story-assets/'+name;
    } finally {conversions--;await fs.unlink(temporary).catch(()=>{});}
  }
  async function library() {
    const items=[];
    const titles={'esportes-calendario':'Agenda de esportes','ia-revisao-humana':'Inteligência artificial com revisão humana','noite-cinema':'Noite de cinema','tecnologia-celular':'Tecnologia no celular','bolo-cenoura':'Bolo de cenoura','bowl-frango':'Bowl de frango','fricasse-frango':'Fricassê de frango'};
    // Only shipped editorial/recipe assets; never enumerate customer/private uploads.
    for(const [folder,category] of [['editorial','Editorial'],['recipes','Receitas']]) {
      const entries=await fs.readdir(path.join(publicDir,'assets',folder),{withFileTypes:true}).catch(()=>[]);
      for(const entry of entries.filter(e=>e.isFile()&&/\.(jpg|jpeg|png|webp)$/i.test(e.name)).slice(0,80)){const stem=entry.name.replace(/\.[^.]+$/,'');items.push({url:'/assets/'+folder+'/'+entry.name,title:titles[stem]||stem.replace(/[-_]/g,' '),category});}
    }
    return items;
  }
  return {image,poster,outputDir,library};
}
