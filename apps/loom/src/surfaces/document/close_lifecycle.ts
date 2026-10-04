export interface CloseSnapshot {
  generation: number;
  revision: number;
  version: number;
  dirty: boolean;
  busy: boolean;
  canSave: boolean;
}
export interface ClosePrompt { saving: boolean; message: string }

/** A close intent belongs to one mounted surface, and can be revoked. */
export class DocumentCloseLifecycle {
  state: ClosePrompt | null = null;
  constructor(
    private readonly snapshot: () => CloseSnapshot,
    private readonly save: () => Promise<boolean>,
    private readonly remove: () => void,
    private readonly changed: (state: ClosePrompt | null) => void,
    private readonly ownsDocument: () => boolean = () => true,
  ) {}
  private active = true;
  private intent: object | null = null;
  private current() { return this.active && this.ownsDocument(); }
  private update(state: ClosePrompt | null) { this.state = state; this.changed(state); }
  private approve() {
    if (!this.current()) return;
    this.active = false;
    this.intent = null;
    this.update(null);
    this.remove();
  }
  request() {
    if (!this.current() || this.state) return;
    const current = this.snapshot();
    if (!current.dirty && !current.busy) { this.approve(); return; }
    this.intent = {};
    this.update({ saving: false, message: current.busy
      ? "A document operation is pending. Cancel to keep it open, or explicitly discard. Submitted writes cannot be undone."
      : "This document has unsaved changes. Save before closing, discard changes, or cancel." });
  }
  cancel() {
    if (!this.current()) return;
    this.intent = null;
    this.update(null);
  }
  discard() { if (this.state) this.approve(); }
  async saveAndClose() {
    if (!this.current() || !this.state || this.state.saving) return;
    const before = { ...this.snapshot() };
    if (before.busy || !before.canSave) {
      this.update({ saving: false, message: before.busy
        ? "Wait for the pending document operation before saving, or Cancel or Discard changes."
        : "This document cannot currently be saved. Resolve the missing file or load error, or Cancel or Discard changes." });
      return;
    }
    const intent = this.intent;
    this.update({ saving: true, message: "Saving before close… Cancel keeps the document open; Discard removes it. Submitted writes cannot be undone." });
    let written = false;
    let failure = "Could not save. Resolve the save error or conflict and try again; the document remains open.";
    try { written = await this.save(); }
    catch (error) { failure = `Could not save: ${String(error)}. The document remains open.`; }
    if (!this.current() || this.intent !== intent) return;
    const after = this.snapshot();
    if (written && after.generation === before.generation && after.revision === before.revision
      && after.version === before.version && !after.dirty && !after.busy && after.canSave) {
      this.approve(); return;
    }
    const message = !written ? failure
      : after.version !== before.version || after.dirty ? "Newer edits were made while saving. The document remains open; save again or Cancel or Discard changes."
      : after.generation !== before.generation || after.revision !== before.revision ? "The document changed while saving. Review it before closing."
      : "Another document operation is pending or the file is unavailable. The document remains open.";
    this.update({ saving: false, message });
  }
  dispose() { this.active = false; this.intent = null; this.state = null; }
}
