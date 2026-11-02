import fs from 'node:fs';
import {textBoundary} from './local_text_policy.mjs';

export default async function LocalTextBoundary() {
  const workspace=process.env.LAB_TEXT_WORKSPACE, receipt=process.env.LAB_TEXT_RECEIPT;
  if(!workspace || !receipt)throw Error('Local text receipt missing');
  const data=JSON.parse(fs.readFileSync(receipt,'utf8')),check=textBoundary(workspace,data.files);
  const record=(phase,tool)=>fs.appendFileSync(process.env.LAB_TEXT_LOG,JSON.stringify({phase,tool})+'\n',{mode:0o600});
  return {'tool.execute.before':async(input,output)=>{try{check(input.tool,output.args);}catch(error){record('denied',input.tool);throw error;}record('allowed',input.tool);},
    'tool.execute.after':async(input)=>record('finished',input.tool)};
}
