import { createRoot } from 'react-dom/client'
import { App } from './App'
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


void demoRuntime().then(runtime => runtime.startDemo(import.meta.env.VITE_DATA_MODE)).then(() => root.render(<App />)).catch(async (error: unknown) => {
  const { StartupFailure } = await import('./StartupFailure')
  root.render(<StartupFailure error={error} onRecover={async choice => {
    await (await demoRuntime()).recoverDemoStorage(choice)
    root.render(<App />)
  }} />)
})
