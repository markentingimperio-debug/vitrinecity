// Compatibility entry point for existing pages. Never infer sales from a URL
// or profile updates. The purchase loader requests consented, approved receipts.
(() => {
  if (!['/meus-cursos.html', '/minha-conta.html', '/pagamento.html'].includes(location.pathname)) return;
  const script = document.createElement('script');
  script.src = '/openai-purchase-events.js?v=verified-20260910';
  script.defer = true; document.head.appendChild(script);
})();
(function(){
  function installNeuralEntry(){
    if(!document.querySelector('.admin-sidebar'))return;
    var path='/admin-vitriny-neural.html';
    var firstGroup=document.querySelector('.admin-sidebar .side-group');
    if(firstGroup&&!firstGroup.querySelector('a[href="'+path+'"]')){
      var link=document.createElement('a');link.href=path;
      var dot=document.createElement('i');dot.className='side-dot';
      link.append(dot,document.createTextNode('Vitriny Neural'));
      var gestora=firstGroup.querySelector('a[href="#ia-gestora"]');
      if(gestora)gestora.insertAdjacentElement('afterend',link);else firstGroup.appendChild(link);
    }
    var grid=document.getElementById('moduleGrid');
    if(grid&&!grid.querySelector('a[href="'+path+'"]')){
      var card=document.createElement('a');card.className='module-card';card.href=path;
      var icon=document.createElement('span');icon.className='module-icon';icon.textContent='VN';
      var tag=document.createElement('span');tag.className='module-tag';tag.textContent='SHADOW';
      var strong=document.createElement('strong');strong.textContent='Vitriny Neural';
      var text=document.createElement('p');text.textContent='IA própria: status, skills, precisão, benchmark e aprendizagem supervisionada.';
      card.append(icon,tag,strong,text);
      var jarvis=grid.querySelector('a[href="/admin-jarvis.html"]');
      if(jarvis)jarvis.insertAdjacentElement('afterend',card);else grid.prepend(card);
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installNeuralEntry);else installNeuralEntry();
})();
