import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AlertCircle, Box } from 'lucide-react'
import { App } from './App'
import { Button } from '../components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '../components/ui/dialog'
import { errorDetails } from '../components/shared/states'
import './styles.css'

const root = createRoot(document.getElementById('root')!)

async function demoRuntime() {
  if (import.meta.env.VITE_DATA_MODE === 'demo') return import('../demo/browser')
  throw Object.assign(new Error(import.meta.env.VITE_DATA_MODE
    ? '此版本尚未提供 live API；請使用明確的 demo 模式。'
    : '請明確設定 VITE_DATA_MODE=demo，再啟動應用。'), {
    code: import.meta.env.VITE_DATA_MODE ? 'LIVE_MODE_UNAVAILABLE' : 'DATA_MODE_REQUIRED',
  })
}

function StartupFailure({ error: initialError }: { error: unknown }) {
  const [error, setError] = useState(initialError)
  const [pending, setPending] = useState(false)
  const details = errorDetails(error)
  const recoverable = typeof initialError === 'object' && initialError !== null && 'recoveryAvailable' in initialError && Boolean(initialError.recoveryAvailable)
  const recover = async (choice: 'reset' | 'memory') => {
    setPending(true)
    try { await (await demoRuntime()).recoverDemoStorage(choice); root.render(<App />) }
    catch (nextError) { setError(nextError); setPending(false) }
  }
  return <main className="startup-page recovery-page"><div className="brand"><span className="brand-symbol"><Box size={24} aria-hidden="true" /></span><span className="brand-name">dim-gate</span></div><section className="panel recovery-panel" role="alert"><AlertCircle size={28} aria-hidden="true" /><p className="eyebrow">DEMO WORKSPACE</p><h1>{recoverable ? '示範資料需要恢復' : '目前無法啟動工作台'}</h1><p>{details.message}</p><p className="error-reference"><code>{details.code}</code></p>{recoverable ? <><p>你可以重置保存的示範資料，或先使用暫存記憶體繼續。暫存模式不修改原本的保存資料，重新整理後進度會遺失。</p><div className="recovery-actions"><Button disabled={pending} onClick={() => void recover('memory')}>{pending ? '正在恢復…' : '使用暫存記憶體繼續'}</Button><Dialog><DialogTrigger asChild><Button variant="outline" disabled={pending}>重置保存的示範資料</Button></DialogTrigger><DialogContent><DialogTitle>重置保存的示範資料？</DialogTitle><DialogDescription>目前分頁保存的模擬資料將被初始資料取代。此操作無法復原，也不會影響真實資源。</DialogDescription><div className="dialog-actions"><DialogClose asChild><Button variant="outline" disabled={pending} autoFocus>取消</Button></DialogClose><Button variant="destructive" disabled={pending} onClick={() => void recover('reset')}>確認重置保存資料</Button></div></DialogContent></Dialog></div></> : <><p>本版本只提供明確啟用的 demo 模式；live 連線尚未提供。</p><Button variant="outline" onClick={() => window.location.reload()}>重新載入</Button></>}</section></main>
}

void demoRuntime().then(runtime => runtime.startDemo(import.meta.env.VITE_DATA_MODE)).then(() => root.render(<App />)).catch((error: unknown) => root.render(<StartupFailure error={error} />))
