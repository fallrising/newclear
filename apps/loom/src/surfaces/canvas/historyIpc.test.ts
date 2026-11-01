import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { forgetSession, onSessionChanged, restartSession, sessionHistory } from "../../ipc";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
describe("runtime recovery IPC", () => {
  beforeEach(() => { vi.mocked(invoke).mockReset(); vi.mocked(listen).mockReset(); });
  it("uses exact runtime command names and camelCase arguments with user origin", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ sessions: [], live_session_ids: [], persistent: false, warning: "storage unavailable" }).mockResolvedValueOnce("fresh").mockResolvedValueOnce(undefined);
    expect(await sessionHistory()).toMatchObject({ persistent: false, warning: "storage unavailable" });
    expect(await restartSession("saved")).toBe("fresh"); await forgetSession("saved");
    expect(vi.mocked(invoke).mock.calls).toEqual([
      ["session_history"],
      ["session_restart", { origin: { kind: "user" }, sessionId: "saved", cols: 120, rows: 30 }],
      ["session_forget", { origin: { kind: "user" }, sessionId: "saved" }],
    ]);
  });
  it("treats session:changed as a refresh hint, independently of its payload", async () => {
    const off = vi.fn(); vi.mocked(listen).mockResolvedValueOnce(off); const hint = vi.fn();
    expect(await onSessionChanged(hint)).toBe(off);
    const [event, callback] = vi.mocked(listen).mock.calls[0]!;
    expect(event).toBe("session:changed"); callback({ event: "session:changed", id: 1, payload: { ignored: true } });
    expect(hint).toHaveBeenCalledWith();
  });
});
