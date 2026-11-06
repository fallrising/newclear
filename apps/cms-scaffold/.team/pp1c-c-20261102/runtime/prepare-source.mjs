import { prepare, parseArgs, createPreparedNetworks } from '../../../scripts/local/prepare.mjs';
// Root-only fixture setup uses the producer object in this same process.
// The ordinary product prepare CLI and its receipt are unchanged.
try {
  const receipt=await prepare(parseArgs(process.argv.slice(2)),{environment:process.env});
  const networks=await createPreparedNetworks(receipt);
  console.log(JSON.stringify({receipt,networks}));
}catch(error){
  console.log(JSON.stringify({success:false,code:error.code??'SOURCE_PREPARATION_FAILED'}));process.exitCode=1;
}
