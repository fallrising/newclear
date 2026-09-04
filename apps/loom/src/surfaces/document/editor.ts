// CodeMirror 6 instance factory. Compositions, keymaps, theme, and the
// two C2 decorations (runnable_block, block_id) are wired here so the
// React component only has to call `createEditor` once.

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, keymap } from "@codemirror/view";

import { blockIdExtension } from "./block_id";
import {
  appendOutputEffect,
  clearOutputEffect,
  findRunnableBlocks,
  outputCaptureField,
  runnableBlockExtension,
  blockKey,
  type RunRequest,
} from "./runnable_block";

export interface CreateEditorArgs {
  parent: HTMLElement;
  initialContent: string;
  onChange: (next: string) => void;
  /// Cmd/Ctrl+S keybinding.
  onSave: () => void;
  onRun: (req: RunRequest) => void;
  onRefClick: (hit: { file: string; id: string }) => void;
}

export interface PinResult {
  /// True if a snapshot was inserted; false when the block couldn't be
  /// located (e.g., the user edited the block body after running).
  inserted: boolean;
  /// Absolute char position in the document where the snapshot starts.
  /// `undefined` when `inserted` is false.
  insertedAt?: number;
}

export interface EditorHandle {
  view: EditorView;
  replaceDoc: (content: string) => void;
  /// Append captured pty:io text to a runnable block's output section.
  appendOutput: (bodyKey: string, text: string) => void;
  clearOutput: (bodyKey: string) => void;
  /// Insert the captured text for `bodyKey` as a markdown snapshot
  /// immediately after the runnable block's closing fence, then clear
  /// the capture. Returns metadata about what happened.
  pinOutput: (bodyKey: string) => PinResult;
  /// Insert `text` at the current cursor position and move the cursor
  /// to the end of what was inserted. Used by the AI streaming path so
  /// successive chunks pile up in the right place.
  insertAtCursor: (text: string) => void;
  destroy: () => void;
}

export function createEditor(args: CreateEditorArgs): EditorHandle {
  const saveKey: Extension = keymap.of([
    {
      key: "Mod-s",
      run: () => {
        args.onSave();
        return true;
      },
      preventDefault: true,
    },
  ]);

  const changeListener = EditorView.updateListener.of((u) => {
    if (u.docChanged) {
      args.onChange(u.state.doc.toString());
    }
  });

  // Forward declaration of the pinOutput closure so we can pass `onPin`
  // into the runnable block extension before we've built the handle.
  let pinOutputImpl: (bodyKey: string) => PinResult = () => ({
    inserted: false,
  });

  const state = EditorState.create({
    doc: args.initialContent,
    extensions: [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      saveKey,
      markdown(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      oneDark,
      EditorView.lineWrapping,
      runnableBlockExtension(args.onRun, (bodyKey) => {
        pinOutputImpl(bodyKey);
      }),
      blockIdExtension(args.onRefClick),
      changeListener,
    ],
  });

  const view = new EditorView({
    state,
    parent: args.parent,
  });

  // Now that `view` exists, define the real pin implementation.
  pinOutputImpl = (bodyKey: string): PinResult => {
    const capture = view.state.field(outputCaptureField, false);
    const text = capture?.outputs.get(bodyKey) ?? "";
    if (!text) return { inserted: false };

    // Find the matching block in the current document so we know where
    // to insert. Body-key match handles the common case where the user
    // hasn't edited the block between ▶ and Pin.
    const source = view.state.doc.toString();
    const block = findRunnableBlocks(source).find(
      (b) => blockKey(b.body) === bodyKey,
    );
    if (!block) return { inserted: false };

    const closeLine = view.state.doc.line(
      Math.min(block.fenceEndLine, view.state.doc.lines),
    );
    // Insert after the closing fence, on a fresh line.
    const insertAt = closeLine.to;
    const snippet = formatSnapshot(block.body, text);

    view.dispatch({
      changes: { from: insertAt, insert: snippet },
      effects: clearOutputEffect.of({ bodyKey }),
    });
    return { inserted: true, insertedAt: insertAt };
  };

  return {
    view,
    replaceDoc(content) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
      });
    },
    appendOutput(bodyKey, text) {
      view.dispatch({
        effects: appendOutputEffect.of({ bodyKey, text }),
      });
    },
    clearOutput(bodyKey) {
      view.dispatch({
        effects: clearOutputEffect.of({ bodyKey }),
      });
    },
    pinOutput(bodyKey) {
      return pinOutputImpl(bodyKey);
    },
    insertAtCursor(text) {
      const cursor = view.state.selection.main.to;
      view.dispatch({
        changes: { from: cursor, insert: text },
        selection: { anchor: cursor + text.length },
        scrollIntoView: true,
      });
    },
    destroy() {
      view.destroy();
    },
  };
}

function formatSnapshot(sourceCmd: string, text: string): string {
  // TDD §8 step 5: snapshot carries source command + timestamp + content.
  // Markdown form keeps the file readable in Obsidian / plain editors.
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  const firstLine = sourceCmd.split("\n", 1)[0] ?? sourceCmd;
  // Pick a fence that doesn't appear in the body. The default of 3
  // backticks is unsafe if the output itself contains ```; bump to a
  // longer run when needed.
  let fence = "```";
  while (text.includes(fence)) fence += "`";
  // Trim trailing whitespace so the inserted block stays tight; we
  // always emit our own leading + trailing newlines.
  const body = text.replace(/\s+$/, "");
  return (
    `\n\n> 📌 **Pinned ${ts}** from \`${firstLine}\`\n` +
    `${fence}text\n${body}\n${fence}\n`
  );
}
