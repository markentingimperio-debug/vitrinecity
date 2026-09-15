import {createResidentCatalog,STUDIO_CHANNELS} from './vitriny-city-residents-core.js';

// Accessible directory also works when WebGL fails. No fetch, authentication,
// generated conversation, task dispatch or analytics are initiated here.
export function installCityResidents({document:doc=document,events=window}={}){
  let catalog=createResidentCatalog(),selectedId=catalog.residents[0].id,opener=null,restoreFocus=true,sceneReady=doc.documentElement.dataset.cityGuideReady==='true',lite=false;
  const element=(tag,text,className)=>{const node=doc.createElement(tag);if(text)node.textContent=text;if(className)node.className=className;return node;};
  const dialog=element('dialog',null,'city-residents');dialog.id='cityResidents';dialog.setAttribute('aria-labelledby','cityResidentsTitle');
  const header=element('header'),heading=element('div'),eyebrow=element('small','PESSOAS VIRTUAIS · VITRINECITY');
  const title=element('h2','Conheça os moradores');title.id='cityResidentsTitle';
  const close=element('button','Fechar');close.type='button';close.setAttribute('aria-label','Fechar moradores da cidade');
  heading.append(eyebrow,title);header.append(heading,close);
  const notice=element('p','Personagens fixos da cidade. Aparências, deslocamentos e falas são simulados; não representam visitantes conectados ou trabalho executado.','residents-notice');
  const filters=element('div',null,'residents-filters'),deptLabel=element('label','Prédio ou departamento'),select=element('select');select.id='residentsDepartment';deptLabel.htmlFor=select.id;
  const personLabel=element('label','Pessoa virtual'),personSelect=element('select');personSelect.id='residentsPerson';personLabel.htmlFor=personSelect.id;
  filters.append(deptLabel,select,personLabel,personSelect);
  const profile=element('section',null,'resident-profile');profile.setAttribute('aria-labelledby','residentName');
  const portrait=element('div',null,'resident-portrait');portrait.setAttribute('aria-hidden','true');portrait.append(element('i',null,'resident-head'),element('i',null,'resident-shirt'));
  const bio=element('div',null,'resident-bio'),name=element('h3');name.id='residentName';const profession=element('p'),building=element('p',null,'resident-building');bio.append(name,profession,building);profile.append(portrait,bio);
  const description=element('p',null,'resident-description');
  const status=element('section',null,'resident-task');status.append(element('h3','Atividade operacional'));
  const task=element('p'),taskHelp=element('p','Conexão de tarefas ainda não disponível nesta visualização. O personagem não está executando nem aprendendo com os conteúdos automaticamente.');status.append(task,taskHelp);
  const actions=element('div',null,'resident-actions'),visit=element('button','Ver na cidade'),content=element('a','Consultar conteúdo →');visit.type='button';content.className='resident-primary';
  const chat=element('button','Conversar · simulação');chat.type='button';chat.setAttribute('aria-controls','residentSpeech');chat.setAttribute('aria-expanded','false');actions.append(content,visit,chat);
  const speech=element('p',null,'resident-speech');speech.id='residentSpeech';speech.setAttribute('role','status');speech.hidden=true;
  const channels=element('nav',null,'resident-channels');channels.setAttribute('aria-label','Unidades do estúdio e canais oficiais');
  for(const channel of STUDIO_CHANNELS){const a=element('a',`${channel.name} ↗`);a.href=channel.href;a.target='_blank';a.rel='noopener noreferrer';a.setAttribute('aria-label',`${channel.name}, abre em nova aba`);channels.append(a);}
  const admin=element('details',null,'resident-admin'),adminLink=element('a','Abrir gestão autorizada →');admin.append(element('summary','Área da equipe'),element('p','A administração continua exigindo uma conta autorizada. Este diretório não concede acesso.'),adminLink);
  const footer=element('p',null,'residents-footer');footer.setAttribute('role','status');
  dialog.append(header,notice,filters,profile,description,status,actions,speech,channels,admin,footer);doc.body.append(dialog);
  function populateDepartments(){
    const previous=select.value;select.replaceChildren();
    for(const d of catalog.departments){const option=element('option',d.name);option.value=d.id;select.append(option);}
    select.value=catalog.departments.some(d=>d.id===previous)?previous:catalog.departments[0].id;
    populatePeople();
  }
  function populatePeople(){
    const people=catalog.residents.filter(p=>p.departmentId===select.value);personSelect.replaceChildren();
    for(const p of people){const option=element('option',`${p.name} · ${p.profession}`);option.value=p.id;personSelect.append(option);}
    personSelect.value=people.some(p=>p.id===selectedId)?selectedId:people[0]?.id||'';render();
  }
  function render(){
    const p=catalog.residents.find(p=>p.id===personSelect.value);if(!p)return;selectedId=p.id;
    const d=catalog.departments.find(d=>d.id===p.departmentId);
    name.textContent=p.name;profession.textContent=p.profession;building.textContent=d.name;description.textContent=d.description;task.textContent=p.taskLabel;
    portrait.style.setProperty('--resident-skin',p.appearance.skinColor);portrait.style.setProperty('--resident-outfit',p.appearance.outfitColor);portrait.dataset.variant=String(p.appearance.variant);
    content.href=d.href;adminLink.href=d.adminHref;visit.disabled=!sceneReady;visit.title=sceneReady?'Localizar a pessoa virtual no prédio':'Navegação 3D ainda indisponível';
    channels.hidden=d.id!=='studio';speech.hidden=true;speech.textContent='';chat.setAttribute('aria-expanded','false');
    footer.textContent=`${catalog.residents.length} personagens no catálogo · não é uma contagem de pessoas online. ${sceneReady?`Até ${lite?16:40} exibidos em 3D por vez; qualquer pessoa do catálogo pode ser selecionada.`:'O catálogo funciona mesmo sem a navegação 3D.'}`;
  }
  function open(source){restoreFocus=true;opener=source||doc.activeElement;events.dispatchEvent(new CustomEvent('vitriny:hud-open'));if(!dialog.open)dialog.showModal();close.focus();}
  const triggers=[];
  for(const [parent,id,className] of [[doc.querySelector('#cityTools .view-controls'),'openCityResidents',''],[doc.querySelector('#loading>div'),'loadingResidents','city-guide-open']]){
    if(!parent)continue;const button=element('button','Moradores e agentes',className);button.id=id;button.type='button';button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-controls',dialog.id);button.addEventListener('click',()=>open(button));parent.append(button);triggers.push(button);
  }
  close.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{if(!restoreFocus)return;const target=opener?.offsetParent?opener:doc.getElementById('openCityMenu');target?.focus({preventScroll:true});});
  select.addEventListener('change',populatePeople);personSelect.addEventListener('change',render);
  chat.addEventListener('click',()=>{const p=catalog.residents.find(p=>p.id===selectedId);speech.textContent=`Fala simulada de ${p.name}: “${p.line}”`;speech.hidden=false;chat.setAttribute('aria-expanded','true');});
  visit.addEventListener('click',()=>{if(!sceneReady)return;restoreFocus=false;dialog.close();events.dispatchEvent(new CustomEvent('vitriny:resident-visit',{detail:{residentId:selectedId}}));});
  const onCatalog=event=>{catalog=createResidentCatalog(Array.isArray(event.detail?.stores)?event.detail.stores:[]);populateDepartments();};
  const onReady=event=>{sceneReady=event.detail?.ready===true;lite=event.detail?.profileId==='LITE';render();};
  events.addEventListener('vitriny:residents-catalog',onCatalog);events.addEventListener('vitriny:residents-ready',onReady);
  populateDepartments();
  return {open,dialog,destroy(){events.removeEventListener('vitriny:residents-catalog',onCatalog);events.removeEventListener('vitriny:residents-ready',onReady);dialog.remove();triggers.forEach(t=>t.remove());}};
}

if(typeof document!=='undefined'&&document.getElementById('cityTools'))installCityResidents();
