export const AFFILIATE_CENTERS=Object.freeze([
  {id:'mercadolivre',name:'Mercado Livre',title:'Mercado Livre',color:'#ffe600',brandBackground:'#ffe600',logo:'mercadolivre.png',logoRatio:446/114,logoCrop:{x:77/600,y:63/240,width:446/600,height:114/240},height:32,description:'Encontre escolhas para sua casa, trabalho e dia a dia.'},
  {id:'shopee',name:'Shopee',title:'Shopee Center',color:'#ee4d2d',brandBackground:'#fff9f4',logo:'shopee.svg',logoRatio:3.15,height:34,description:'Um shopping de descobertas, organizado por departamento.'},
  {id:'cakto',name:'Cakto',title:'Cakto',color:'#45ce86',brandBackground:'#002813',logo:'cakto.png',logoRatio:4.125,height:42,description:'Explore produtos e soluções dos nossos produtores afiliados.'},
  {id:'kiwify',name:'Kiwify',title:'Kiwify',color:'#00b074',brandBackground:'#f5fff7',logo:'kiwify.png',logoRatio:3.64,height:36,description:'Conheça conteúdos, ferramentas e novas possibilidades.'},
  {id:'tiktok',name:'TikTok Shop',title:'TikTok Shop',color:'#fe2c55',brandBackground:'#101115',logo:'tiktok.svg',logoRatio:160/30,height:39,description:'Descubra produtos da nossa seleção no TikTok Shop, organizados por departamento.'}
].map(item=>Object.freeze({...item,logo:`/assets/affiliate-brands/${item.logo}`,href:`/centros/${item.id}`})));
export function affiliateCenter(id){return AFFILIATE_CENTERS.find(item=>item.id===id)||null;}
export function intersectsCommerceAvenue(item){
  const {x,z}=item.position,{width,depth}=item.size,angle=Number(item.rotationY)||0;
  const halfWidth=(Math.abs(Math.cos(angle))*width+Math.abs(Math.sin(angle))*depth)/2;
  const halfDepth=(Math.abs(Math.sin(angle))*width+Math.abs(Math.cos(angle))*depth)/2;
  return x+halfWidth>-252&&x-halfWidth<-80&&z+halfDepth>-155&&z-halfDepth<260;
}
