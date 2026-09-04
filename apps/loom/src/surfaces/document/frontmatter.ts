// Minimal YAML-frontmatter parser. Scope: enough to read the keys Loom
// cares about (today: `run_in`). Not a full YAML implementation — no
// nested structures, no lists, no quoting beyond simple "..." / '...'.
//
// Format recognized:
//
//   ---
//   key: value
//   another_key: "value with spaces"
//   ---
//
// Frontmatter must be the very first content in the file (no leading
// whitespace before the opening `---`). Anything after the closing
// `---` is the document body.

export interface ParsedFrontmatter {
  /// Parsed key-value pairs. Empty if no frontmatter was found.
  fields: Record<string, string>;
  /// Number of characters consumed by the frontmatter block (incl. the
  /// surrounding `---` lines and the trailing newline). 0 when absent.
  consumed: number;
}

export function parseFrontmatter(source: string): ParsedFrontmatter {
  // Frontmatter must open on line 1.
  if (!source.startsWith("---")) {
    return { fields: {}, consumed: 0 };
  }
  const lines = source.split("\n");
  // Line 0 must be exactly `---` (allow trailing whitespace).
  if ((lines[0] ?? "").trim() !== "---") {
    return { fields: {}, consumed: 0 };
  }
  // Find the closing fence.
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if ((lines[i] ?? "").trim() === "---") {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === -1) {
    return { fields: {}, consumed: 0 };
  }

  const fields: Record<string, string> = {};
  for (let i = 1; i < closeIdx; i++) {
    const raw = lines[i] ?? "";
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim();
    if (!key) continue;
    let value = trimmed.slice(colon + 1).trim();
    // Strip surrounding quotes if present.
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    fields[key] = value;
  }

  // +1 to include the closing fence's newline.
  const consumed =
    lines.slice(0, closeIdx + 1).reduce((acc, l) => acc + l.length + 1, 0);
  return { fields, consumed };
}

/// Convenience: read the `run_in` key (the only key Loom currently cares
/// about), returning `null` if absent or empty. Whitespace-trimmed.
export function readRunIn(source: string): string | null {
  const { fields } = parseFrontmatter(source);
  const v = fields["run_in"]?.trim();
  return v && v.length > 0 ? v : null;
}
