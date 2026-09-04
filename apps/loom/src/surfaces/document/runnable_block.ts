// Runnable-block decoration: any fenced code block whose info-string
// matches `<lang> run [...]` gets a ▶ widget above it and an output
// section below.
//
// We intentionally do NOT plug into CodeMirror's markdown language parser:
// a regex over the visible buffer is enough for the demo and avoids
// depending on internal Lezer node shapes. If C2 grows to handle nested
// fences / escaped backticks we'll graduate to a real parse tree.
//
// Block decorations (`block: true`) are not allowed from `ViewPlugin`s —
// CodeMirror throws "Block decorations may not be specified via plugins"
// at the first render. They must come from a `StateField` whose
// `provide(f)` hands them to `EditorView.decorations`. That's why this
// module uses StateField rather than ViewPlugin.
//
// Output capture (post-C4-min): each block is keyed by its body text.
// When a ▶ inject is routed to a terminal that feeds back into this
// document (via a `feeds_output_to` edge on the canvas), the
// DocumentSurface dispatches `appendOutputEffect` with chunks of raw
// pty:io text; the OutputSectionWidget reads from the same StateField
// and renders the accumulated text below the block.

import {
  RangeSetBuilder,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Transaction,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";

import { CSS, CWD_ARG_PATTERN, RUNNABLE_INFO_PATTERN, STRINGS } from "./config";

export interface RunnableInfo {
  /// Line number (1-based) of the opening ```lang run fence.
  fenceStartLine: number;
  /// Line number of the closing ``` fence.
  fenceEndLine: number;
  /// Language tag (e.g. "bash").
  lang: string;
  /// The raw body between fences, no trailing newline.
  body: string;
  /// Working directory to `cd` into before executing the body. Parsed from
  /// `cwd=` in the info-string; `undefined` ⇒ inject as-is. Min-D-6 (B).
  cwd: string | undefined;
}

function parseCwd(args: string): string | undefined {
  const m = args.match(CWD_ARG_PATTERN);
  if (!m) return undefined;
  // Group 2 is the quoted body, group 3 is the unquoted form. Exactly
  // one of them matches.
  return m[2] ?? m[3];
}

/// Pure parser, exported so unit tests can hit it without the editor.
export function findRunnableBlocks(source: string): RunnableInfo[] {
  const lines = source.split("\n");
  const out: RunnableInfo[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const fenceMatch = line.match(/^```\s*(.*)$/);
    if (!fenceMatch) {
      i += 1;
      continue;
    }
    const infoString = (fenceMatch[1] ?? "").trim();
    const runnable = infoString.match(RUNNABLE_INFO_PATTERN);
    // Walk to the closing fence regardless of runnable status so we don't
    // mistake the contents of a non-runnable block for a new fence.
    let j = i + 1;
    while (j < lines.length && !(lines[j] ?? "").match(/^```\s*$/)) {
      j += 1;
    }
    if (runnable) {
      const lang = runnable[1] ?? "";
      const args = (runnable[2] ?? "").trim();
      const body = lines.slice(i + 1, j).join("\n");
      out.push({
        fenceStartLine: i + 1,
        fenceEndLine: Math.min(j + 1, lines.length),
        lang,
        body,
        cwd: parseCwd(args),
      });
    }
    i = j + 1;
  }
  return out;
}

export interface RunRequest {
  lang: string;
  body: string;
  cwd: string | undefined;
}

// ── Output capture state ────────────────────────────────────────────────

/// A block is identified by its body text. Edits invalidate the key —
/// captured output disassociates if the user changes the block body,
/// which is acceptable for v1.
export function blockKey(body: string): string {
  return body;
}

export interface OutputState {
  /// blockKey → captured text (raw pty:io bytes, minus carriage returns
  /// and color codes for legibility).
  outputs: Map<string, string>;
}

const EMPTY_OUTPUT_STATE: OutputState = { outputs: new Map() };

export const appendOutputEffect = StateEffect.define<{
  bodyKey: string;
  text: string;
}>();

export const clearOutputEffect = StateEffect.define<{ bodyKey: string }>();

export const outputCaptureField = StateField.define<OutputState>({
  create(): OutputState {
    return EMPTY_OUTPUT_STATE;
  },
  update(value: OutputState, tr: Transaction): OutputState {
    let next = value;
    for (const e of tr.effects) {
      if (e.is(appendOutputEffect)) {
        const map = new Map(next.outputs);
        const prior = map.get(e.value.bodyKey) ?? "";
        map.set(e.value.bodyKey, prior + cleanFrame(e.value.text));
        next = { outputs: map };
      } else if (e.is(clearOutputEffect)) {
        const map = new Map(next.outputs);
        map.delete(e.value.bodyKey);
        next = { outputs: map };
      }
    }
    return next;
  },
});

function cleanFrame(s: string): string {
  // Strip the visual noise that makes raw PTY output unreadable in a
  // non-terminal context: ANSI CSI / OSC sequences, two-byte ESC
  // sequences, other C0 control bytes, bare CRs. Build every control
  // byte from charCodes — embedding literals breaks tooling pipelines
  // that munge 0x1B.
  const ESC = String.fromCharCode(0x1b);
  const BEL = String.fromCharCode(0x07);
  const CR = String.fromCharCode(0x0d);
  const LF = String.fromCharCode(0x0a);
  let out = s;
  // 1. CSI: ESC [ <params> <intermediate> <final>. Covers SGR colors,
  //    cursor moves, bracketed paste enable/disable, mouse modes
  //    ("?2004h"), etc.
  out = out.replace(new RegExp(ESC + "\\[[0-9;?]*[ -/]*[@-~]", "g"), "");
  // 2. OSC: ESC ] <payload> (BEL | ESC \\). zsh emits OSC 7 (cwd report)
  //    and OSC 8 (hyperlinks) all over modern prompts; both terminate
  //    here.
  out = out.replace(
    new RegExp(
      ESC + "\\][^" + BEL + ESC + "]*(" + BEL + "|" + ESC + "\\\\)",
      "g",
    ),
    "",
  );
  // 3. Two-byte ESC sequences: ESC followed by any single byte. After CSI
  //    and OSC are stripped, anything that still starts with ESC is one
  //    of these (SS2 / SS3 / RIS / charset switch / …).
  out = out.replace(new RegExp(ESC + ".", "g"), "");
  // 4. Stray lone ESCs (defensive).
  out = out.split(ESC).join("");
  // 5. Other C0 control bytes except newline (0x0a) and tab (0x09).
  out = out.replace(
    new RegExp("[\\u0000-\\u0008\\u000b-\\u001f]", "g"),
    "",
  );
  // 6. Bare CR (CR without a following LF).
  out = out.replace(new RegExp(CR + "(?!" + LF + ")", "g"), "");
  return out;
}


// ── Widgets ─────────────────────────────────────────────────────────────

class RunButtonWidget extends WidgetType {
  constructor(
    private readonly lang: string,
    private readonly body: string,
    private readonly cwd: string | undefined,
    private readonly onRun: (req: RunRequest) => void,
  ) {
    super();
  }

  override eq(other: WidgetType): boolean {
    return (
      other instanceof RunButtonWidget &&
      other.lang === this.lang &&
      other.body === this.body &&
      other.cwd === this.cwd
    );
  }

  override toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = CSS.runnableBlock;
    const btn = document.createElement("button");
    btn.className = CSS.runnableButton;
    const cwdSuffix = this.cwd ? `  @ ${this.cwd}` : "";
    btn.textContent = `${STRINGS.runButton}  (${this.lang})${cwdSuffix}`;
    btn.addEventListener("click", () => {
      this.onRun({ lang: this.lang, body: this.body, cwd: this.cwd });
    });
    wrap.appendChild(btn);
    return wrap;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

class OutputSectionWidget extends WidgetType {
  constructor(
    private readonly bodyKey: string,
    private readonly text: string,
    private readonly onPin: (bodyKey: string) => void,
  ) {
    super();
  }

  override eq(other: WidgetType): boolean {
    return (
      other instanceof OutputSectionWidget &&
      other.bodyKey === this.bodyKey &&
      other.text === this.text
    );
  }

  override toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = CSS.outputSection;
    if (this.text.length === 0) {
      wrap.textContent = STRINGS.outputEmpty;
      wrap.classList.add("loom-output-empty");
      return wrap;
    }
    // Header: Pin button on the left, label on the right.
    const header = document.createElement("div");
    header.className = "loom-output-header";
    const pinBtn = document.createElement("button");
    pinBtn.className = "loom-pin-button";
    pinBtn.textContent = STRINGS.pinButton;
    pinBtn.title = "Insert a markdown snapshot of this output below the block";
    pinBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onPin(this.bodyKey);
    });
    header.appendChild(pinBtn);
    const label = document.createElement("span");
    label.className = "loom-output-label";
    label.textContent = `${this.text.length} chars`;
    header.appendChild(label);
    wrap.appendChild(header);
    // Output body: use <pre> so whitespace and newlines render verbatim.
    const pre = document.createElement("pre");
    pre.className = "loom-output-pre";
    pre.textContent = this.text;
    wrap.appendChild(pre);
    return wrap;
  }

  override ignoreEvent(): boolean {
    // Let the Pin button's click reach our handler instead of being
    // intercepted by CodeMirror's view layer.
    return false;
  }
}

// ── Decoration builder ──────────────────────────────────────────────────

function buildDecorations(
  state: EditorState,
  onRun: (req: RunRequest) => void,
  onPin: (bodyKey: string) => void,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const source = state.doc.toString();
  const capture = state.field(outputCaptureField, false) ?? EMPTY_OUTPUT_STATE;
  for (const block of findRunnableBlocks(source)) {
    const openLine = state.doc.line(block.fenceStartLine);
    const closeLine = state.doc.line(
      Math.min(block.fenceEndLine, state.doc.lines),
    );
    const key = blockKey(block.body);
    const captured = capture.outputs.get(key) ?? "";
    builder.add(
      openLine.from,
      openLine.from,
      Decoration.widget({
        widget: new RunButtonWidget(block.lang, block.body, block.cwd, onRun),
        side: -1,
        block: true,
      }),
    );
    builder.add(
      closeLine.to,
      closeLine.to,
      Decoration.widget({
        widget: new OutputSectionWidget(key, captured, onPin),
        side: 1,
        block: true,
      }),
    );
  }
  return builder.finish();
}

export function runnableBlockExtension(
  onRun: (req: RunRequest) => void,
  onPin: (bodyKey: string) => void,
): Extension {
  const deco = StateField.define<DecorationSet>({
    create(state) {
      return buildDecorations(state, onRun, onPin);
    },
    update(value, tr) {
      if (
        !tr.docChanged &&
        !tr.effects.some(
          (e) => e.is(appendOutputEffect) || e.is(clearOutputEffect),
        )
      ) {
        return value;
      }
      return buildDecorations(tr.state, onRun, onPin);
    },
    provide(f) {
      return EditorView.decorations.from(f);
    },
  });
  // The capture state field must be installed before the decoration
  // field that reads from it; CodeMirror resolves field order from the
  // extension array order.
  return [outputCaptureField, deco];
}
