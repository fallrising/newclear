import type {Sample} from '../../contracts/types.ts';
export function Chart({samples}:{samples:Sample[]}) {
  const start=samples.length?Date.parse(samples[0].observed_at):0;
  const end=samples.length?Date.parse(samples[samples.length-1].observed_at):start+1;
  const points:{path:string;key:number}[]=[]; let path='',previous:number|null=null;
  for(const [i,s] of samples.entries()) {
    const time=Date.parse(s.observed_at),value=s.metrics.cpu_avg_percent;
    if(value===null) {if(path) points.push({path,key:i});path='';previous=null;continue;}
    if(previous!==null && time-previous>90_000) {points.push({path,key:i});path='';}
    const x=36+(time-start)/Math.max(1,end-start)*680,y=140-value*1.15;
    path+=`${path?' L':'M'}${x.toFixed(1)},${y.toFixed(1)}`;previous=time;
  }
  if(path) points.push({path,key:samples.length});
  return <>
    <svg className="chart" viewBox="0 0 750 170" role="img" aria-label="CPU 一分鐘平均使用率歷史圖；缺值和超過 90 秒的缺口不連線">
      {[0,50,100].map(v=><g key={v}><line x1="36" x2="716" y1={140-v*1.15} y2={140-v*1.15} className="grid-line"/><text x="0" y={144-v*1.15}>{v}%</text></g>)}
      {points.map(p=><path key={p.key} d={p.path} className="chart-line"/>)}
      {!!samples.length&&<><text x="36" y="163">{samples[0].observed_at.slice(11,19)} UTC</text><text x="615" y="163">{samples[samples.length-1].observed_at.slice(11,19)} UTC</text></>}
    </svg>
    {!points.length&&<p className="muted">尚無可繪製的 CPU 資料；null 不視為 0。</p>}
  </>;
}
