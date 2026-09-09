import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const files=['admin-intelligence.html','admin-growth.html','admin-metricas-externas.html'];
const id='UCPN5ciXL85GdPGNjpWRIqrA';
class Element {
  constructor(tag){this.tagName=tag;this.children=[];this.textContent='';this.attributes={};}
  append(child){this.children.push(child);}
  replaceChildren(){this.children=[];}
  setAttribute(name,value){this.attributes[name]=value;}
  get text(){return this.textContent+this.children.map(child=>child.text).join('\n');}
}
const htmls=files.map(name=>({name,html:readFileSync(new URL('../public/'+name,import.meta.url),'utf8')}));
for(const {name,html} of htmls){
  const code=html.split('// BEGIN YOUTUBE SCOPE VIEW')[1]?.split('// END YOUTUBE SCOPE VIEW')[0];
  const context=vm.createContext({document:{createElement:tag=>new Element(tag)},Intl});
  vm.runInContext(code,context);
  const render=scope=>{const el=new Element('section');context.renderYouTubeScope(el,scope);return el;};
  test(name+': inline scripts parse and scope is supplied by API',()=>{
    for(const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(script[1]);
    assert.match(html,/id="youtubeScope"[^>]*aria-live="polite"/);
    assert.match(html,/renderYouTubeScope\([^;]+\.youtubeScope\)/);
    assert.match(html,/min-height:44px/);
    assert.match(html,/overflow-wrap:anywhere/);
  });
  test(name+': active channel shows verified scope and excludes previous connections',()=>{
    const el=render({scoped:true,channelId:id,channelTitle:'Agrotécnica',lastSync:{status:'completed',importedCount:135},history:{unscopedContents:34,otherChannelContents:8}});
    assert.match(el.text,/Agrotécnica/);assert.match(el.text,/135 registros/);assert.match(el.text,/42 conteúdos.*fora destes totais/);
    assert.equal(el.children.find(c=>c.tagName==='a').href,'https://www.youtube.com/channel/'+id);
  });
  test(name+': no current-channel sync does not claim success from old history',()=>{
    const el=render({scoped:true,channelId:id,channelTitle:null,lastSync:null,history:{unscopedContents:34}});
    assert.match(el.text,/ainda não foi sincronizado/);assert.doesNotMatch(el.text,/concluída/);
  });
  test(name+': no scope or invalid channel cannot form arbitrary destination',()=>{
    assert.match(render(null).text,/indisponível/);
    const el=render({scoped:true,channelId:'javascript:alert(1)',channelTitle:'Wrong',history:{unscopedContents:34}});
    assert.equal(el.children.some(c=>c.tagName==='a'),false);assert.match(el.text,/ainda não configurado/);
  });
  test(name+': untrusted title remains text and unrelated secrets are never rendered',()=>{
    const title='<img src=x onerror=alert(1)>';
    const el=render({scoped:true,channelId:id,channelTitle:title,apiKey:'DO_NOT_EXPOSE',token:'DO_NOT_EXPOSE',lastSync:{status:'failed'},history:{unscopedContents:'NaN'}});
    assert.equal(el.children.some(c=>c.tagName==='img'),false);assert.match(el.text,/<img src=x/);
    assert.doesNotMatch(JSON.stringify(el),/DO_NOT_EXPOSE/);assert.match(el.text,/não foi concluída/);
  });
}
