import {useEffect,useMemo,useState} from 'react';
import type {DirectoryPage,RootDto,WorkspacePage,WorkspaceDto,DirectoryEntry} from '../../generated/contracts/types';
export interface WorkspaceApi {
  listWorkspaces(request?: {cursor?:string;limit?:number}):Promise<WorkspacePage>;
  createWorkspace(request:{name:string}):Promise<WorkspaceDto>;
  addWorkspaceRoot(request:{workspaceId:string;selectedPath:string}):Promise<RootDto>;
  detachWorkspaceRoot(request:{rootId:string}):Promise<RootDto>;
  listDirectory(request:{rootId:string;relDir:string;cursor?:string}):Promise<DirectoryPage>;
}
export interface WorkspaceBrowserProps {api:WorkspaceApi;chooseDirectory:()=>Promise<string|null>;onOpen:(documentId:string)=>void|Promise<void>}
function FileEntry({entry,onOpen}:{entry:DirectoryEntry;onOpen:WorkspaceBrowserProps['onOpen']}) {
  const [failed,setFailed]=useState(false);
  const [pending,setPending]=useState(false);
  async function open(){if(!entry.documentId)return;setPending(true);setFailed(false);try{await onOpen(entry.documentId);}catch{setFailed(true);}finally{setPending(false);}}
  return <li><button type="button" disabled={entry.unavailable||!entry.documentId||pending} onClick={()=>{void open();}}>{entry.name}</button>{entry.kind==='symlink'&&<span> Symbolic link unavailable</span>}{pending&&<span role="status"> Opening document…</span>}{failed&&<span role="alert"> Document missing or unavailable. <button type="button" onClick={()=>{void open();}}>Retry open {entry.name}</button></span>}</li>;
}
function TreeDirectory({rootId,path,label,api,onOpen}:{rootId:string;path:string;label:string;api:WorkspaceApi;onOpen:WorkspaceBrowserProps['onOpen']}){
 const [expanded,setExpanded]=useState(false);
 const [page,setPage]=useState<DirectoryPage|null>(null);
 const [pending,setPending]=useState(false);
 const [failed,setFailed]=useState(false);
 async function load(cursor?:string){if(pending)return;setPending(true);setFailed(false);try{const next=await api.listDirectory({rootId,relDir:path,...(cursor?{cursor}:{})});setPage(previous=>cursor&&previous?{...next,entries:[...previous.entries,...next.entries]}:next);}catch{setFailed(true);}finally{setPending(false);}}
 function toggle(){const next=!expanded;setExpanded(next);if(next&&!page&&!pending){void load();}}
 return <li><button type="button" aria-expanded={expanded} aria-label={`${expanded?'Collapse':'Expand'} ${label}`} onClick={toggle}>{expanded?'▾':'▸'} {label}</button>{expanded&&<>
  {pending&&<span role="status"> Loading directory…</span>}
  {failed&&<p role="alert">Directory unavailable or changed. <button type="button" onClick={()=>{void load();}}>Retry directory</button></p>}
  {page?.largeDirectory&&<p>Large directory: load another page to see more entries.</p>}
  {!!page?.unsupportedNameCount&&<p>Some filenames cannot be displayed safely.</p>}
  <ul>{page?.entries.map(entry=>entry.kind==='directory'?<TreeDirectory key={entry.relPath} rootId={rootId} path={entry.relPath} label={entry.name} api={api} onOpen={onOpen}/>:<FileEntry key={entry.relPath} entry={entry} onOpen={onOpen}/>)}</ul>
  {page?.nextCursor&&<button type="button" disabled={pending} onClick={()=>{void load(page.nextCursor??undefined);}}>Load more entries</button>}
 </>}</li>;
}
export function WorkspaceBrowser({api,chooseDirectory,onOpen}:WorkspaceBrowserProps){
 const [rows,setRows]=useState<WorkspacePage['entries']>([]);
 const [cursor,setCursor]=useState<string|null>(null);
 const [loading,setLoading]=useState(true);
 const [failed,setFailed]=useState(false);
 const [busy,setBusy]=useState(false);
 const [name,setName]=useState('');
 useEffect(()=>{let active=true;void api.listWorkspaces({}).then(page=>{if(active){setRows(page.entries);setCursor(page.nextCursor);setFailed(false);}},()=>{if(active)setFailed(true);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[api]);
 const groups=useMemo(()=>{const values=new Map<string,{workspace:WorkspaceDto;roots:Map<string,RootDto>}>();for(const row of rows){let value=values.get(row.workspace.id);if(!value){value={workspace:row.workspace,roots:new Map()};values.set(row.workspace.id,value);}if(row.root)value.roots.set(row.root.id,row.root);}return [...values.values()];},[rows]);
 async function load(next?:string){setLoading(true);setFailed(false);try{const page=await api.listWorkspaces(next?{cursor:next}:{});setRows(previous=>next?[...previous,...page.entries]:page.entries);setCursor(page.nextCursor);}catch{setFailed(true);}finally{setLoading(false);}}
 async function action(work:()=>Promise<void>){if(busy)return;setBusy(true);setFailed(false);try{await work();}catch{setFailed(true);}finally{setBusy(false);}}
 function saveRoot(workspace:WorkspaceDto,root:RootDto){setRows(previous=>[...previous.filter(row=>row.root?.id!==root.id),{workspace,root}]);}
 async function add(workspace:WorkspaceDto){const path=await chooseDirectory();if(path)saveRoot(workspace,await api.addWorkspaceRoot({workspaceId:workspace.id,selectedPath:path}));}
 return <section aria-label="Workspaces"><h2>Workspaces</h2>
  <form onSubmit={event=>{event.preventDefault();void action(async()=>{const workspace=await api.createWorkspace({name:name.trim()});setRows(previous=>[...previous,{workspace,root:null}]);setName('');});}}>
   <label>Workspace name <input value={name} onChange={event=>setName(event.target.value)} maxLength={256}/></label><button type="submit" disabled={busy||!name.trim()}>Create workspace</button>
  </form>
  {loading&&<p role="status">Loading workspaces…</p>}
  {failed&&<p role="alert">Workspace operation failed. <button type="button" onClick={()=>{void load();}}>Retry workspaces</button></p>}
  {groups.map(({workspace,roots})=><section key={workspace.id} aria-label={workspace.name}><h3>{workspace.name}</h3><button type="button" disabled={busy} onClick={()=>{void action(()=>add(workspace));}}>Add root to {workspace.name}</button>
   <ul aria-label={`${workspace.name} roots`}>{[...roots.values()].map(root=>root.status==='active'?<li key={root.id}><ul><TreeDirectory rootId={root.id} path="" label={root.displayPath} api={api} onOpen={onOpen}/></ul><button type="button" disabled={busy} onClick={()=>{void action(async()=>saveRoot(workspace,await api.detachWorkspaceRoot({rootId:root.id})));}}>Detach {root.displayPath}</button></li>:<li key={root.id}>Detached: {root.displayPath} <button type="button" disabled={busy} onClick={()=>{void action(()=>add(workspace));}}>Reattach {root.displayPath}</button></li>)}</ul>
   {!roots.size&&<p>No roots yet.</p>}
  </section>)}
  {cursor&&<button type="button" disabled={loading} onClick={()=>{void load(cursor);}}>Load more workspaces</button>}
 </section>;
}
