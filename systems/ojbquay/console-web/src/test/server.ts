import {http, HttpResponse} from "msw";
import {setupServer} from "msw/node";

const ok = <T,>(data: T, status = 200) =>
  HttpResponse.json({code: "OK", msg: "", data}, {status});

export const fixtures = {
  actor: {username: "admin", roles: ["ADMIN", "OPS"]},
  topics: [{
    id: 1,
    name: "orders.created",
    clusterId: 1,
    partitions: 3,
    replication: 1,
    delayTopic: false,
    maxMessageBytes: 1_048_576,
    retentionMs: 604_800_000,
    produceQuotaTps: 1_000,
    compression: "zstd",
    token: "topic-token",
    owner: "admin",
    state: 1,
    version: 2,
    remark: "",
    createdAt: "2026-07-29T00:00:00Z",
    updatedAt: "2026-07-29T00:00:00Z",
  }],
  groups: [{
    id: 1,
    name: "fulfilment",
    token: "group-token",
    owner: "admin",
    state: 1,
    version: 2,
    remark: "",
    createdAt: "2026-07-29T00:00:00Z",
    updatedAt: "2026-07-29T00:00:00Z",
  }],
  subscriptions: [{
    id: 1,
    groupId: 1,
    topicId: 1,
    spec: {mode: "PUSH"},
    state: 1,
    version: 2,
    owner: "admin",
    createdAt: "2026-07-29T00:00:00Z",
    updatedAt: "2026-07-29T00:00:00Z",
  }],
};

export const server = setupServer(
  http.get("/api/v1/auth/csrf", () =>
    ok({headerName: "X-XSRF-TOKEN", parameterName: "_csrf", token: "test-csrf"})),
  http.get("/api/v1/auth/me", () => ok(fixtures.actor)),
  http.post("/api/v1/auth/login", () => ok(fixtures.actor)),
  http.post("/api/v1/auth/logout", () => ok(null)),
  http.get("/api/v1/topics", () => ok(fixtures.topics)),
  http.get("/api/v1/groups", () => ok(fixtures.groups)),
  http.get("/api/v1/subscriptions", () => ok(fixtures.subscriptions)),
  http.get("/api/v1/clusters", () => ok([{
    id: 1,
    name: "local",
    bootstrapServers: "kafka:19092",
    defaultCluster: true,
    createdAt: "2026-07-29T00:00:00Z",
  }])),
  http.get("/api/v1/clusters/:id/health", () => ok({
    clusterId: "test-cluster",
    controllerId: 1,
    nodeCount: 1,
    status: "UP",
  })),
  http.get("/api/v1/groups/:id/progress", () => ok([])),
  http.post("/api/v1/subscriptions/preview", async ({request}) => {
    const body = await request.json() as {
      sampleMessage: {valueBase64: string};
    };
    return ok({
      action: "DELIVER",
      reason: "",
      valueBase64: body.sampleMessage.valueBase64,
    });
  }),
  http.post("/api/v1/subscriptions", () =>
    ok({...fixtures.subscriptions[0], id: 2}, 201)),
);
