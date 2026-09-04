// Declarative config for the document surface. Everything visual or
// pattern-related lives here; the components and decorations import from
// this module rather than embedding magic regexes or class names inline.
// 01-collaboration-protocol §8 — "宣告式鎖定".

/// A fenced code block becomes runnable iff the info-string starts with a
/// language tag followed by the literal `run` token.
///
///   ```bash run                    ← runnable
///   ```bash                        ← static
///   ```bash run --foo              ← runnable; extra tokens preserved as args
///   ```bash run cwd=/path/to/repo  ← runnable; sets target working dir
export const RUNNABLE_INFO_PATTERN = /^([A-Za-z0-9_-]+)\s+run(\s+.*)?$/;

/// Within a runnable block's args, recognize `cwd=...`. The path may be
/// quoted (`cwd="/path with spaces"`) or unquoted (`cwd=/no/spaces`).
/// First match wins, even if the user wrote `cwd=` more than once.
export const CWD_ARG_PATTERN = /\bcwd=("([^"]*)"|(\S+))/;

/// Block-id lives at the end of a line as ` ^block-id`. Obsidian-compatible.
export const BLOCK_ID_PATTERN = /\s\^([A-Za-z0-9-_]+)\s*$/;

/// Inline reference `[[file#^block-id]]` or `[[file]]` or `[[file#header]]`.
/// We only specially-render the `#^id` form; plain `[[file]]` falls through
/// as raw text for now (link routing isn't C2's job).
export const REF_PATTERN = /\[\[([^\]#]+)(#\^([A-Za-z0-9-_]+))?\]\]/g;

export const CSS = {
  /// Outer wrapper class on the runnable-block widget.
  runnableBlock: "loom-runnable-block",
  /// The ▶ run button.
  runnableButton: "loom-run-button",
  /// Output section directly below the block.
  outputSection: "loom-output-section",
  /// Block-id chip rendered at end of a line.
  blockIdChip: "loom-block-id-chip",
  /// Inline `[[file#^id]]` reference chip.
  refChip: "loom-ref-chip",
  /// Top banner for the B2-3 conflict prompt.
  conflictBanner: "loom-conflict-banner",
} as const;

/// Words the run button shows for the static / runnable distinction.
export const STRINGS = {
  runButton: "▶ run",
  pinButton: "📌 Pin",
  outputEmpty: "(no output yet — click ▶ on the block above to run)",
  conflictTitle: "External change detected",
  conflictBody:
    "The file changed on disk while you had unsaved edits. Reload to take the on-disk version (your edits will be lost), or keep editing and save to overwrite.",
  conflictReload: "Reload",
  conflictKeep: "Keep editing",
} as const;
