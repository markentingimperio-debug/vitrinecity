(() => {
  let consent=false;try{consent=localStorage.getItem('vc_analytics_consent')==='accepted';}catch{}
  if(!consent||location.pathname.startsWith('/admin'))return;
  const send=(metric,value)=>fetch('/api/platform-performance',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({consent:true,metric,value}),keepalive:true}).catch(()=>{});
  let errors=0;window.addEventListener('error',()=>{if(errors++<3)send('js_error',1);});
  const load=()=>setTimeout(()=>{const entry=performance.getEntriesByType('navigation')[0];if(entry?.loadEventEnd>0&&entry.loadEventEnd<=60000)send('page_load_ms',Math.round(entry.loadEventEnd));},0);
  if(document.readyState==='complete')load();else window.addEventListener('load',load,{once:true});
})();
