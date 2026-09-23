import type { ReactNode, RefObject } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog'
import { ErrorState } from '../../components/shared/states'

export function MissingServiceChange({ back = '/rd/apps' }: { back?: string }) {
  return <section className="access-state" role="status"><p className="eyebrow">404 · 找不到資料</p><h1>找不到這個服務配置或版本</h1><p>資料可能不存在，或不在目前身分的授權範圍。</p><Button asChild variant="outline"><Link to={back}><ArrowLeft size={16} aria-hidden="true" />返回清單</Link></Button></section>
}

export function ServiceTable({ label, children }: { label: string; children: ReactNode }) {
  return <div className="table-scroll service-table-scroll" tabIndex={0} role="region" aria-label={`${label}，可水平捲動`}>{children}</div>
}

export function ServiceNotice({ children }: { children: ReactNode }) {
  return <p className="service-notice" role="status">{children}</p>
}

export function ServiceConfirmation({ title, description, children, open, pending, committed, reason, onReason, error, onClose, onConfirm, trigger }: {
  title: string; description: string; children: ReactNode; open: boolean; pending: boolean;
  committed: boolean; reason: string; onReason: (reason: string) => void; error: unknown;
  onClose: () => void; onConfirm: () => void; trigger: RefObject<HTMLElement | null>;
}) {
  return <Dialog open={open} onOpenChange={next => { if (!next && !pending) onClose() }}><DialogContent className="service-confirmation"
    onEscapeKeyDown={event => { if (pending) event.preventDefault() }}
    onPointerDownOutside={event => { if (pending) event.preventDefault() }}
    onCloseAutoFocus={event => { event.preventDefault(); if (trigger.current?.isConnected) trigger.current.focus(); else document.getElementById('main-content')?.focus() }}>
    <DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription>
    <form onSubmit={event => { event.preventDefault(); onConfirm() }}>
      <div className="service-confirmation-summary">{children}</div>
      <label>決策／操作理由<textarea required rows={3} minLength={1} maxLength={500} value={reason} disabled={pending || committed} onChange={event => onReason(event.target.value)} /></label>
      {committed && error != null && <ServiceNotice>操作已受理，尚未完成結果讀回。重新讀取會沿用本次結果，不會再次提交操作。</ServiceNotice>}
      {error != null && <ErrorState error={error} title={committed ? '結果尚未讀回' : '操作未完成'} />}
      <div className="service-actions"><Button type="button" variant="outline" disabled={pending} onClick={onClose}>返回</Button><Button type="submit" disabled={pending || !reason.trim()}>{pending ? '正在提交並讀回…' : committed ? '重新讀取結果' : '確認操作'}</Button></div>
    </form>
  </DialogContent></Dialog>
}
