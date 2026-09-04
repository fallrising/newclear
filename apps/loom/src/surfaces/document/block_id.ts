// Block-id decoration: render trailing `^block-id` and inline
// `[[file#^block-id]]` as chips while leaving the raw text untouched
// (Obsidian-compatible, D-9).

import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

import { BLOCK_ID_PATTERN, CSS, REF_PATTERN } from "./config";

export interface BlockIdHit {
  /// 1-based line.
  line: number;
  /// The id part without the caret.
  id: string;
  /// Absolute char offsets of the ` ^id` span (incl. leading space).
  from: number;
  to: number;
}

export interface RefHit {
  /// Absolute char offsets of the `[[…]]` span.
  from: number;
  to: number;
  /// The vault-relative file portion (before `#^`).
  file: string;
  /// The block-id portion (after `#^`); empty string when ref had no id.
  id: string;
}

/// Find every line-end `^block-id` in `source`. Pure for testability.
export function findBlockIds(source: string): BlockIdHit[] {
  const out: BlockIdHit[] = [];
  let offset = 0;
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const m = line.match(BLOCK_ID_PATTERN);
    if (m && m.index !== undefined) {
      const id = m[1] ?? "";
      const from = offset + m.index;
      const to = from + m[0].length;
      out.push({ line: i + 1, id, from, to });
    }
    offset += line.length + 1; // +1 for the '\n'
  }
  return out;
}

/// Find every `[[file#^id]]` reference in `source`. Plain `[[file]]`
/// references (no id) are returned too with `id = ""`.
export function findRefs(source: string): RefHit[] {
  const out: RefHit[] = [];
  REF_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = REF_PATTERN.exec(source)) !== null) {
    const from = m.index;
    const to = from + m[0].length;
    out.push({
      from,
      to,
      file: m[1] ?? "",
      id: m[3] ?? "",
    });
  }
  return out;
}

class BlockIdChipWidget extends WidgetType {
  constructor(private readonly id: string) {
    super();
  }
  override eq(other: WidgetType): boolean {
    return other instanceof BlockIdChipWidget && other.id === this.id;
  }
  override toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = CSS.blockIdChip;
    span.textContent = `^${this.id}`;
    span.title = `block-id: ${this.id}`;
    return span;
  }
}

class RefChipWidget extends WidgetType {
  constructor(
    private readonly file: string,
    private readonly id: string,
    private readonly onClick: (hit: { file: string; id: string }) => void,
  ) {
    super();
  }
  override eq(other: WidgetType): boolean {
    return (
      other instanceof RefChipWidget &&
      other.file === this.file &&
      other.id === this.id
    );
  }
  override toDOM(): HTMLElement {
    const a = document.createElement("a");
    a.className = CSS.refChip;
    a.textContent = this.id ? `${this.file} #^${this.id}` : this.file;
    a.href = "#";
    a.addEventListener("click", (e) => {
      e.preventDefault();
      this.onClick({ file: this.file, id: this.id });
    });
    return a;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

function buildDecorations(
  view: EditorView,
  onRefClick: (hit: { file: string; id: string }) => void,
): DecorationSet {
  // CodeMirror requires range decorations to be added in `from`-ascending
  // order. block-id hits are scanned line-by-line so they come ordered,
  // and ref hits are scanned via global regex so they're ordered too, but
  // the two streams interleave — collect first, then sort.
  type RangedDecoration = { from: number; to: number; deco: Decoration };
  const ranges: RangedDecoration[] = [];
  const source = view.state.doc.toString();

  for (const hit of findBlockIds(source)) {
    ranges.push({
      from: hit.from,
      to: hit.to,
      deco: Decoration.replace({
        widget: new BlockIdChipWidget(hit.id),
      }),
    });
  }
  for (const hit of findRefs(source)) {
    if (!hit.id) {
      // We only specially-render `#^id` refs for now.
      continue;
    }
    ranges.push({
      from: hit.from,
      to: hit.to,
      deco: Decoration.replace({
        widget: new RefChipWidget(hit.file, hit.id, onRefClick),
      }),
    });
  }
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);

  const builder = new RangeSetBuilder<Decoration>();
  for (const r of ranges) {
    builder.add(r.from, r.to, r.deco);
  }
  return builder.finish();
}

export function blockIdExtension(
  onRefClick: (hit: { file: string; id: string }) => void,
) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, onRefClick);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) {
          this.decorations = buildDecorations(u.view, onRefClick);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
      provide: (plugin) =>
        EditorView.atomicRanges.of((view) => {
          const inst = view.plugin(plugin);
          return inst ? inst.decorations : Decoration.none;
        }),
    },
  );
}
