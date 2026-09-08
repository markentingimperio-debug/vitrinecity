import test from 'node:test';
import assert from 'node:assert/strict';
import {createStoryImagePicker} from '../public/admin-web-story-images.js';

// Minimal DOM fixture exercises dialog, selection and racing requests without a browser dependency.
function fakeDocument(){
  const doc={activeElement:null,createElement(tag){return new Element(tag,doc);}};
  class Element{
    constructor(tag,document){this.tagName=tag;this.document=document;this.children=[];this.listeners={};this.attrs={};this.isConnected=true;this.open=false;this.value='';}
    setAttribute(key,value){this.attrs[key]=value;}
    append(...elements){this.children.push(...elements);}
    replaceChildren(...elements){this.children=elements;}
    addEventListener(type,fn){(this.listeners[type]||=[]).push(fn);}
    dispatch(type){for(const fn of this.listeners[type]||[])fn({preventDefault(){}});}
    focus(){this.document.activeElement=this;}
    showModal(){this.open=true;}
    close(){if(this.open){this.open=false;this.dispatch('close');}}
    remove(){this.isConnected=false;}
  }
  doc.body=new Element('body',doc);return doc;
}
const walk=el=>[el,...el.children.flatMap(walk)];
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const sample={url:'/assets/recipes/bolo-cenoura.jpg',title:'Bolo de cenoura',alt:'Bolo de cenoura',category:'Receitas',width:1200,height:675};
test('visual picker presents a named thumbnail, selects it, and applies to all only after explicit choice',async()=>{
  const document=fakeDocument(),picker=createStoryImagePicker({document,api:async()=>({items:[sample],page:1,pages:1})}),pending=picker.open({articleId:'published'});
  await tick();const dialog=document.body.children[0],nodes=walk(dialog),item=nodes.find(el=>el.className==='image-library-item');
  assert.equal(item.attrs['aria-label'],'Escolher Bolo de cenoura');assert.equal(item.children[0].src,sample.url);
  assert.equal(nodes.find(el=>el.type==='checkbox').checked,false);
  nodes.find(el=>el.type==='checkbox').checked=true;item.dispatch('click');
  assert.deepEqual(await pending,{...sample,allPages:true});assert.equal(dialog.open,false);picker.destroy();
});
test('closing and reopening aborts the previous lookup and ignores its delayed response',async()=>{
  const document=fakeDocument(),calls=[],picker=createStoryImagePicker({document,api:(url,options)=>new Promise(resolve=>calls.push({url,options,resolve}))});
  const first=picker.open({articleId:'first'});const dialog=document.body.children[0];dialog.close();assert.equal(await first,null);assert.equal(calls[0].options.signal.aborted,true);
  const second=picker.open({articleId:'second'});calls[1].resolve({items:[sample],page:1,pages:1});await tick();calls[0].resolve({items:[{...sample,title:'Resposta antiga'}],page:1,pages:1});await tick();
  assert.ok(!walk(dialog).some(el=>el.textContent==='Resposta antiga'));assert.ok(walk(dialog).some(el=>el.textContent==='Bolo de cenoura'));
  dialog.close();assert.equal(await second,null);picker.destroy();
});
test('an empty library offers a useful status and closing never selects an image',async()=>{
  const document=fakeDocument(),picker=createStoryImagePicker({document,api:async()=>({items:[],page:1,pages:1})}),pending=picker.open();await tick();
  const dialog=document.body.children[0];assert.ok(walk(dialog).some(el=>el.textContent?.includes('Nenhuma imagem compatível')));dialog.close();assert.equal(await pending,null);picker.destroy();
});
