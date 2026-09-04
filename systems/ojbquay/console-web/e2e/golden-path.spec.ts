import {expect, test, type Route} from "@playwright/test";

interface FixtureState {
  signedIn: boolean;
  topics: Array<Record<string, unknown>>;
  groups: Array<Record<string, unknown>>;
  subscriptions: Array<Record<string, unknown>>;
}

const stamp = "2026-07-29T12:00:00Z";

async function envelope(
  route: Route,
  data: unknown,
  status = 200,
  code = "OK",
  msg = "",
) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify({code, msg, data}),
  });
}

test("owner creates a working topic, group, and push subscription", async ({page}) => {
  const state: FixtureState = {
    signedIn: false,
    topics: [],
    groups: [],
    subscriptions: [],
  };
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (path === "/api/v1/auth/csrf") {
      return envelope(route, {
        headerName: "X-XSRF-TOKEN",
        parameterName: "_csrf",
        token: "browser-csrf",
      });
    }
    if (path === "/api/v1/auth/me") {
      return state.signedIn
        ? envelope(route, {username: "operator", roles: ["ADMIN", "OPS"]})
        : envelope(route, null, 401, "UNAUTHENTICATED", "Sign in required");
    }
    if (path === "/api/v1/auth/login") {
      state.signedIn = true;
      return envelope(route, {username: "operator", roles: ["ADMIN", "OPS"]});
    }
    if (path === "/api/v1/topics" && method === "GET") {
      return envelope(route, state.topics);
    }
    if (path === "/api/v1/topics" && method === "POST") {
      const input = request.postDataJSON();
      const topic = {
        ...input,
        id: 1,
        token: "topic-token",
        owner: "operator",
        state: 1,
        version: 1,
        createdAt: stamp,
        updatedAt: stamp,
      };
      state.topics.push(topic);
      return envelope(route, topic, 201);
    }
    if (path === "/api/v1/groups" && method === "GET") {
      return envelope(route, state.groups);
    }
    if (path === "/api/v1/groups" && method === "POST") {
      const input = request.postDataJSON();
      const group = {
        ...input,
        id: 1,
        token: "group-token",
        owner: "operator",
        state: 1,
        version: 1,
        createdAt: stamp,
        updatedAt: stamp,
      };
      state.groups.push(group);
      return envelope(route, group, 201);
    }
    if (path === "/api/v1/subscriptions" && method === "GET") {
      return envelope(route, state.subscriptions);
    }
    if (path === "/api/v1/clusters" && method === "GET") {
      return envelope(route, [{
        id: 1,
        name: "local",
        bootstrapServers: "kafka:19092",
        defaultCluster: true,
        createdAt: stamp,
      }]);
    }
    if (path === "/api/v1/clusters/1/health" && method === "GET") {
      return envelope(route, {
        clusterId: "golden-path",
        controllerId: 1,
        nodeCount: 1,
        status: "UP",
      });
    }
    if (path === "/api/v1/groups/1/progress" && method === "GET") {
      return envelope(route, []);
    }
    if (path === "/api/v1/subscriptions/preview" && method === "POST") {
      const input = request.postDataJSON();
      return envelope(route, {
        action: "DELIVER",
        reason: "",
        valueBase64: input.sampleMessage.valueBase64,
      });
    }
    if (path === "/api/v1/subscriptions" && method === "POST") {
      const input = request.postDataJSON();
      const subscription = {
        ...input,
        id: 1,
        owner: "operator",
        state: 1,
        version: 1,
        createdAt: stamp,
        updatedAt: stamp,
      };
      state.subscriptions.push(subscription);
      return envelope(route, subscription, 201);
    }
    return envelope(route, null, 404, "NOT_FOUND", `${method} ${path}`);
  });

  await page.goto("/");
  await expect(page.getByRole("heading", {name: "Welcome back"})).toBeVisible();
  await page.getByLabel("Username").fill("operator");
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.getByRole("button", {name: "Sign in"}).click();
  await expect(page.getByRole("heading", {name: "System overview"})).toBeVisible();

  await page.getByRole("menuitem").filter({hasText: "Topics"}).click();
  await page.getByRole("button", {name: "Create topic"}).click();
  await page.getByLabel("Topic name").fill("orders.created");
  await page.getByRole("button", {name: "Create topic"}).last().click();
  await expect(page.getByRole("cell", {name: "orders.created"})).toBeVisible();

  await page.getByRole("menuitem").filter({hasText: "Consumer groups"}).click();
  await page.getByRole("button", {name: "Create group"}).click();
  await page.getByLabel("Group name").fill("fulfilment");
  await page.getByRole("button", {name: "Create group"}).last().click();
  await expect(page.getByRole("cell", {name: "fulfilment"})).toBeVisible();

  await page.getByRole("menuitem").filter({hasText: "Subscriptions"}).click();
  await page.getByRole("button", {name: "Create subscription"}).click();
  await page.getByLabel("Topic").click();
  await page.locator(".ant-select-dropdown:visible").getByText("orders.created", {exact: true}).click();
  await page.getByLabel("Consumer group").click();
  await page.locator(".ant-select-dropdown:visible").getByText("fulfilment", {exact: true}).click();
  await page.getByRole("button", {name: "Continue"}).click();
  await page.getByLabel("HTTP endpoints").fill("https://service.example/events");
  await page.getByRole("button", {name: "Continue"}).click();
  await page.getByRole("button", {name: "Continue"}).click();
  await page.getByRole("button", {name: /Run preview$/}).click();
  await expect(page.getByText("DELIVER", {exact: true})).toBeVisible();
  await page
    .getByRole("dialog", {name: "Create subscription"})
    .getByRole("button", {name: /Create subscription$/})
    .click();
  await expect(page.getByRole("cell", {name: "PUSH"})).toBeVisible();

  await page.getByRole("menuitem").filter({hasText: "Overview"}).click();
  await expect(page.getByText("Delivery readiness")).toBeVisible();
  await expect(page.getByText("Desired configuration published")).toBeVisible();
  await expect(page.getByText("Active topics").locator("..").getByText("1")).toBeVisible();
});
