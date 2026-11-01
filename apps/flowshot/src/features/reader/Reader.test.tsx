import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { buildDocumentModel } from '../../lib/document-model';
import { Reader } from './Reader';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function urls() {
  const create = vi.fn(() => 'blob:controlled'); const revoke = vi.fn();
  vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = revoke; });
  return { create, revoke };
}
it('routes headings/documents/external links through explicit click callbacks', () => {
  const onHeading = vi.fn(), onDocument = vi.fn(), onExternal = vi.fn();
  const model = buildDocumentModel('[heading](#x) [doc](../a.md#x) [web](https://example.test) [bad](javascript:x)');
  const { container } = render(<Reader model={model} onHeading={onHeading} onDocument={onDocument} onExternal={onExternal} />);
  expect(onExternal).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('link', { name: 'heading' }));
  fireEvent.click(screen.getByRole('link', { name: 'doc' }));
  fireEvent.click(screen.getByRole('link', { name: 'web' }));
  expect(onHeading).toHaveBeenCalledWith('#x'); expect(onDocument).toHaveBeenCalledWith('../a.md#x'); expect(onExternal).toHaveBeenCalledWith('https://example.test');
  expect(container.querySelector('[href],[src]')).toBeNull();
});
it('loads only local candidates, preserves caption mapping and revokes on replacement/unmount', async () => {
  const { create, revoke } = urls();
  const loadAsset = vi.fn(async () => new Blob(['png'], { type: 'image/png' }));
  const model = buildDocumentModel('![stable caption](images/a.png) ![remote](https://evil/a.png)');
  const { container, rerender, unmount } = render(<Reader model={model} loadAsset={loadAsset} />);
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  const caption = container.querySelector('[data-flowshot-asset]')!;
  expect(caption.textContent).toBe('stable caption');
  expect(caption.querySelector('img')?.getAttribute('aria-hidden')).toBe('true');
  expect(loadAsset).toHaveBeenCalledTimes(1);
  expect(model.canonicalText).toBe('stable caption remote');
  rerender(<Reader model={buildDocumentModel('replacement')} loadAsset={loadAsset} />);
  expect(revoke).toHaveBeenCalledWith('blob:controlled');
  rerender(<Reader model={model} loadAsset={loadAsset} />);
  await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
  unmount(); expect(revoke).toHaveBeenCalledTimes(2);
});
it('disposes stale asynchronous asset results and rejects unsupported MIME', async () => {
  const { create } = urls();
  let resolve!: (blob: Blob) => void;
  const pending = new Promise<Blob>(done => { resolve = done; });
  const loadAsset = vi.fn(() => pending);
  const { rerender } = render(<Reader model={buildDocumentModel('![alt](a.png)')} loadAsset={loadAsset} />);
  rerender(<Reader model={buildDocumentModel('new')} loadAsset={loadAsset} />);
  resolve(new Blob(['x'], { type: 'image/png' }));
  await pending; await Promise.resolve();
  expect(create).not.toHaveBeenCalled();
  rerender(<Reader model={buildDocumentModel('![svg](a.png)')} loadAsset={async () => new Blob(['<svg/>'], { type: 'image/svg+xml' })} />);
  await Promise.resolve(); await Promise.resolve(); expect(create).not.toHaveBeenCalled();
});
it('keeps captions stable for rejected, synchronously thrown and oversized asset results', async () => {
  const { create } = urls();
  const model = buildDocumentModel('![caption](a.png)');
  const loaders = [
    vi.fn(() => Promise.reject(new Error('unavailable'))),
    vi.fn(() => { throw new Error('synchronous loader failure'); }),
    vi.fn(async () => new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: 'image/png' })),
  ];
  const { rerender, container } = render(<Reader model={model} loadAsset={loaders[0]} />);
  for (const loader of loaders) {
    rerender(<Reader model={model} loadAsset={loader} />);
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    await Promise.resolve(); await Promise.resolve();
    expect(container.textContent).toBe('caption'); expect(container.querySelector('img')).toBeNull();
  }
  expect(create).not.toHaveBeenCalled();
});
it('aborts and reloads a replacement model even when HTML is identical', async () => {
  const { create, revoke } = urls();
  let finishOld!: (blob: Blob) => void;
  const old = new Promise<Blob>(done => { finishOld = done; });
  const loader = vi.fn().mockReturnValueOnce(old).mockResolvedValue(new Blob(['new'], { type: 'image/png' }));
  const source = '![same caption](a.png)';
  const { rerender, unmount } = render(<Reader model={buildDocumentModel(source)} loadAsset={loader} />);
  await waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
  const oldSignal = loader.mock.calls[0]![1] as AbortSignal;
  rerender(<Reader model={buildDocumentModel(source)} loadAsset={loader} />);
  await waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
  expect(oldSignal.aborted).toBe(true);
  finishOld(new Blob(['old'], { type: 'image/png' }));
  await old; await Promise.resolve();
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  unmount(); expect(revoke).toHaveBeenCalledTimes(1);
});
