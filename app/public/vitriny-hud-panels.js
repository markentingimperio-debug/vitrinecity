// The information panels remain usable even if the 3D engine cannot start.
const key='vitriny_hud_panels_v1',panels=[...document.querySelectorAll('[data-hud-panel]')];
let preferences={};try{preferences=JSON.parse(localStorage.getItem(key)||'{}')||{};}catch{}
if(typeof preferences!=='object'||Array.isArray(preferences))preferences={};
for(const panel of panels){
  panel.open=preferences[panel.id]===true;
  const summary=panel.querySelector(':scope > summary'),indicator=summary.querySelector('[data-panel-indicator]'),name=panel.dataset.hudPanel;
  function update(){summary.setAttribute('aria-label',`${panel.open?'Minimizar':'Expandir'} ${name}`);if(indicator)indicator.textContent=panel.open?'−':'+';preferences[panel.id]=panel.open;try{localStorage.setItem(key,JSON.stringify(preferences));}catch{}}
  update();panel.addEventListener('toggle',update);
  if(panel.id==='cityTools')panel.addEventListener('click',event=>{if(event.target.closest('button'))panel.open=false;});
}
