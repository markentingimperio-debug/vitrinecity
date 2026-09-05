(function(root){
  'use strict';
  function point(lat,lng){
    if(lat==null||lng==null||String(lat).trim()===''||String(lng).trim()==='')return null;
    const a=Number(lat),b=Number(lng);
    return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a)<=90&&Math.abs(b)<=180?`${a},${b}`:null;
  }
  function url({lat,lng,address='',mode='car'}={}){
    if(!['car','motorcycle','bicycle'].includes(mode))return null;
    const coords=point(lat,lng),text=String(address||'').trim().slice(0,500);
    if(!coords&&!text)return null;
    if(mode==='bicycle'){
      const link=new URL('https://www.google.com/maps/dir/');
      link.search=new URLSearchParams({api:'1',destination:coords||text,travelmode:'bicycling'});return link.href;
    }
    const link=new URL('https://waze.com/ul');
    link.search=new URLSearchParams({...coords?{ll:coords}:{q:text},navigate:'yes',utm_source:'vitrinecity'});return link.href;
  }
  function open(destination){const target=url(destination);if(!target)return false;root.location.assign(target);return true;}
  root.VCNavigation={url,point,open};
})(globalThis);
