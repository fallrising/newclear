import "@testing-library/jest-dom/vitest";
import {cleanup} from "@testing-library/react";
import {afterAll, afterEach, beforeAll, vi} from "vitest";
import {resetCsrfForTests} from "../api";
import {server} from "./server";

vi.mock("echarts", () => ({
  init: () => ({setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn()}),
}));

beforeAll(() => server.listen({onUnhandledRequest: "error"}));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  resetCsrfForTests();
});
afterAll(() => server.close());

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverStub);
vi.stubGlobal("scrollTo", vi.fn());
