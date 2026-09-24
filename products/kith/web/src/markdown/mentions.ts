export type MentionRange = { start: number; end: number; handle: string };

const HANDLE_RE = /[a-z0-9_]/i;

function isAsciiPunct(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126);
}

function isBoundary(ch: string | undefined): boolean {
  if (ch === undefined) return true;
  if (/\s/u.test(ch)) return true;
  return isAsciiPunct(ch);
}

function isHandleChar(ch: string): boolean {
  return HANDLE_RE.test(ch);
}

/** Every @handle or ＠handle in `text` whose lowercase handle is in `handles`. Includes the sigil. */
export function findMentions(text: string, handles: readonly string[]): MentionRange[] {
  const wanted = new Set(handles.map((h) => h.toLowerCase()));
  const found: MentionRange[] = [];
  const n = text.length;

  for (let i = 0; i < n; i++) {
    const sigil = text[i];
    if (sigil !== "@" && sigil !== "＠") continue;
    if (!isBoundary(i === 0 ? undefined : text[i - 1])) continue;

    let j = i + 1;
    while (j < n && j - (i + 1) < 32 && isHandleChar(text[j]!)) j += 1;
    const len = j - (i + 1);
    if (len < 2) continue;
    if (!isBoundary(j === n ? undefined : text[j])) continue;

    const handle = text.slice(i + 1, j).toLowerCase();
    if (wanted.has(handle)) found.push({ start: i, end: j, handle });
  }

  return found;
}
