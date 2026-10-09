import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { EventEmitter, once } from "node:events";
import { mkdtemp, mkdir, writeFile, chmod, symlink, link, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveTarget, createForwarder } from "./forward.mjs";

const runId = "a".repeat(32), project = `cms-pp1-local-${runId}`, web = `${project}_web`;
const containerId = "b".repeat(64), networkId = "c".repeat(64), image = `sha256:${"d".repeat(64)}`;
const target = { host: "172.18.0.2", port: 8443, containerId, networkId };
async function owned(t) {
  const temp = await mkdtemp(join(tmpdir(), "pp1-forward-")), root = join(temp, "local", "pp1", runId);
  await mkdir(root, { recursive: true, mode: 0o700 });
  t.after(() => rm(temp, { recursive: true, force: true }));
  const receipt = { version: 1, environment: "local-isolated", phase: "PREPARED", runId, project,
    sourceCommit: "e".repeat(40), images: { api: image, node: image, postgres: image }, apiOrigin: "https://api.cms.test:8443", preparedAt: "2026-10-09T00:00:00.000Z" };
  const container = { Id: containerId, Name: `/${project}-ingress-1`, Image: image, State: { Running: true },
    Config: { Labels: { "com.docker.compose.project": project, "com.docker.compose.service": "ingress" } },
    HostConfig: { Privileged: false, NetworkMode: web, PortBindings: {} },
    NetworkSettings: { Ports: { "8443/tcp": null }, Networks: { [web]: { NetworkID: networkId, IPAddress: target.host, IPPrefixLen: 16 } } } };
  const network = { Id: networkId, Name: web, Internal: true, Driver: "bridge",
    Labels: { "com.docker.compose.project": project, "com.docker.compose.network": "web" },
    Containers: { [containerId]: { IPv4Address: `${target.host}/16` } } };
  const path = join(root, "receipt.json"), commands = [];
  const save = () => writeFile(path, JSON.stringify(receipt), { mode: 0o600 }); await save();
  const run = async (file, args, options) => {
    assert.equal(file, "docker"); assert.deepEqual(args.slice(0, 2), ["--host", "unix:///var/run/docker.sock"]);
    assert.equal(options.env.DOCKER_HOST, "unix:///var/run/docker.sock"); assert.equal(options.env.DOCKER_CONTEXT, undefined);
    commands.push(args);
    return { code: 0, stdout: JSON.stringify(args[2] === "network" ? [network] : [container]), stderr: "" };
  };
  return { temp, root, path, receipt, container, network, commands, save, deps: { run, env: {} } };
}
test("valid owned target resolves only fixed local Docker/private endpoint", async (t) => {
  const f = await owned(t); const result = await resolveTarget(f.root, f.deps);
  assert.deepEqual(result, target); assert.ok(Object.isFrozen(result));
  assert.deepEqual(f.commands, [["--host", "unix:///var/run/docker.sock", "inspect", `${project}-ingress-1`], ["--host", "unix:///var/run/docker.sock", "network", "inspect", networkId]]);
});
test("reject receipt/path/permissions/remote inputs before Docker", async (t) => {
  const f = await owned(t);
  for (const change of [ { project: "stranger" }, { environment: "production" }, { phase: "FAILED" }, { images: { node: "short" } }, { runId: "other" } ]) {
    const original = structuredClone(f.receipt); Object.assign(f.receipt, change); await f.save();
    await assert.rejects(resolveTarget(f.root, f.deps), /PP1_LOCAL_FORWARD_INPUT_INVALID/);
    for (const key of Object.keys(f.receipt)) delete f.receipt[key]; Object.assign(f.receipt, original);
  }
  await f.save();
  for (const env of [{ DOCKER_HOST: "tcp://remote:2375" }, { DOCKER_CONTEXT: "remote" }]) await assert.rejects(resolveTarget(f.root, { ...f.deps, env }), /INPUT_INVALID/);
  await chmod(f.root, 0o755); await assert.rejects(resolveTarget(f.root, f.deps), /INPUT_INVALID/); await chmod(f.root, 0o700);
  await chmod(f.path, 0o644); await assert.rejects(resolveTarget(f.root, f.deps), /INPUT_INVALID/); await chmod(f.path, 0o600);
  await link(f.path, join(f.root, "hardlink")); await assert.rejects(resolveTarget(f.root, f.deps), /INPUT_INVALID/); await rm(join(f.root, "hardlink"));
  await symlink(f.root, join(f.temp, "linked-root")); await assert.rejects(resolveTarget(join(f.temp, "linked-root"), f.deps), /INPUT_INVALID/);
  await mkdir(join(f.temp, "entry"), { mode: 0o700 });
  await symlink(join(f.temp, "local"), join(f.temp, "entry", "local"));
  await assert.rejects(resolveTarget(join(f.temp, "entry", "local", "pp1", runId), f.deps), /INPUT_INVALID/);
  await assert.rejects(resolveTarget(join(f.temp, "not-a-run"), f.deps), /INPUT_INVALID/);
  assert.equal(f.commands.length, 0);
});
test("wrong container/network/IPv4/declared or actual ports all reject", async (t) => {
  const f = await owned(t);
  const changes = [
    () => { f.container.Id = "short"; }, () => { f.container.Image = `sha256:${"0".repeat(64)}`; },
    () => { f.container.Config.Labels["com.docker.compose.project"] = "stranger"; },
    () => { f.container.Config.Labels["com.docker.compose.service"] = "postgres"; },
    () => { f.container.State.Running = false; }, () => { f.container.HostConfig.Privileged = true; },
    () => { f.container.HostConfig.NetworkMode = "host"; },
    () => { f.container.HostConfig.PortBindings = { "8443/tcp": [{ HostIp: "127.0.0.1", HostPort: "8443" }] }; },
    () => { f.container.NetworkSettings.Ports["8443/tcp"] = [{ HostIp: "127.0.0.1", HostPort: "8443" }]; },
    () => { f.container.NetworkSettings.Networks.extra = {}; },
    () => { f.container.NetworkSettings.Networks[web].IPAddress = "8.8.8.8"; },
    () => { f.container.NetworkSettings.Networks[web].IPAddress = "127.0.0.1"; },
    () => { f.network.Internal = false; }, () => { f.network.Id = "short"; },
    () => { f.network.Name = "wrong"; }, () => { f.network.Labels["com.docker.compose.project"] = "wrong"; },
    () => { f.network.Containers[containerId].IPv4Address = "172.18.0.3/16"; },
    () => { delete f.network.Containers[containerId]; },
  ];
  for (const mutate of changes) {
    const container = structuredClone(f.container), network = structuredClone(f.network); mutate();
    await assert.rejects(resolveTarget(f.root, f.deps), /PP1_LOCAL_FORWARD_TARGET_INVALID/);
    for (const key of Object.keys(f.container)) delete f.container[key]; Object.assign(f.container, container);
    for (const key of Object.keys(f.network)) delete f.network[key]; Object.assign(f.network, network);
  }
  await assert.rejects(resolveTarget(f.root, { ...f.deps, run: async () => ({ code: 1, stdout: "secret-canary", stderr: "secret-canary" }) }), { message: "PP1_LOCAL_FORWARD_TARGET_INVALID" });
});
async function listening(t, server) {
  const sockets = new Set(); server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise((done) => server.close(done)); });
  return server.address().port;
}
function exchange(port, payload) {
  return new Promise((done, reject) => {
    const chunks = [], socket = net.connect({ host: "127.0.0.1", port }, () => socket.end(payload));
    socket.on("data", (chunk) => chunks.push(chunk)); socket.on("error", reject);
    socket.on("close", () => done(Buffer.concat(chunks)));
  });
}
test("raw binary relay preserves both directions with stream backpressure", async (t) => {
  const greeting = Buffer.from([22, 3, 3, 0, 255]), payload = Buffer.alloc(2 * 1024 * 1024, 137);
  const echo = net.createServer((socket) => { socket.write(greeting); socket.pipe(socket); });
  const echoPort = await listening(t, echo); let connects = 0;
  const server = createForwarder(target, { connect(options) { assert.deepEqual(options, { host: target.host, port: 8443 }); connects++; return net.connect({ host: "127.0.0.1", port: echoPort }); } });
  const port = await listening(t, server);
  const expected = Buffer.concat([greeting, payload]), received = await exchange(port, payload);
  assert.equal(received.length, expected.length); assert.ok(received.equals(expected)); assert.equal(connects, 1);
});
test("clean upstream end drains 2MiB response to explicitly paused receiver", async (t) => {
  const payload = Buffer.alloc(2 * 1024 * 1024, 193), producer = net.createServer((socket) => socket.end(payload));
  const producerPort = await listening(t, producer); let blocked, relayClient, held = false;
  const backpressure = new Promise((done) => { blocked = done; });
  const server = createForwarder(target, { connect: () => net.connect({ host: "127.0.0.1", port: producerPort }) });
  let destroyedBeforeDrain = false;
  server.on("connection", (socket) => {
    relayClient = socket;
    const write = socket.write, destroy = socket.destroy;
    socket.write = function (...args) {
      const accepted = write.apply(this, args);
      // Hold the first pipe write independently of OS send-buffer capacity.
      if (!held) { held = true; blocked(); return false; }
      return accepted;
    };
    socket.destroy = function (...args) { if (this.writableLength > 0) destroyedBeforeDrain = true; return destroy.apply(this, args); };
  });
  const port = await listening(t, server), chunks = [], client = net.connect({ host: "127.0.0.1", port });
  const finished = once(client, "close"); client.on("data", (chunk) => chunks.push(chunk)); client.pause();
  await once(client, "connect"); await backpressure; client.resume(); relayClient.emit("drain"); await finished;
  const received = Buffer.concat(chunks);
  assert.equal(received.length, payload.length); assert.ok(received.equals(payload)); assert.equal(destroyedBeforeDrain, false);
});
class FakeSocket extends EventEmitter {
  constructor() { super(); this.destroyed = false; this.pipes = []; }
  pipe(destination) { this.pipes.push(destination); return destination; }
  end() { return this.destroy(); }
  setTimeout(milliseconds, callback) { this.timeoutMs = milliseconds; this.timeout = callback; return this; }
  destroy() { if (!this.destroyed) { this.destroyed = true; this.emit("close"); } return this; }
}
test("clean EOF leaves peer to drain; abrupt close destroys peer", async () => {
  for (const readableEnded of [true, false]) {
    const upstream = new FakeSocket(), client = new FakeSocket();
    const server = createForwarder(target, { connect: () => upstream });
    server.emit("connection", client); upstream.readableEnded = readableEnded; upstream.destroy();
    assert.equal(client.destroyed, !readableEnded);
    await server.stop(); assert.equal(client.destroyed, true);
  }
});
test("64 connections bounded, idle30s and paired error/close cleanup", async () => {
  const upstream = []; const server = createForwarder(target, { connect() { const socket = new FakeSocket(); upstream.push(socket); return socket; } });
  const clients = Array.from({ length: 65 }, () => new FakeSocket());
  for (const client of clients) server.emit("connection", client);
  assert.equal(upstream.length, 64); assert.equal(clients[64].destroyed, true);
  assert.equal(clients[0].timeoutMs, 30000); assert.equal(upstream[0].timeoutMs, 30000);
  clients[0].timeout(); assert.equal(upstream[0].destroyed, true);
  const next = new FakeSocket(); server.emit("connection", next); assert.equal(upstream.length, 65);
  upstream[1].emit("error", new Error("secret-canary")); assert.equal(clients[1].destroyed, true);
  clients[2].destroy(); assert.equal(upstream[2].destroyed, true);
  await server.stop(); assert.ok([...clients, next, ...upstream].every((socket) => socket.destroyed));
});
test("SIGINT/SIGTERM stop listener and active pairs without content logs", async (t) => {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    const signals = new EventEmitter(), active = new FakeSocket();
    const server = createForwarder(target, { signals, connect: () => active });
    const port = await listening(t, server), client = net.connect({ host: "127.0.0.1", port });
    await once(client, "connect"); client.resume();
    const stopped = once(server, "close"), clientClosed = once(client, "close"); signals.emit(signal);
    await stopped; await clientClosed;
    assert.equal(server.listening, false); assert.equal(active.destroyed, true); assert.equal(client.destroyed || client.readableEnded, true);
  }
});
test("failed target has no retry and next connection works; client abort destroys upstream", async (t) => {
  const echo = net.createServer((socket) => socket.pipe(socket)), echoPort = await listening(t, echo); let connects = 0, first;
  const server = createForwarder(target, { connect() {
    connects++; if (connects === 1) { first = new FakeSocket(); queueMicrotask(() => first.emit("error", new Error("secret-canary"))); return first; }
    return net.connect({ host: "127.0.0.1", port: echoPort });
  } });
  const port = await listening(t, server);
  assert.equal((await exchange(port, Buffer.from("failed"))).length, 0); assert.equal(connects, 1);
  assert.equal((await exchange(port, Buffer.from("next"))).toString(), "next"); assert.equal(connects, 2);
  const upstream = new FakeSocket(), abortServer = createForwarder(target, { connect: () => upstream });
  const abortPort = await listening(t, abortServer), client = net.connect({ host: "127.0.0.1", port: abortPort });
  await once(client, "connect"); const closed = once(upstream, "close"); client.destroy(); await closed; assert.equal(upstream.destroyed, true);
});
test("CLI rejects arbitrary host/port/commands with fixed input code", () => {
  const script = fileURLToPath(new URL("./forward.mjs", import.meta.url));
  for (const args of [["--host", "secret-canary"], ["--run-root", "/missing", "--port", "8443"]]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
    assert.equal(result.status, 2); assert.equal(result.stdout, ""); assert.equal(result.stderr, "PP1_LOCAL_FORWARD_INPUT_INVALID\n");
  }
});
