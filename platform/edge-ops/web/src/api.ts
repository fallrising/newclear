import type {Envelope,History,Snapshot} from '../../backend/src/demo/views.ts';
export class ApiError extends Error {
  status: number;
  requestId: string;
  constructor(message: string,status=0,requestId='') {super(message);this.status=status;this.requestId=requestId;}
}
async function request<T>(path:string,signal?:AbortSignal,body?:unknown):Promise<Envelope<T>> {
  let r:Response;
  try {r=await fetch(path,{method:body===undefined?'GET':'POST',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(5000)]):AbortSignal.timeout(5000),cache:'no-store',headers:{'x-edge-demo-role':body===undefined?'viewer':'operator',...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});}
  catch(e) {if(signal?.aborted) throw e;throw new ApiError('無法連線至後端；沒有切換成前端假資料。');}
  let v;
  try {v=await r.json();} catch {throw new ApiError('後端回應不是有效 JSON',r.status);}
  if(!r.ok) throw new ApiError(v.message??'API 錯誤',r.status,v.request_id??'');
  if(!v || typeof v.request_id!=='string' || !Object.hasOwn(v,'data')) throw new ApiError('API 契約不相容',r.status);
  return v as Envelope<T>;
}
export async function snapshot(signal?:AbortSignal):Promise<Envelope<Snapshot>> {
  const r=await request<Snapshot>('/api/v1/nodes',signal);
  if(r.data.mode!=='demo' || r.data.auth!=='mock-loopback-only' || !Array.isArray(r.data.nodes)) throw new ApiError('未確認 mock 模式；拒絕顯示未知資料源');
  return r;
}
export const history=(id:string,signal?:AbortSignal)=>request<History>(`/api/v1/nodes/${encodeURIComponent(id)}/metrics?limit=120`,signal);
export const advance=()=>request<{server_time:string}>('/demo/v1/clock',undefined,{advance_seconds:240});
