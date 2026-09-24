// kith.draft.<roomId> (FE-23). Storage failures mean "no draft"; never an error on screen.

const PREFIX = "kith.draft.";

export function loadDraft(roomId: string): string {
  try {
    return localStorage.getItem(PREFIX + roomId) ?? "";
  } catch {
    return "";
  }
}

export function saveDraft(roomId: string, text: string): void {
  try {
    if (text === "") localStorage.removeItem(PREFIX + roomId);
    else localStorage.setItem(PREFIX + roomId, text);
  } catch {
    // ignore
  }
}

export function clearAllDrafts(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    // ignore
  }
}
