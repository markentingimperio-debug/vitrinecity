import {toLegacyPublicPath} from './vitriny-public-routes.js';
const MEMBER_PAGES=new Set(['vitriny-games','vitriny-mini-fazenda','vitriny-music-arena','vitriny-cinema','central-creditos']);
const CITY_VISIT_PAGES=new Set(['cidade','vitriny-multiverse-explore','vitriny-multiverse-preview','vitriny-multiverse-district','vitriny-multiverse-food','vitriny-multiverse-creator','vitriny-multiverse-entertainment','vitriny-multiverse-business','vitriny-store-interior']);
function normalizedPage(path){return toLegacyPublicPath(decodeURIComponent(String(path)).toLowerCase().replace(/\\/g,'/').replace(/\/+/g,'/').replace(/\/+$/,'')).replace(/^\//,'').replace(/\.html$/,'');}
// Visiting the city is public; personal activities keep their account gate.
export function memberPage(path){try{return MEMBER_PAGES.has(normalizedPage(path));}catch{return false;}}
function allowedReturnPage(path){try{const page=normalizedPage(path);return MEMBER_PAGES.has(page)||CITY_VISIT_PAGES.has(page)||/^v\/br\/go(?:\/|$)/.test(page);}catch{return false;}}
export function memberReturn(value){try{const raw=String(value||'');if(!raw.startsWith('/')||raw.startsWith('//')||/[\\\s]/.test(raw)||/%(?:0[ad]|5c)/i.test(raw))return '/vitriny-multiverse-explore.html?city=vitrine-city';const url=new URL(raw,'https://vitrinecity.com');return url.origin==='https://vitrinecity.com'&&allowedReturnPage(url.pathname)?url.pathname+url.search+url.hash:'/vitriny-multiverse-explore.html?city=vitrine-city';}catch{return '/vitriny-multiverse-explore.html?city=vitrine-city';}}
