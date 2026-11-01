import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
function scenario({originalFocus=true,moved=false,present=true,disabled=false,catalog=true}={}) {
 const source=readFileSync(new URL('../internal/ui/templates/layout.html',import.meta.url),'utf8');
 const script=source.match(/<script id="catalog-action-focus">([\s\S]*?)<\/script>/)?.[1];assert.ok(script,'catalog focus handler is required');
 const listeners={};const body={};let calls=0;
 const original={id:'act-hello-toggle',matches:()=>catalog};
 const replacement={disabled,focus:()=>calls++};
 const document={body,activeElement:originalFocus?original:body,addEventListener:(name,handler)=>{listeners[name]=handler;},getElementById:id=>id==='act-hello-toggle'&&present?replacement:null};
 vm.runInNewContext(script,{document,WeakMap});const xhr={};const event={detail:{elt:original,xhr}};
 listeners['htmx:beforeRequest'](event);document.activeElement=moved?{}:body;
 listeners['htmx:afterRequest'](event);listeners['htmx:afterRequest'](event);return calls;
}
test('restore originally focused catalog action once after disabled row replacement',()=>assert.equal(scenario(),1));
test('never steal focus from another element or restore unrelated/missing/disabled action',()=>{
 for(const config of [{originalFocus:false},{moved:true},{present:false},{disabled:true},{catalog:false}])assert.equal(scenario(config),0);
});
