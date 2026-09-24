/** FNV-1a 32-bit of the member id, mod 8 (07 §2.3). */
export function avatarIndex(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 8;
}

export function initials(name: string): string {
  const s = name.trim();
  if (s === "") return "?";
  const first = Array.from(s)[0]!;
  if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(first)) return first;
  const words = s.split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((w) => Array.from(w)[0]!.toUpperCase())
    .join("");
}
