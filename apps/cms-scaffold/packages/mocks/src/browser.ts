// Browser entry for `vite --mode mock`. Loaded only through a dynamic import guarded by
// `import.meta.env.MODE === "mock"`, so it never reaches a production bundle (checked by test:bundle).
import type { Surface } from "@cms/api";
import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";
import { readBrowserState, setSurface } from "./state";

export async function startMockWorker(surface: Surface) {
  setSurface(surface);
  readBrowserState(window.location.search);
  const worker = setupWorker(...handlers);
  await worker.start({ onUnhandledRequest: "bypass", quiet: true });
}
