const HEX=/^#[0-9a-f]{6}$/i;

const DEFINITIONS=Object.freeze({
  'vitrine-city':Object.freeze({
    themeId:'neural-nexus',tagline:'Núcleo inteligente do ecossistema Vitriny',
    palette:Object.freeze({background:'#02050c',fog:'#07101c',ground:'#09131c',road:'#101a24',accent:'#6ee7ff',secondary:'#8f8cff'}),
    landmark:Object.freeze({id:'neural-spire',label:'Vitriny Neural Spire',kind:'spire',height:58,radius:11,detail:'energy-rings'})
  }),
  silvania:Object.freeze({
    themeId:'cerrado-gardens',tagline:'Cidade-jardim digital inspirada no Cerrado',
    palette:Object.freeze({background:'#03100c',fog:'#082219',ground:'#0d2119',road:'#15251f',accent:'#85e6a8',secondary:'#ffc56b'}),
    landmark:Object.freeze({id:'cerrado-crown',label:'Coroa do Cerrado',kind:'crown',height:38,radius:15,detail:'botanical-rings'})
  }),
  anapolis:Object.freeze({
    themeId:'connected-axis',tagline:'Eixo de conexões, negócios e mobilidade digital',
    palette:Object.freeze({background:'#06101b',fog:'#0a1d30',ground:'#0d1b2a',road:'#162334',accent:'#6f9cff',secondary:'#ffb36b'}),
    landmark:Object.freeze({id:'connection-arch',label:'Arco Conector',kind:'arch',height:46,radius:17,detail:'transit-beacons'})
  }),
  vianopolis:Object.freeze({
    themeId:'cerrado-crossroads',tagline:'Conexões do Cerrado, comércio local e vida digital',
    palette:Object.freeze({background:'#06100b',fog:'#102219',ground:'#13231a',road:'#263126',accent:'#f0c96b',secondary:'#75d6a5'}),
    landmark:Object.freeze({id:'cerrado-gateway',label:'Portal do Cerrado',kind:'arch',height:40,radius:16,detail:'route-lights'})
  }),
  goiania:Object.freeze({
    themeId:'green-metropolis',tagline:'Metrópole verde, criativa e conectada',
    palette:Object.freeze({background:'#050711',fog:'#101328',ground:'#121827',road:'#1a2030',accent:'#b58cff',secondary:'#85e6a8'}),
    landmark:Object.freeze({id:'metropolis-orbit',label:'Órbita Metropolitana',kind:'orbital',height:52,radius:18,detail:'floating-orbits'})
  })
});

function validPalette(palette){
  return palette&&['background','fog','ground','road','accent','secondary'].every(key=>HEX.test(String(palette[key]||'')));
}
function validLandmark(landmark){
  return landmark&&typeof landmark.id==='string'&&typeof landmark.label==='string'&&['spire','crown','arch','orbital'].includes(landmark.kind)&&Number.isFinite(landmark.height)&&Number.isFinite(landmark.radius);
}

export const SPATIAL_CITY_IDENTITY_IDS=Object.freeze(Object.keys(DEFINITIONS));
export function spatialCityIdentity(cityId){return DEFINITIONS[String(cityId||'').trim().toLowerCase()]||null;}
export function publicSpatialCityIdentity(cityId){
  const identity=spatialCityIdentity(cityId);if(!identity||!validPalette(identity.palette)||!validLandmark(identity.landmark))return null;
  return Object.freeze({
    themeId:identity.themeId,tagline:identity.tagline,
    palette:Object.freeze({...identity.palette}),
    landmark:Object.freeze({...identity.landmark})
  });
}
export function spatialCityIdentityCss(cityId){
  const identity=publicSpatialCityIdentity(cityId);if(!identity)return null;
  const p=identity.palette;
  return Object.freeze({
    '--spatial-bg':p.background,'--spatial-fog':p.fog,'--spatial-ground':p.ground,'--spatial-road':p.road,
    '--spatial-accent':p.accent,'--spatial-secondary':p.secondary
  });
}
