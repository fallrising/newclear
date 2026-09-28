import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import type {Envelope,History,NodeView,Snapshot} from '../../contracts/types.ts';
import {snapshot,history,advance,ApiError} from './api';
import {Chart} from './Chart';
import './style.css';

const connectivity={online:'在線',stale:'心跳過期',offline:'離線','never-seen':'尚未上報'};
const health={healthy:'正常',warning:'需關注',unknown:'未確認'};
const percent=(n:number|null|undefined)=>n===null||n===undefined?'不支援':`${n.toFixed(1)}%`;
const time=(s:string|null|undefined)=>s?`${s.slice(0,10)} ${s.slice(11,19)} UTC`:'尚無資料';
function memory(node:NodeView):number|null {
 const m=node.latest?.metrics;
 return m?.memory_total_bytes?Number(BigInt(m.memory_used_bytes!)*10000n/BigInt(m.memory_total_bytes))/100:null;
}
function App() {
 const [path,setPath]=useState(location.pathname),[revision,setRevision]=useState(0),[search,setSearch]=useState('');
 const [data,setData]=useState<Envelope<Snapshot>|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [series,setSeries]=useState<History|null>(null),[historyError,setHistoryError]=useState('');
 const id=path.match(/^\/nodes\/(node_demo(?:0[1-9]|10))$/)?.[1];
 const node=data?.data.nodes.find(n=>n.id===id);
 useEffect(()=>{const fn=()=>setPath(location.pathname);addEventListener('popstate',fn);return()=>removeEventListener('popstate',fn);},[]);
 useEffect(()=>{
   let dead=false,timer:ReturnType<typeof setTimeout>;const controller=new AbortController();
   async function poll() {
     try {const result=await snapshot(controller.signal);if(!dead){setData(result);setError('');}}
     catch(e) {if(!dead){const x=e as ApiError;setError(`${x.status?`HTTP ${x.status} · `:''}${x.message}${x.requestId?` · request ${x.requestId}`:''}`);}}
     finally {if(!dead){setLoading(false);timer=setTimeout(poll,2000);}}
   }
   void poll();return()=>{dead=true;controller.abort();clearTimeout(timer);};
 },[revision]);
 useEffect(()=>{
   if(!id) {setSeries(null);return;}
   const controller=new AbortController();let dead=false;
   void history(id,controller.signal).then(r=>{if(!dead){setSeries(r.data);setHistoryError('');}}).catch(e=>{if(!dead){setSeries(null);setHistoryError(e.message);}});
   return()=>{dead=true;controller.abort();};
 },[id,data?.request_id]);
 function navigate(p:string){window.history.pushState({},'',p);setPath(p);setSeries(null);setHistoryError('');}
 const nodes=(data?.data.nodes??[]).filter(n=>`${n.id} ${n.display_name}`.toLowerCase().includes(search.toLowerCase()));
 const total=data?.data.nodes.length??0;
 async function simulateOffline(){setBusy(true);try{await advance();setRevision(r=>r+1);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <div className="shell">
   <aside className="sidebar"><a className="brand" href="/fleet" onClick={e=>{e.preventDefault();navigate('/fleet');}}><span className="brand-mark">e.</span><span>Edge Ops<small>OPERATIONS WORKSPACE</small></span></a>
     <div className="workspace"><span className="tiny">WORKSPACE</span><strong>Personal lab</strong><span className="muted">ws_demo · 合成節點</span></div>
     <nav aria-label="主導覽"><a className="nav-active" href="/fleet" onClick={e=>{e.preventDefault();navigate('/fleet');}}>▦　主機觀測 <span>{total}</span></a><span className="nav-disabled">≡　日誌 <small>尚未實作</small></span><span className="nav-disabled">▷　作業 <small>未啟用</small></span><span className="nav-disabled">◇　初始化 <small>未啟用</small></span></nav>
     <div className="sidebar-note"><strong>Monitor-only</strong><p>沒有命令通道、root 執行器或真實主機連線。</p></div>
   </aside>
   <main><header className="topbar"><span>控制台 / <b>{node?node.display_name:'主機觀測'}</b></span><span className="mock-pill">MOCK · LOCAL ONLY</span></header>
     <div className="content"><div className="heading"><div><div className="eyebrow">OBSERVABILITY / S0</div><h1>{node?node.display_name:'主機觀測工作台'}</h1><p className="muted">{node?'從一筆樣本追蹤到持久化回執。':'先驗證資料如何流動，再連接真實基礎設施。'}</p></div><button onClick={()=>setRevision(r=>r+1)}>↻ 刷新資料</button></div>
     <div className="notice"><b>模擬的是機器，不是畫面上的 API。</b><span>假 Agent 透過 HTTP 上報；面板只讀後端。身分驗證為 loopback mock，不可部署到公網。</span></div>
     <div className="flow" aria-label="資料鏈路"><span>01 <b>Mock Agent</b></span><i>→</i><span>02 <b>HTTP ingest</b></span><i>→</i><span>03 <b>SQLite / D1 adapter</b></span><i>→</i><span>04 <b>Query API</b></span><i>→</i><span>05 <b>React</b></span></div>
     {error&&<div className="error" role="alert"><strong>後端未確認 · 顯示的舊快照不可視為目前狀態</strong><p>{error}</p><button onClick={()=>setRevision(r=>r+1)}>重試連線</button></div>}
     {loading?<div role="status" className="empty">正在讀取後端快照…</div>:<>
     {!id?<><section className="stats" aria-label="主機摘要"><article><span>已註冊節點</span><strong>{total.toString().padStart(2,'0')}</strong><small>上次成功快照</small></article><article><span>已確認在線</span><strong>{error?'—':(data?.data.nodes.filter(n=>n.connectivity==='online').length??0).toString().padStart(2,'0')}</strong><small>心跳與指標新鮮度分開判斷</small></article><article><span>需要關注</span><strong>{error?'—':(data?.data.nodes.filter(n=>n.health!=='healthy').length??0).toString().padStart(2,'0')}</strong><small>含高負載與資料過期</small></article><article><span>持久化樣本</span><strong>{data?.data.nodes.reduce((sum,n)=>sum+n.sample_count,0)??0}</strong><small>重送不增加樣本數</small></article></section>
     <section className="panel"><div className="panel-title"><h2>節點清單 <small>{total} nodes</small></h2><label className="search">搜尋 <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="名稱或 node ID"/></label></div>
     {!nodes.length?<div className="empty"><h3>{total?'沒有符合的節點':'尚未加入模擬節點'}</h3><p>在專案目錄執行 <code>npm run mock-agent -- seed</code>，由假 Agent 建立資料。</p></div>:<div className="table-wrap"><table><thead><tr><th>節點</th><th>連線 / 健康</th><th>CPU 平均 / 峰值</th><th>記憶體</th><th>磁碟使用</th><th>樣本</th></tr></thead><tbody>{nodes.map(n=><tr key={n.id}><td><a href={`/nodes/${n.id}`} onClick={e=>{e.preventDefault();navigate(`/nodes/${n.id}`);}}>{n.display_name} ↗</a><small>{n.id} · {n.arch}</small></td><td><span className={`badge ${error?'unknown':n.connectivity}`}>{error?'未確認':connectivity[n.connectivity]}</span><small>{error?'API 失聯':health[n.health]}{!n.data_fresh?' · 指標過期':''}</small></td><td><strong>{percent(n.latest?.metrics.cpu_avg_percent)}</strong><small>峰值 {percent(n.latest?.metrics.cpu_max_percent)}</small></td><td>{percent(memory(n))}</td><td>{percent(n.latest?.metrics.disk_used_percent)}</td><td>{n.sample_count}<small>view details →</small></td></tr>)}</tbody></table></div>}
     </section></>:node?<>
       <a href="/fleet" onClick={e=>{e.preventDefault();navigate('/fleet');}}>← 返回節點清單</a>
       <div className="detail-grid"><section className="panel"><div className="panel-title"><h2>CPU 使用率 <small>一分鐘平均</small></h2><span className={`badge ${error?'unknown':node.connectivity}`}>{error?'未確認':connectivity[node.connectivity]}</span></div>{historyError?<p role="alert" className="error">{historyError}</p>:!series?<p className="empty" role="status">讀取歷史資料…</p>:<><Chart samples={series.samples}/><p className="chart-caption">{series.samples.length} 筆 · UTC · {series.truncated?'已截斷，僅顯示最近樣本':'查詢範圍內的樣本'} · 缺值與缺口不補 0</p><details><summary>檢視圖表原始數據</summary><div className="table-wrap"><table><thead><tr><th>Observed UTC</th><th>CPU avg</th><th>Seq</th></tr></thead><tbody>{series.samples.map(s=><tr key={`${s.boot_id}/${s.seq}`}><td>{time(s.observed_at)}</td><td>{percent(s.metrics.cpu_avg_percent)}</td><td>{s.seq}</td></tr>)}</tbody></table></div></details></>}</section>
       <section className="panel detail"><h2>資料回執</h2><dl><dt>資料新鮮度</dt><dd>{error?'未確認':node.data_fresh?'新鮮':'過期 / 尚無資料'}</dd><dt>最後心跳 received</dt><dd>{time(node.last_seen_received_at)}</dd><dt>最新樣本 observed</dt><dd>{time(node.latest?.observed_at)}</dd><dt>最新樣本 received</dt><dd>{time(node.latest?.received_at)}</dd><dt>持久化 request ID</dt><dd className="mono">{node.latest?.request_id??'—'}</dd><dt>Boot / sequence</dt><dd className="mono">{node.latest?.boot_id??'—'} / {node.latest?.seq??'—'}</dd><dt>uint64 RX counter</dt><dd className="mono">{node.latest?.metrics.network_rx_bytes??'不支援'} bytes</dd><dt>主機權限</dt><dd>none · monitor-only</dd></dl></section></div>
     </>:<div className="empty">此節點不存在或尚未註冊。<button onClick={()=>navigate('/fleet')}>返回清單</button></div>}
     </>}
     <section className="panel lab"><div><div className="eyebrow">SCENARIO LAB</div><h2>讓故障狀態也走同一條鏈路</h2><p>CLI 支援 seed、tick、replay、offline、recover、reset。沒有 SSH 或命令下發。</p><code>npm run mock-agent -- recover</code><p className="muted">恢復只讓第一台 mock 節點送出新樣本；其餘節點維持原狀。</p></div><button disabled={busy||!!error||!data} onClick={()=>void simulateOffline()}>{busy?'推進中…':'模擬失聯：前進 4 分鐘'}</button></section>
     <footer><span>{error?'API unavailable':data?'API connected':'API pending'} · HTTP 每 2 秒讀取 · WebSocket 尚未接線</span><span>Server clock: {time(data?.data.server_time)}</span></footer>
     </div>
   </main>
 </div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
