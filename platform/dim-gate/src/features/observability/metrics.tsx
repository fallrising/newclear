import { useId } from 'react'
import type { MetricSeries } from '../../domain/schemas'
import type { ObservationWindow } from '../../api/clients/observability'
import { timestamp } from './shared'

const metricNames: Record<MetricSeries['metric'], string> = { rate: '請求速率', errorRate: '錯誤率', p95Latency: 'p95 延遲' }
const unitNames: Record<MetricSeries['unit'], string> = { 'requests/second': 'req/s', fraction: '%', ms: 'ms' }
const displayValue = (series: MetricSeries, value: number | null) => value === null ? '未知' : `${Number((value * (series.unit === 'fraction' ? 100 : 1)).toFixed(3))} ${unitNames[series.unit]}`

export function MetricChart({ series, window }: { series: MetricSeries; window: ObservationWindow }) {
  const titleId = useId()
  const descId = useId()
  const start = Date.parse(window.from)
  const end = Date.parse(window.to)
  const values = series.points.flatMap(point => point.value === null ? [] : [point.value])
  const maximum = Math.max(...values, 1)
  const x = (t: string) => 42 + (Date.parse(t) - start) / (end - start) * 480
  const y = (value: number) => 150 - value / maximum * 116
  return <section className="panel metric-panel"><h2>{metricNames[series.metric]} <span className="observation-note">{unitNames[series.unit]}</span></h2><p className="observation-note">來源：Demo 合成樣本 · 60 秒 bucket · {series.sampleCount} 筆樣本</p>{series.points.length === 0 ? <p className="observation-empty" role="status">此時間範圍沒有樣本；健康狀態未知。</p> : <><svg className="metric-chart" viewBox="0 0 560 190" role="img" aria-labelledby={`${titleId} ${descId}`}><title id={titleId}>{metricNames[series.metric]}趨勢圖</title><desc id={descId}>橫軸為所選 UTC 時間範圍；縱軸單位 {unitNames[series.unit]}，由 0 至 {displayValue(series, maximum)}。未知或缺少的樣本不連線。精確資料在下方表格。</desc><path d="M42 24V150H522" className="metric-axis" /><text x="38" y="20">{displayValue(series, maximum)}</text><text x="30" y="154" textAnchor="end">0</text>{series.points.map((point, index) => {
    if (point.value === null) return null
    const previous = series.points[index - 1]
    return <g key={point.t}>{previous && previous.value !== null && Date.parse(point.t) - Date.parse(previous.t) === 60000 && <line className="metric-line" x1={x(previous.t)} y1={y(previous.value)} x2={x(point.t)} y2={y(point.value)} />}<circle className="metric-point" cx={x(point.t)} cy={y(point.value)} r="3"><title>{timestamp(point.t)} · {displayValue(series, point.value)}</title></circle></g>
  })}<text x="42" y="180">{new Date(window.from).toISOString().slice(11, 19)}</text><text x="522" y="180" textAnchor="end">{new Date(window.to).toISOString().slice(11, 19)} UTC</text></svg><details className="metric-table"><summary>{metricNames[series.metric]}資料表</summary><div className="table-scroll"><table><caption>{metricNames[series.metric]} · 原始樣本值</caption><thead><tr><th scope="col">Bucket 起點（UTC）</th><th scope="col">數值</th></tr></thead><tbody>{series.points.map(point => <tr key={point.t}><th scope="row"><time dateTime={point.t}>{timestamp(point.t)}</time></th><td>{displayValue(series, point.value)}</td></tr>)}</tbody></table></div></details></>}</section>
}
