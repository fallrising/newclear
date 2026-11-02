import fs from 'node:fs';
import path from 'node:path';

export function textBoundary(workspace, files) {
  const root=fs.realpathSync(workspace), allowed=new Set(Object.keys(files).map(n=>path.join(root,'source',n)));
  let count=0;
  return (tool,args)=>{
    if (++count>24 || !['read','write'].includes(tool) || !args || typeof args.filePath!=='string')
      throw Error('Only bounded source reads and output.md writes are allowed');
    const target=path.resolve(root,args.filePath);
    if (tool==='read' ? !allowed.has(target) && target!==path.join(root,'output.md') : target!==path.join(root,'output.md'))
      throw Error('File is outside the text task');
    const rel=path.relative(root,target).split(path.sep);let current=root;
    for(const [i,part] of rel.entries()) {
      current=path.join(current,part);
      let stat;
      try{stat=fs.lstatSync(current);}catch(error){
        if(error.code==='ENOENT' && i===rel.length-1 && tool==='write')continue;
        throw error;
      }
      if(stat.isSymbolicLink() || (i<rel.length-1 ? !stat.isDirectory() : !stat.isFile()))throw Error('Unsafe text task path');
      if(i===rel.length-1 && stat.size>65536)throw Error('Text file too large');
    }
    if(tool==='write' && (typeof args.content!=='string' || !args.content.trim() || Buffer.byteLength(args.content)>65536 || args.content.includes('\0')))
      throw Error('Text output must be nonempty and bounded');
    args.filePath=target;
  };
}
