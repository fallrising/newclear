import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { externalReplacement, isLocalDocumentChange } from "./editor";
describe("reload transaction origin", () => {
  it("two external replacements are clean and typing remains a local change", () => {
    let state = EditorState.create({ doc: "initial" });
    for (const content of ["external 1", "external 2"]) {
      const update = state.update({ changes: { from: 0, to: state.doc.length, insert: content }, annotations: externalReplacement.of(true) });
      expect(isLocalDocumentChange([update])).toBe(false);
      state = update.state;
    }
    expect(state.doc.toString()).toBe("external 2");
    expect(isLocalDocumentChange([state.update({ changes: { from: 0, insert: "typing" } })])).toBe(true);
  });
});
