document.addEventListener('click', event => {
  const link = event.target.closest('a[data-affiliate-id]');
  if (link) fetch('/api/affiliate-click/'+encodeURIComponent(link.dataset.affiliateId), {method:'POST',keepalive:true}).catch(()=>{});
});
