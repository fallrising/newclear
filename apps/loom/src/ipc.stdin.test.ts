import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { writeStdin } from "./ipc";

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("writeStdin native submission order", () => {
  beforeEach(() => invoke.mockReset());

  it("waits for a keyboard write before submitting a document Run payload to the same session", async () => {
    const keyboardAck = deferred();
    invoke.mockReturnValueOnce(keyboardAck.promise).mockResolvedValue(undefined);

    const keyboard = writeStdin("session-a", "x");
    const run = writeStdin("session-a", "printf 'run'\r");
    expect(invoke.mock.calls).toEqual([
      ["pty_write_stdin", { origin: { kind: "user" }, sessionId: "session-a", data: "x" }],
    ]);

    keyboardAck.resolve();
    await keyboard;
    await run;
    expect(invoke.mock.calls).toEqual([
      ["pty_write_stdin", { origin: { kind: "user" }, sessionId: "session-a", data: "x" }],
      ["pty_write_stdin", { origin: { kind: "user" }, sessionId: "session-a", data: "printf 'run'\r" }],
    ]);
  });

  it("submits a different session while the first session is awaiting its acknowledgement", async () => {
    const firstAck = deferred();
    invoke.mockReturnValueOnce(firstAck.promise).mockResolvedValue(undefined);

    const first = writeStdin("session-a", "a");
    const other = writeStdin("session-b", "b");
    expect(invoke.mock.calls.map(([, args]) => args.sessionId)).toEqual(["session-a", "session-b"]);

    firstAck.resolve();
    await Promise.all([first, other]);
  });

  it("reports each native rejection and continues later writes for that session", async () => {
    const firstAck = deferred();
    invoke.mockReturnValueOnce(firstAck.promise).mockResolvedValue(undefined);

    const first = writeStdin("session-a", "a");
    const firstResult = first.then(() => "resolved", (reason: unknown) => reason);
    const second = writeStdin("session-a", "b");
    expect(invoke).toHaveBeenCalledTimes(1);

    firstAck.reject("native write failed");
    expect(await firstResult).toBe("native write failed");
    await second;
    expect(invoke.mock.calls.map(([, args]) => args.data)).toEqual(["a", "b"]);
  });

  it("releases an idle session so its next write submits immediately", async () => {
    invoke.mockResolvedValue(undefined);
    await writeStdin("session-a", "a");

    const next = writeStdin("session-a", "b");
    expect(invoke.mock.calls.map(([, args]) => args.data)).toEqual(["a", "b"]);
    await next;
  });
});
