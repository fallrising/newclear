import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { toast } from "@cms/ui";
import { setSurface } from "@cms/mocks";
import { resetMocks, server } from "@cms/mocks/node";
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";

// jsdom lacks these browser APIs; Radix Select, RadioGroup, Switch, Popover and DropdownMenu call them.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof Element !== "undefined") {
  globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
  resetMocks();
  setSurface("back");
});
afterEach(() => { toast.dismiss(); cleanup(); });
afterAll(() => server.close());
