import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {inflateSync} from 'node:zlib';

// SPEC-T006R-m2-repair M2-01..03, against the actual served index.html and p0.css.
const web=name=>readFileSync(new URL('../apps/control-plane/web/'+name,import.meta.url),'utf8');
const html=web('index.html'),css=web('p0.css');
const rules=[...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(m=>({selectors:m[1].split(',').map(s=>s.trim()),body:m[2]}));
const prop=(body,name)=>body.match(new RegExp('(?:^|;|\\s)'+name+':\\s*([^;]+);'))?.[1].trim();
// Last declaration wins among rules whose selector list contains the exact selector.
const declared=(selector,name)=>rules.filter(r=>r.selectors.includes(selector)).map(r=>prop(r.body,name)).filter(Boolean).at(-1);
const tag=id=>{const m=html.match(new RegExp('<[a-z0-9]+[^>]*\\sid="'+id+'"[^>]*>'));assert(m,id);return m[0];};
const attr=(t,name)=>t.match(new RegExp('\\s'+name+'="([^"]*)"'))?.[1];

test('M2-01 monospace verification text can wrap inside its card',()=>{
 assert.equal(declared('.mono','overflow-wrap'),'anywhere');
 assert.match(tag('verification-url'),/class="mono"/);
});

test('M2-02 event and diff scroll regions are focusable, named by headings and not live',()=>{
 for(const[id,heading,text]of[['event-list','activity-heading','Ordered activity'],['diff-output','diff-heading','Final diff']]){
  const t=tag(id);
  assert.equal(attr(t,'tabindex'),'0',id);
  assert.equal(attr(t,'role'),'region',id);
  assert.equal(attr(t,'aria-labelledby'),heading,id);
  assert.equal(attr(t,'aria-live'),undefined,id);
  assert.match(html,new RegExp('<h3 id="'+heading+'">'+text+'</h3>'));
 }
 assert.doesNotMatch(css,/outline:\s*(none|0)/);
});

// WCAG 2.x relative luminance and contrast.
const hex=h=>{const v=h.replace('#','');return [0,2,4].map(i=>parseInt(v.slice(i,i+2),16));};
const over=(fg,alpha,bg)=>fg.map((c,i)=>c*alpha+bg[i]*(1-alpha));
const lum=rgb=>{const [r,g,b]=rgb.map(c=>{c/=255;return c<=0.03928?c/12.92:((c+0.055)/1.055)**2.4;});return 0.2126*r+0.7152*g+0.0722*b;};
const ratio=(a,b)=>{const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p);return (x+0.05)/(y+0.05);};
const bodyLight=over([54,161,118],0.16,hex('#0b1713'));
const surfaceLight=over([10,24,19],0.88,bodyLight);

test('M2-03 every text color clears its contrast bound over the lightest possible background',()=>{
 assert.match(css,/radial-gradient\(circle at 80% 0%, rgba\(54, 161, 118, 0\.16\)/);
 assert.match(css,/#07100d 0%, #0b1713 58%, #09110f 100%/);
 assert.equal(declared('.card','background'),'rgba(10, 24, 19, 0.88)');assert.equal(declared('.panel','background'),'rgba(10, 24, 19, 0.88)');
 const color=s=>declared(s,'color');
 const checks=[
  ['root text on body',color(':root'),bodyLight,4.5],
  ['root text on surface',color(':root'),surfaceLight,4.5],
  ['.status on body',color('.status'),bodyLight,4.5],
  ['.error on body',color('.error'),bodyLight,4.5],
  ['.eyebrow on body',color('.eyebrow'),bodyLight,4.5],
  ['.eyebrow on surface',color('.eyebrow'),surfaceLight,4.5],
  ['label on surface',color('label'),surfaceLight,4.5],
  ['.timeline/.diff on surface',color('.diff'),surfaceLight,4.5],
  ['.code on surface',color('.code'),surfaceLight,4.5],
  ['button.secondary on surface',color('button.secondary'),surfaceLight,4.5],
  ['button.danger on surface',color('button.danger'),surfaceLight,4.5],
  ['button.quiet on surface',color('button.quiet'),surfaceLight,4.5],
  ['button on its fill',color('button'),hex(declared('button','background')),4.5],
  ['.pill on its fill',color('.pill'),hex(declared('.pill','background')),4.5],
  ['input text on its fill',color('input'),hex(declared('input','background')),4.5],
 ];
 for(const[name,fg,bg,min]of checks){assert(fg?.startsWith('#'),name);const r=ratio(hex(fg),bg);assert(r>=min,`${name}: ${r.toFixed(2)} < ${min}`);}
 assert.equal(declared('button:disabled','opacity'),'0.45'); // disabled controls: WCAG 1.4.3 exemption
});

// Minimal PNG reader (8-bit RGB/RGBA, filters 0-4) for the rendered cross-check.
function readPNG(buf){
 let pos=8,width,height,type,idat=[];
 while(pos<buf.length){const len=buf.readUInt32BE(pos),kind=buf.toString('ascii',pos+4,pos+8),data=buf.subarray(pos+8,pos+8+len);
  if(kind==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);assert.equal(data[8],8);type=data[9];}
  if(kind==='IDAT')idat.push(data);if(kind==='IEND')break;pos+=12+len;}
 const bpp=type===6?4:type===2?3:0;assert(bpp,'PNG color type');const raw=inflateSync(Buffer.concat(idat)),stride=width*bpp,out=Buffer.alloc(stride*height);
 for(let y=0;y<height;y++){const f=raw[y*(stride+1)],src=raw.subarray(y*(stride+1)+1,(y+1)*(stride+1)),row=out.subarray(y*stride,(y+1)*stride),prev=y?out.subarray((y-1)*stride,y*stride):Buffer.alloc(stride);
  for(let x=0;x<stride;x++){const a=x>=bpp?row[x-bpp]:0,b=prev[x],c=x>=bpp?prev[x-bpp]:0;let v=src[x];
   if(f===1)v+=a;else if(f===2)v+=b;else if(f===3)v+=(a+b)>>1;else if(f===4){const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);v+=pa<=pb&&pa<=pc?a:pb<=pc?b:c;}
   row[x]=v&255;}}
 return {width,height,pixel:(x,y)=>[...out.subarray(y*stride+x*bpp,y*stride+x*bpp+3)]};
}

// Baseline PNGs are private run evidence (not committed); set FE_REVIEW_RUNS to their directory to run this check.
test('M2-03 rendered body pixels lie inside the computed background range',()=>{
 const root=process.env.FE_REVIEW_RUNS?new URL('file://'+process.env.FE_REVIEW_RUNS.replace(/\/?$/,'/')):new URL('runs/',import.meta.url);
 // Prefer the v7 recapture on the repaired source; fall back to the milestone-1 baseline runs.
 const sets=[[['baseline-v7-desktop-001','desktop'],['baseline-v7-tablet-001','tablet'],['baseline-v7-mobile-001','mobile']],[['baseline-desktop-remaining-001','desktop'],['baseline-tablet-001','tablet'],['baseline-mobile-001','mobile']]];
 const runs=sets.find(set=>set.every(([run,size])=>existsSync(new URL(`${run}/screenshots/authenticated-ready__${size}__dark.png`,root))))??[];
 const dark=hex('#07100d');let sampled=0;
 for(const[run,size]of runs){const file=new URL(`${run}/screenshots/authenticated-ready__${size}__dark.png`,root);if(!existsSync(file))continue;
  const png=readPNG(readFileSync(file));
  // Top-left is darkest; top-right is where the radial overlay (circle at 80% 0%) is brightest.
  for(const x0 of [0,png.width-12])for(let y=0;y<12;y++)for(let x=x0;x<x0+12;x++){const p=png.pixel(x,y);for(let i=0;i<3;i++)assert(p[i]>=dark[i]-2&&p[i]<=Math.ceil(bodyLight[i])+2,`${run} (${x},${y}) channel ${i}=${p[i]}`);sampled++;}}
 assert(sampled===0||sampled===3*288);
 if(process.env.FE_REVIEW_RUNS)assert.equal(sampled,3*288,'FE_REVIEW_RUNS set but baseline PNGs missing');
});
