import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const luminance=hex=>{const c=hex.match(/[a-f0-9]{2}/gi).map(x=>parseInt(x,16)/255).map(x=>x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4);return c[0]*0.2126+c[1]*0.7152+c[2]*0.0722;};
const ratio=(a,b)=>(Math.max(luminance(a),luminance(b))+0.05)/(Math.min(luminance(a),luminance(b))+0.05);
test('both approved status colors meet 4.5:1 on table and page backgrounds',()=>{
 const css=readFileSync(new URL('../internal/ui/static/app.css',import.meta.url),'utf8');
 for(const [name,color] of [['healthy','067a55'],['progressing','8a5a00']]) {
  assert.match(css,new RegExp('\\.health-'+name+' \\{ color: #'+color));
  for(const background of ['ffffff','f6f6f4'])assert.ok(ratio(color,background)>=4.5);
 }
 assert.ok(ratio('00aa77','ffffff')<4.5);assert.ok(ratio('bb8800','ffffff')<4.5);
});
