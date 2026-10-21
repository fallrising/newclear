const PREFIX = "kith.capture.v1:";

export type CaptureDraft = {
  version: 1;
  body: string;
  client_key: string;
  phase: "draft" | "unknown" | "conflict" | "saved";
  capture_id?: string;
};

export function newCaptureDraft(): CaptureDraft {
  return { version: 1, body: "", client_key: crypto.randomUUID(), phase: "draft" };
}

export function readCaptureDraft(operatorId: string): { draft: CaptureDraft; failed: boolean } {
  try {
    const raw = localStorage.getItem(PREFIX + operatorId);
    if (raw === null) return { draft: newCaptureDraft(), failed: false };
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) throw new Error("invalid draft");
    const draft = value as Partial<CaptureDraft>;
    if (draft.version !== 1 || typeof draft.body !== "string" || draft.body.length > 16384 ||
        typeof draft.client_key !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(draft.client_key) ||
        !["draft", "unknown", "conflict", "saved"].includes(draft.phase ?? "") ||
        (draft.phase === "saved" && typeof draft.capture_id !== "string")) throw new Error("invalid draft");
    return { draft: draft as CaptureDraft, failed: false };
  } catch {
    return { draft: newCaptureDraft(), failed: true };
  }
}

export function storeCaptureDraft(operatorId: string, draft: CaptureDraft): boolean {
  try {
    localStorage.setItem(PREFIX + operatorId, JSON.stringify(draft));
    return true;
  } catch { return false; }
}

export function removeCaptureDraft(operatorId: string): boolean {
  try {
    localStorage.removeItem(PREFIX + operatorId);
    return true;
  } catch { return false; }
}

/** Account-scoped reads prevent another signed-in member from seeing a leftover draft. */
export function clearCaptureDrafts(): void {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index));
    for (const key of keys) {
      if (key?.startsWith(PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    // Storage can be denied by the browser. Never block session/logout cleanup on it.
  }
}
