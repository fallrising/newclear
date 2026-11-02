import fs from 'node:fs';
import path from 'node:path';

export function textBoundary(workspace, files, target) {
  const root=fs.realpathSync(workspace), allowed=new Set(Object.keys(files).map(n=>path.join(root,'source',n)));
  if(target!==undefined && !Object.hasOwn(files,target))throw Error('Unknown revision target');
  const required=target===undefined?undefined:path.join(root,'source',target);
  let count=0, targetRead=false;
  return (tool,args)=>{
    if (++count>24 || !['read','write'].includes(tool) || !args || typeof args.filePath!=='string')
      throw Error('Only bounded source reads and output.md writes are allowed');
    const targetPath=path.resolve(root,args.filePath);
    if (tool==='read' ? !allowed.has(targetPath) && targetPath!==path.join(root,'output.md') : targetPath!==path.join(root,'output.md'))
      throw Error('File is outside the text task');
    const rel=path.relative(root,targetPath).split(path.sep);let current=root;
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
    if(tool==='read' && targetPath===required)targetRead=true;
    if(tool==='write' && required && !targetRead)throw Error('Read the revision target first');
    if(tool==='write' && (typeof args.content!=='string' || !args.content.trim() || Buffer.byteLength(args.content)>65536 || args.content.includes('\0')))
      throw Error('Text output must be nonempty and bounded');
    args.filePath=targetPath;
  };
}
