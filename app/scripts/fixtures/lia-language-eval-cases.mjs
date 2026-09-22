export const liaLanguageEval=Object.freeze({
  version:'lia-language-eval-20260922-v1',
  provenance:{source:'verified production regressions and synthetic independent variants',containsPersonalData:false,revocable:true},
  calibration:Object.freeze([
    {id:'c01',input:'abra o youtube e coloca uma musica eletronica para tocar',kind:'browser',host:'www.youtube.com',query:'musica eletronica',playback:true},
    {id:'c02',input:'acesa o youtub e colca uma musica eletronica pra toca',kind:'browser',host:'www.youtube.com',query:'musica eletronica',playback:true},
    {id:'c03',input:'entre no insta',kind:'browser',host:'www.instagram.com',playback:false},
    {id:'c04',input:'visite o gogle',kind:'browser',host:'www.google.com',playback:false},
    {id:'c05',input:'entra no tik tok',kind:'browser',host:'www.tiktok.com',playback:false},
    {id:'c06',input:'acesse https://www.embrapa.br e leia o conteúdo principal',kind:'browser',host:'www.embrapa.br',playback:false},
    {id:'c07',input:'explique o que é o YouTube',kind:'unsupported'},
    {id:'c08',input:'faça um site para minha loja',kind:'unsupported'}
  ]),
  holdout:Object.freeze([
    {id:'h01',input:'abre o yutube e bota jazz instrumental pra ouvir',kind:'browser',host:'www.youtube.com',query:'jazz instrumental',playback:true},
    {id:'h02',input:'navege no face',kind:'browser',host:'www.facebook.com',playback:false},
    {id:'h03',input:'confira https://www.gov.br/agricultura/',kind:'browser',host:'www.gov.br',playback:false},
    {id:'h04',input:'abre o kuai',kind:'browser',host:'www.kwai.com',playback:false},
    {id:'h05',input:'acesar o hostiger',kind:'browser',host:'hpanel.hostinger.com',playback:false},
    {id:'h06',input:'o Instagram é uma rede social?',kind:'unsupported'},
    {id:'h07',input:'crie uma página chamada Face Azul',kind:'unsupported'},
    {id:'h08',input:'pesquize agricultura urbana em três fontes',search:true,kind:'unsupported'},
    {id:'h09',input:'ache cursos públicos sobre irrigação',search:true,kind:'unsupported'},
    {id:'h10',input:'preciso de ajuda para escrever um texto',search:false,kind:'unsupported'}
  ]),
  context:Object.freeze([
    {id:'x01',previous:['abra o youtube e coloca uma musica eletronica para tocar'],input:'buscar a música e abrir o primeiro vídeo reproduzível',host:'www.youtube.com',query:'musica eletronica',playback:true},
    {id:'x02',previous:['acesa o youtub e colca jazz instrumental pra toca'],input:'continue no mesmo site e abra o primeiro vídeo',host:'www.youtube.com',query:'jazz instrumental',playback:true},
    {id:'x03',previous:['acesse https://www.embrapa.br e leia a página'],input:'continue no mesmo site',host:'www.embrapa.br',playback:false},
    {id:'x04',previous:['abra o youtube e procure notícias'],input:'pesquise agricultura urbana em três fontes',kind:'unsupported',unchanged:true}
  ])
});
