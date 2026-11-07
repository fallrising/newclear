/** SPEC-T006R-shared-capture W09: the review tools the wrapper and capture.mjs resolve, checked from one root so a test can resolve them the same way. */
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
export const versions=Object.freeze({playwright:'1.63.0',axePlaywright:'4.13.0'});
// capture.mjs loads these through PLAYWRIGHT_MODULE and AXE_PLAYWRIGHT_MODULE.
export const modulePaths=root=>({playwright:root+'/playwright/index.mjs',axePlaywright:root+'/@axe-core/playwright/dist/index.mjs'});
const version=path=>JSON.parse(readFileSync(path,'utf8')).version;
export function reviewTools(root){
 // Read package.json files directly: @axe-core/playwright exports only '.', so require('<pkg>/package.json') throws ERR_PACKAGE_PATH_NOT_EXPORTED (capture-001).
 const found={playwright:version(root+'/playwright/package.json'),axePlaywright:version(root+'/@axe-core/playwright/package.json')};
 for(const[name,expected]of Object.entries(versions))if(found[name]!==expected)throw Error('REVIEW_TOOL_DRIFT_'+name.toUpperCase());
 const {wsServer}=createRequire(root+'/playwright/package.json')('playwright-core/lib/utilsBundle');if(typeof wsServer!=='function')throw Error('REVIEW_TOOL_WS_SERVER');
 return {versions:found,WebSocketServer:wsServer,modules:modulePaths(root)};
}
