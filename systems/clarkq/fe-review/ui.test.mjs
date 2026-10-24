import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const html=await readFile(new URL('../internal/ui/index.html',import.meta.url),'utf8');
const refresh=html.match(/  async function refreshQueues\(\) \{([\s\S]*?)\n  async function refreshMetrics/)[1];
function scene(beforeResponse=()=>{}) {
  const document={body:{id:'body'},activeElement:null};
  document.activeElement=document.body;
  let markup='';
  const wrap={buttons:[],contains(el){return this.buttons.includes(el);},querySelectorAll(){return this.buttons;},
    set innerHTML(value){
      if(this.contains(document.activeElement))document.activeElement=document.body;
      markup=value;
      this.buttons=[...value.matchAll(/data-act="([^"]+)" data-q="([^"]+)"/g)].map(([,act,q])=>({
        getAttribute(name){return name==='data-act'?act:name==='data-q'?q:null;},
        addEventListener(){},focus(){document.activeElement=this;},
      }));
    }, get innerHTML(){return markup;}};
  wrap.innerHTML='<button data-act="use" data-q="review_00"></button>';
  const context=vm.createContext({document,$:()=>wrap,api:async()=>{beforeResponse(document);return {data:{queues:[{name:'review_00',depth:2}]}};},esc:String,doDeq(){},doClr(){},log(){}});
  vm.runInContext('async function refreshQueues(){'+refresh+'\nthis.refreshQueues=refreshQueues;',context);
  return {document,wrap,run:context.refreshQueues};
}
test('five-second list replacement preserves the focused queue/action after depth changes',async()=>{
  const s=scene();s.document.activeElement=s.wrap.buttons[0];
  await s.run();
  assert(s.wrap.buttons.includes(s.document.activeElement),'focused control must belong to refreshed table');
  assert.equal(s.document.activeElement.getAttribute('data-q'),'review_00');
  assert.equal(s.document.activeElement.getAttribute('data-act'),'use');
  assert.match(s.wrap.innerHTML,/<td>2<\/td>/);
});
test('refresh never steals focus moved outside the table while API was pending',async()=>{
  const external={id:'qBody'};const s=scene(document=>{document.activeElement=external;});
  s.document.activeElement=s.wrap.buttons[0];await s.run();assert.equal(s.document.activeElement,external);
});
function luminance(hex){
  const values=hex.match(/\w\w/g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);
  return values[0]*.2126+values[1]*.7152+values[2]*.0722;
}
test('normal primary button text contrast is at least 4.5:1',()=>{
  const vars=Object.fromEntries([...html.matchAll(/--([a-z]+):\s*#([a-f0-9]{6});/g)].map(([,key,value])=>[key,value]));
  const block=html.match(/\n  button \{([\s\S]*?)\}/)[1];
  const value=block.match(/background:\s*([^;]+);/)[1];
  const bg=value.startsWith('var(')?vars[value.match(/--([a-z]+)/)[1]]:value.slice(1);
  const levels=[luminance(vars.text),luminance(bg)].sort((a,b)=>b-a);
  assert((levels[0]+.05)/(levels[1]+.05)>=4.5,'primary button text contrast below AA');
});
test('JSON/log scroll regions can be reached and identified by keyboard',()=>{
  for(const id of ['metrics','cluster','log']) {
    const tag=html.match(new RegExp('<pre\\b[^>]*id="'+id+'"[^>]*>'))[0];
    assert.match(tag,/tabindex="0"/);assert.match(tag,/aria-label="[^"]+"/);
  }
});
