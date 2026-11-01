/** Frontend-only window-close adapter; saving never removes the document. */
export interface WindowCloseParticipant {
  snapshot(): {
    revision: string;
    dirty: boolean;
    busy: boolean;
    canSave: boolean;
  } | null;
  save(): Promise<boolean>;
}
