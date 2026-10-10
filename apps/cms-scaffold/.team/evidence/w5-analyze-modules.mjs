import { build } from 'vite';
import { resolve, relative } from 'node:path';
import { writeFileSync } from 'node:fs';
const result = [];
for (const app of ['front', 'back', 'admin']) {
  await build({root:resolve(`apps/web-${app}`),configFile:resolve(`apps/web-${app}/vite.config.ts`),logLevel:'silent',build:{write:false},plugins:[{
    name:'w5-read-only-module-analysis',
    generateBundle(_options,bundle) {
      for (const output of Object.values(bundle)) if(output.type==='chunk' && output.isEntry) {
        result.push({app,file:output.fileName,imports:output.imports,modules:Object.entries(output.modules).filter(([,m])=>m.renderedLength>0).map(([id,m])=>({path:(id.startsWith("\0") ? "virtual:" : "") + relative(process.cwd(),id.replace(/^\0/,"")),renderedLength:m.renderedLength})).sort((a,b)=>b.renderedLength-a.renderedLength)});
      }
    }
  }]});
}
writeFileSync('.team/evidence/w5-bundle-modules.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result.map(r=>({...r,modules:r.modules.slice(0,12)})),null,2));
