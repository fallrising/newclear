export type MentionQuery = { start: number; end: number; prefix: string };

export function mentionQueryAt(value: string, caret: number): MentionQuery | null {
  let i = caret - 1;
  while (i >= 0) {
    const ch = value[i]!;
    if (ch === "@" || ch === "＠") break;
    if (!/[a-z0-9_]/i.test(ch)) return null;
    i -= 1;
  }
  if (i < 0) return null;
  if (i !== 0 && !/\s/u.test(value[i - 1]!)) return null;
  const prefix = value.slice(i + 1, caret);
  if (prefix.length > 32) return null;
  return { start: i, end: caret, prefix };
}
