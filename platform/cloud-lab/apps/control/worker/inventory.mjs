import {capability} from './auth.mjs';
import {Fault,requireThat,id,timestamp,iso,digest,strictJSON,enc} from './protocol.mjs';
import {validateInventory} from '../public/inventory.mjs';

export async function inventory(db,ctx,body,now,method){
 const workspace=id(ctx.grant.policy.workspace_id);
 capability(ctx,method==='GET'?'inventory:read':'inventory:publish');
 const envelope=row=>({schema_version:'cloudlab.inventory-snapshot.v1',workspace_id:workspace,now:iso(now),report:row?strictJSON(enc.encode(row.body)):null,received_at:row?iso(row.received_at):null,digest:row?'sha256:'+row.digest:null});
 async function current(){
  const row=await db.prepare(`SELECT g.id AS authorized,s.* FROM grants g LEFT JOIN inventory_snapshots s ON s.workspace_id=?
   WHERE g.id=? AND g.revision=? AND g.revoked=0`).bind(workspace,ctx.grant.id,ctx.grant.revision).first();
  requireThat(row,403,'SCOPE_DENIED');return row.workspace_id===null?null:row;
 }
 if(method==='GET')return {data:envelope(await current()),status:200};
 let report;try{report=validateInventory(body);}catch{throw new Fault(422,'INVENTORY_INVALID');}
 const observed=timestamp(report.observed_at);requireThat(observed<=now+30000,422,'INVENTORY_FUTURE');
 const raw=JSON.stringify(report),hash=await digest(raw);
 const result=await db.prepare(`INSERT INTO inventory_snapshots(workspace_id,observed_at,received_at,digest,body)
 SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM grants WHERE id=? AND revision=? AND revoked=0)
 ON CONFLICT(workspace_id) DO UPDATE SET observed_at=excluded.observed_at,received_at=excluded.received_at,digest=excluded.digest,body=excluded.body
 WHERE excluded.observed_at>inventory_snapshots.observed_at`).bind(workspace,observed,now,hash,raw,ctx.grant.id,ctx.grant.revision).run();
 // Read back the current winner; a concurrent newer report must never be labelled this upload.
 const row=await current();
 requireThat(row&&row.observed_at===observed&&row.digest===hash,409,'INVENTORY_CONFLICT');
 return {data:envelope(row),status:result.meta.changes===1?201:200};
}
