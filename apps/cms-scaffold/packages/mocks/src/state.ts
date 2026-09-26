import type { Surface } from "@cms/api";

/** Failure scenarios selectable with `?mock=<name>` (01 §11.3). */
export type Scenario = "none" | "slow" | "error500" | "empty" | "conflict";
export const SCENARIOS: readonly Scenario[] = ["none", "slow", "error500", "empty", "conflict"];

export const MOCK_CSRF_TOKEN = "mock-csrf-token";
/** Any non-empty password logs in, except this one, which returns 401 INVALID_CREDENTIALS. */
export const MOCK_WRONG_PASSWORD = "wrong-password";
export const SLOW_DELAY_MS = 1500;

const STORAGE_USER = "cms-mock:user";
const STORAGE_SCENARIO = "cms-mock:scenario";

interface MockState {
  surface: Surface;
  scenario: Scenario;
  user: string | null;
}

const state: MockState = { surface: "back", scenario: "none", user: null };

function storage(): Storage | null {
  return typeof sessionStorage === "undefined" ? null : sessionStorage;
}

export function getState(): Readonly<MockState> {
  return state;
}

export function setSurface(surface: Surface) {
  state.surface = surface;
}

export function setScenario(scenario: Scenario) {
  state.scenario = scenario;
  storage()?.setItem(STORAGE_SCENARIO, scenario);
}

/** Username of the signed-in seed user, or null for anonymous. */
export function setUser(username: string | null) {
  state.user = username;
  if (username === null) storage()?.removeItem(STORAGE_USER);
  else storage()?.setItem(STORAGE_USER, username);
}

/**
 * Browser only: restores state saved in sessionStorage, then applies `?mock=` and `?mockUser=`
 * from the page URL (they win over storage). `?mockUser=` with an empty value signs out.
 */
export function readBrowserState(search: string) {
  const saved = storage();
  const params = new URLSearchParams(search);
  const scenario = params.get("mock") ?? saved?.getItem(STORAGE_SCENARIO) ?? "none";
  setScenario((SCENARIOS as readonly string[]).includes(scenario) ? (scenario as Scenario) : "none");
  if (params.has("mockUser")) setUser(params.get("mockUser") || null);
  else state.user = saved?.getItem(STORAGE_USER) ?? null;
}

/** Node tests: back to anonymous, no scenario, Back surface. */
export function resetState() {
  state.surface = "back";
  state.scenario = "none";
  state.user = null;
}
