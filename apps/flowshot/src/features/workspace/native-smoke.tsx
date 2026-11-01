/** Test-only entry: built explicitly by n02-native-smoke.py, never imported by App. */
import {createRoot} from 'react-dom/client';
import {WorkspaceBrowser} from './WorkspaceBrowser';
import {workspaceApi} from './nativeApi';
import {invoke} from '@tauri-apps/api/core';
import {addWorkspaceRoot, createWorkspace, openDocument, readWorkspaceAsset} from '../../generated/contracts/commands';

const rootPath = import.meta.env.VITE_N02_SMOKE_ROOT as string;
const resultPrefix = import.meta.env.VITE_N02_SMOKE_RESULT as string;
const mount = document.getElementById('root');
if (!mount || !rootPath || !resultPrefix) throw new Error('Explicit native smoke configuration required');
const root = createRoot(mount);
function assert(condition: unknown, message: string): asserts condition {if (!condition) throw new Error(message);}
async function until<T>(probe: () => T | null | undefined | false): Promise<T> {
  const deadline = performance.now() + 25_000;
  while (performance.now() < deadline) {const result=probe();if(result)return result;await new Promise(resolve=>setTimeout(resolve,10));}
  throw new Error('Timed out waiting for actual workspace UI');
}
function button(text: string) {return [...document.querySelectorAll('button')].find(node=>node.textContent===text);}
async function sha(bytes: Uint8Array<ArrayBuffer>) {return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
async function run() {
  const workspace=await createWorkspace({name:'Native N02 synthetic workspace'});
  let grantDenied=false;
  try {await addWorkspaceRoot({workspaceId:workspace.id,selectedPath:rootPath});} catch {grantDenied=true;}
  assert(grantDenied,'An unselected root was admitted');
  let opened: Awaited<ReturnType<typeof openDocument>> | undefined;
  root.render(<WorkspaceBrowser api={workspaceApi} chooseDirectory={async()=>{const selection=await invoke<string|null>('plugin:dialog|open',{options:{directory:true,multiple:false,defaultPath:rootPath}});return selection;}} onOpen={async id=>{opened=await openDocument({documentId:id});}}/>);
  (await until(()=>button(`Add root to ${workspace.name}`))).click();
  const expand=await until(()=>document.querySelector<HTMLButtonElement>('button[aria-label^="Expand "]'));
  const started=performance.now();expand.click();
  await until(()=>button('f0499.md'));
  await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
  const interactiveMs=performance.now()-started;
  const count=[...document.querySelectorAll('button')].filter(node=>/^f\d{4}\.md$/.test(node.textContent??'')).length;
  assert(count===500,'First page is not bounded to500 rendered files');
  assert(document.body.textContent?.includes('Large directory'),'Large-directory hint missing');
  (await until(()=>button('f0000.md'))).click();
  const documentResult=await until(()=>opened);
  assert(documentResult.source==='\ufeff# Native smoke\r\n\r\n![pixel](pixel.png)\r\n','Original BOM/CRLF/source changed');
  assert(await sha(new TextEncoder().encode(documentResult.source))===documentResult.observedSourceHash,'Raw source hash mismatch');
  const bytes=await readWorkspaceAsset({sourceDocumentId:documentResult.document.id,href:'pixel.png'});
  assert(bytes instanceof ArrayBuffer,'Asset IPC was not ArrayBuffer');
  const image=document.createElement('img');image.alt='Native binary asset';image.width=48;image.height=48;
  const url=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));
  try {image.src=url;document.body.append(image);await image.decode();assert(image.naturalWidth===1&&image.naturalHeight===1,'Native image did not decode');} finally {URL.revokeObjectURL(url);}
  const result={passed:interactiveMs<500,interactiveMs:Math.round(interactiveMs*100)/100,files:count,grantDenied,rawSource:true,arrayBuffer:true,blobDecoded:true};
  const status=document.createElement('p');status.textContent=JSON.stringify(result);status.id='native-smoke-result';document.body.prepend(status);
  await createWorkspace({name:resultPrefix+JSON.stringify(result)});
}
void run().catch(async error=>{
  const message=String(error).slice(0,120);document.body.append(document.createTextNode(message));
  await createWorkspace({name:resultPrefix+JSON.stringify({passed:false,error:message})});
});
