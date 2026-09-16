// Keep the original nodes and event handlers: only their mobile placement changes.
const menu=document.getElementById('cityMobileMenu'),trigger=document.getElementById('openCityMenu');
if(menu&&trigger){
  const media=matchMedia('(max-width:760px), (max-height:500px) and (pointer:coarse)');
  const body=menu.querySelector('.city-mobile-menu-body'),primary=menu.querySelector('.city-mobile-menu-primary');
  const origins=new Map();let compact=false,restoreFocus=true;
  function move(node,target=body){
    if(!node||origins.has(node))return;
    const marker=document.createComment('city-control-position');node.before(marker);origins.set(node,marker);target.append(node);
  }
  function moveLateControls(){
    if(!compact)return;
    move(document.querySelector('.hud .brand .vc-assistant-city-launcher'),primary);
    move(document.getElementById('vitrinySpatialPresenceBadge'));
  }
  function close(restore=true){restoreFocus=restore;if(menu.open)menu.close();}
  function sync(){
    if(compact===media.matches)return;
    compact=media.matches;
    if(compact){
      move(document.getElementById('openExplorationGoal'),primary);
      for(const id of ['cityTools','navigationHelp','cityTravel','cityStats'])move(document.getElementById(id));
      moveLateControls();document.body.classList.add('city-mobile-clean');
    }else{
      close(false);
      for(const [node,marker] of origins){marker.replaceWith(node);}origins.clear();
      document.body.classList.remove('city-mobile-clean');
    }
  }
  trigger.addEventListener('click',()=>{
    restoreFocus=true;dispatchEvent(new CustomEvent('vitriny:hud-open'));
    menu.showModal();trigger.setAttribute('aria-expanded','true');menu.querySelector('[data-city-menu-close]').focus();
  });
  menu.querySelector('[data-city-menu-close]').addEventListener('click',()=>close());
  menu.addEventListener('close',()=>{trigger.setAttribute('aria-expanded','false');if(restoreFocus)trigger.focus({preventScroll:true});});
  menu.addEventListener('cancel',()=>{restoreFocus=true;});
  menu.addEventListener('click',event=>{
    if(event.target!==menu)return;
    const rect=menu.getBoundingClientRect();
    if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)close();
  });
  // Close before the existing action opens its own dialog or starts a conversation.
  menu.addEventListener('click',event=>{
    const action=event.target.closest('button,a');
    if(action&&!action.hasAttribute('data-city-menu-close')&&action.id!=='pauseMotion'&&!action.closest('[data-city-menu-inline]'))close(false);
  },true);
  menu.querySelector('[data-city-menu-chat]').addEventListener('click',()=>{
    const chat=document.querySelector('[data-city-chat] .city-chat');
    if(chat){chat.open=true;chat.querySelector('summary')?.focus();}
    else location.assign('/chat-social.html');
  });
  // The guide can also open the room. Hide its launcher only while the room is closed.
  document.querySelector('[data-city-chat]')?.addEventListener('toggle',event=>{
    if(!compact||!event.target.matches('.city-chat'))return;
    if(event.target.open)dispatchEvent(new CustomEvent('vitriny:hud-open'));
    else if(event.target.contains(document.activeElement))trigger.focus({preventScroll:true});
  },true);
  for(const dialog of document.querySelectorAll('dialog:not(#cityMobileMenu)')){
    dialog.addEventListener('close',()=>{if(compact&&!document.querySelector('dialog[open]')&&menu.contains(document.activeElement))trigger.focus({preventScroll:true});});
  }
  const late=new MutationObserver(moveLateControls);
  late.observe(document.body,{childList:true});
  const brand=document.querySelector('.hud .brand');if(brand)late.observe(brand,{childList:true});
  media.addEventListener('change',sync);sync();
}
