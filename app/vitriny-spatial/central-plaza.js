export const CENTRAL_PLAZA_ID='central-plaza';

const DISTRICTS=Object.freeze([
  {id:'commerce',label:'Commerce District',angle:0,path:'/v/br/go/vitrine-city/commerce',kind:'commerce'},
  {id:'social',label:'Social District',angle:45,path:'/v/br/go/vitrine-city/social',kind:'social'},
  {id:'creator',label:'Creator District',angle:90,path:'/v/br/go/vitrine-city/creator',kind:'creator'},
  {id:'food',label:'Food Avenue',angle:135,path:'/v/br/go/vitrine-city/food',kind:'food'},
  {id:'education',label:'Education District',angle:180,path:'/v/br/go/vitrine-city/education',kind:'education'},
  {id:'entertainment',label:'Entertainment District',angle:225,path:'/v/br/go/vitrine-city/entertainment',kind:'entertainment'},
  {id:'business',label:'Business District',angle:270,path:'/v/br/go/vitrine-city/business',kind:'business'},
  {id:'services',label:'Services District',angle:315,path:'/v/br/go/vitrine-city/services',kind:'services'}
]);

export function centralPlazaLayout({radius=92,portalRadius=68}={}){
  const r=Math.max(40,Math.min(240,Number(radius)||92)),pr=Math.max(24,Math.min(r-10,Number(portalRadius)||68));
  const districts=DISTRICTS.map(item=>{
    const rad=item.angle*Math.PI/180;
    return {...item,position:{x:Number((Math.cos(rad)*r).toFixed(3)),y:0,z:Number((Math.sin(rad)*r).toFixed(3))},portal:{x:Number((Math.cos(rad)*pr).toFixed(3)),y:1.5,z:Number((Math.sin(rad)*pr).toFixed(3))}};
  });
  return {
    id:CENTRAL_PLAZA_ID,
    world:{country:'br',region:'go',city:'vitrine-city'},
    theme:'premium-futuristic-biophilic',
    center:{id:'vitriny-neural-core',position:{x:0,y:0,z:0},radius:12},
    districts,
    landmarks:[
      {id:'neural-core',kind:'neural-monument',position:{x:0,y:0,z:0}},
      {id:'water-ring',kind:'water',radius:22},
      {id:'green-ring',kind:'biophilic',radius:36},
      {id:'mobility-ring',kind:'pedestrian-route',radius:52}
    ]
  };
}

export function centralPlazaPortals(){
  return centralPlazaLayout().districts.map(d=>({id:`portal-${d.id}`,label:d.label,from:{country:'br',region:'go',city:'vitrine-city'},to:{country:'br',region:'go',city:'vitrine-city',district:d.id},kind:d.kind}));
}

export const spatialDistricts=DISTRICTS;
