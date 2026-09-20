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

/** Scan @handle and fullwidth ＠handle; return matched room handles in lowercase. */
export function tokenizeMentions(body: string, handles: string[]): string[] {
  const wanted = new Set(handles.map((h) => h.toLowerCase()));
  const found: string[] = [];
  const seen = new Set<string>();
  const n = body.length;

  for (let i = 0; i < n; i++) {
    const sigil = body[i];
    if (sigil !== "@" && sigil !== "＠") continue;
    if (!isBoundary(i === 0 ? undefined : body[i - 1])) continue;

    let j = i + 1;
    while (j < n && j - (i + 1) < 32 && isHandleChar(body[j]!)) {
      j += 1;
    }
    const len = j - (i + 1);
    if (len < 2) continue;
    if (!isBoundary(j === n ? undefined : body[j])) continue;

    const handle = body.slice(i + 1, j).toLowerCase();
    if (wanted.has(handle) && !seen.has(handle)) {
      seen.add(handle);
      found.push(handle);
    }
  }

  return found;
}
