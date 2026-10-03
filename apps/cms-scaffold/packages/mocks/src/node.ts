// Vitest (Node) entry: one MSW server shared by a test file.
import { setupServer } from "msw/node";
import { resetDb } from "./db";
import { handlers } from "./handlers";
import { resetState } from "./state";

export const server = setupServer(...handlers);

/** Call in beforeEach: restores fixtures and signs out. */
export function resetMocks() {
  server.resetHandlers();
  resetDb();
  resetState();
}
