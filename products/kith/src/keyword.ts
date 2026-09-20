const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

export type LoadedKeywords = Set<string>;

function isCjk(keyword: string): boolean {
  return CJK_RE.test(keyword);
}

function codePointLength(s: string): number {
  return [...s].length;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Load keywords. CJK keywords shorter than 2 code points are rejected (never silent ignore). */
export function loadKeywords(keywords: string[]): LoadedKeywords {
  const loaded: LoadedKeywords = new Set();
  for (const keyword of keywords) {
    if (isCjk(keyword) && codePointLength(keyword) < 2) {
      throw new Error("CJK keyword shorter than 2 code points");
    }
    loaded.add(isCjk(keyword) ? keyword : keyword.toLowerCase());
  }
  return loaded;
}

/** ASCII: Unicode letter/digit word boundary, ASCII case-insensitive. CJK: substring. Empty set never hits. */
export function matchKeywords(body: string, loaded: LoadedKeywords): boolean {
  if (loaded.size === 0) return false;
  for (const keyword of loaded) {
    if (isCjk(keyword)) {
      if (body.includes(keyword)) return true;
      continue;
    }
    const re = new RegExp(`\\b${escapeRegExp(keyword)}\\b`, "i");
    if (re.test(body)) return true;
  }
  return false;
}
