import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { setSurface } from "@cms/mocks";
import { resetMocks, server } from "@cms/mocks/node";
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
  resetMocks();
  setSurface("admin");
});
afterEach(() => cleanup());
afterAll(() => server.close());
