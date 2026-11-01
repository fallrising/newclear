import './reader.css';
import { useEffect, useRef } from 'react';
import type { MouseEvent } from 'react';
import { classifyLink, localAssetCandidate } from '../../lib/document-model';
import type { DocumentModel } from '../../lib/document-model';
export interface ReaderProps {
  /** New document context must use a distinct model object or a React key by document UUID. */
  model: DocumentModel;
  onHeading?: (target: string) => void;
  onDocument?: (target: string) => void;
  onExternal?: (target: string) => void;
  loadAsset?: (target: string, signal: AbortSignal) => Promise<Blob>;
}
/** Accept only a model built by the frozen document-model pipeline. */
export function Reader({ model, onHeading, onDocument, onExternal, loadAsset }: ReaderProps) {
  const element = useRef<HTMLElement>(null);
  useEffect(() => {
    const root = element.current;
    if (!root || !loadAsset) return;
    const controller = new AbortController();
    const urls: string[] = [];
    const images: HTMLImageElement[] = [];
    for (const caption of root.querySelectorAll<HTMLElement>('[data-flowshot-asset]')) {
      const target = localAssetCandidate(caption.dataset.flowshotAsset ?? '');
      if (!target) continue;
      void Promise.resolve().then(() => loadAsset(target, controller.signal)).then(blob => {
        if (controller.signal.aborted || !caption.isConnected || blob.size > 10 * 1024 * 1024 || !['image/png','image/jpeg','image/gif','image/webp'].includes(blob.type)) return;
        const url = URL.createObjectURL(blob);
        urls.push(url);
        const image = document.createElement('img');
        image.src = url; image.alt = ''; image.draggable = false;
        image.setAttribute('aria-hidden', 'true'); image.style.userSelect = 'none';
        caption.append(image); images.push(image);
      }).catch(() => { /* An unavailable asset leaves its stable caption visible. */ });
    }
    return () => { controller.abort(); images.forEach(image => image.remove()); urls.forEach(url => URL.revokeObjectURL(url)); };
  }, [model, loadAsset]);
  function click(event: MouseEvent<HTMLElement>) {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLElement>('[data-flowshot-link-kind]');
    if (!button || !event.currentTarget.contains(button)) return;
    event.preventDefault();
    const link = classifyLink(button.dataset.flowshotTarget ?? '');
    if (link.kind !== button.dataset.flowshotLinkKind) return;
    if (link.kind === 'heading') onHeading?.(link.target);
    if (link.kind === 'document') onDocument?.(link.target);
    if (link.kind === 'external') onExternal?.(link.target);
  }
  return <article className="flowshot-reader" ref={element} aria-label="Document reader" onClick={click} dangerouslySetInnerHTML={{ __html: model.html }} />;
}
