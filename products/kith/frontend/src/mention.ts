export type MentionQuery = { start: number; query: string };

/** The @ being typed at the caret, or null when the caret is not inside one. */
export function mentionQuery(value: string, caret: number): MentionQuery | null {
  const at = value.lastIndexOf("@", Math.max(0, caret - 1));
  if (at < 0 || at >= caret) {
    return null;
  }
  if (at > 0 && !/\s/.test(value[at - 1] ?? "")) {
    return null;
  }
  const query = value.slice(at + 1, caret);
  if (/\s/.test(query)) {
    return null;
  }
  return { start: at, query };
}

export function applyMention(value: string, start: number, caret: number, handle: string): { value: string; caret: number } {
  const next = `${value.slice(0, start)}@${handle} ${value.slice(caret)}`;
  const nextCaret = start + handle.length + 2;
  return { value: next, caret: nextCaret };
}

export function filterMentionHandles<T extends { handle?: string }>(members: T[], query: string): T[] {
  const prefix = query.toLowerCase();
  return members
    .filter((member) => typeof member.handle === "string" && member.handle.toLowerCase().startsWith(prefix))
    .slice()
    .sort((a, b) => (a.handle ?? "").localeCompare(b.handle ?? ""));
}
