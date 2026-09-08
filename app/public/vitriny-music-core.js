export const musicKinds={playlist:'Playlist',video:'Vídeo / set',live:'Rádio contínua'};
export const musicGenres={eletronica:'Eletrônica',sertanejo:'Sertanejo',forro:'Forró / piseiro',pagode:'Samba / pagode',pop:'Pop',rock:'Rock',mpb:'MPB / soul',gospel:'Gospel',rap:'Rap / hip-hop',funk:'Funk',reggae:'Reggae',jazz:'Jazz / blues',classica:'Clássica',lofi:'Lo-fi / ambiente',outros:'Outros estilos'};
export const normalizeMusicText=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
// Accept IDs from supported YouTube URL shapes; never embed arbitrary HTML or URLs.
export function youtubeSource(value,kind='video'){
  try{
    const url=new URL(value),host=url.hostname.toLowerCase();
    if(url.protocol!=='https:'||url.username||url.password||url.port||!['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtu.be','www.youtube-nocookie.com'].includes(host))return null;
    const parts=url.pathname.split('/').filter(Boolean);
    if(kind==='playlist'){
      const id=url.searchParams.get('list');
      if(!['/playlist','/watch','/embed/videoseries'].includes(url.pathname)||!/^PL[a-zA-Z0-9_-]{8,78}$/.test(id||''))return null;
      return {kind,id,url:'https://www.youtube.com/playlist?list='+id,embedUrl:'https://www.youtube-nocookie.com/embed/videoseries?list='+id+'&autoplay=0&playsinline=1&rel=0'};
    }
    if(!['video','live'].includes(kind))return null;
    const id=host==='youtu.be'&&parts.length===1?parts[0]:url.pathname==='/watch'?url.searchParams.get('v'):parts.length===2&&['live','embed','shorts'].includes(parts[0])?parts[1]:null;
    if(!/^[a-zA-Z0-9_-]{11}$/.test(id||''))return null;
    return {kind,id,url:'https://www.youtube.com/watch?v='+id,embedUrl:'https://www.youtube-nocookie.com/embed/'+id+'?autoplay=0&playsinline=1&rel=0'};
  }catch{return null;}
}
export function musicMatches(item,query){const haystack=normalizeMusicText([item.title,item.artist,item.description,item.tags,musicGenres[item.genre]].join(' '));return normalizeMusicText(query).trim().split(/\s+/).filter(Boolean).slice(0,8).every(term=>haystack.includes(term));}
