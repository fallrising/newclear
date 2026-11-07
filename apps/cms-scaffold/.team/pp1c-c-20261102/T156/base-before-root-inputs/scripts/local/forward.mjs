import net from "node:net";
import { lstatSync, openSync, fstatSync, readFileSync, closeSync, constants } from "node:fs";
import { resolve, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const INPUT = "PP1_LOCAL_FORWARD_INPUT_INVALID", TARGET = "PP1_LOCAL_FORWARD_TARGET_INVALID";
const fullId = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const imageId = (value) => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
function privateIp(ip) {
  if (!net.isIPv4(ip)) return false;
  const [first, second] = ip.split(".").map(Number);
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}
function checkAncestors(path) {
  let current = sep;
  for (const part of path.split(sep).filter(Boolean)) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error(INPUT);
  }
}
function privateMode(stat, mode) {
  return (stat.mode & 0o7777) === mode && (typeof process.getuid !== "function" || stat.uid === process.getuid());
}
function receiptAt(runRoot) {
  const root = resolve(runRoot), parts = root.split(sep);
  if (parts.at(-3) !== "local" || parts.at(-2) !== "pp1" || !/^[a-f0-9]{32}$/.test(parts.at(-1))) throw new Error(INPUT);
  checkAncestors(root);
  const directory = lstatSync(root);
  if (!directory.isDirectory() || !privateMode(directory, 0o700)) throw new Error(INPUT);
  const path = join(root, "receipt.json"); checkAncestors(path);
  if (!lstatSync(path).isFile()) throw new Error(INPUT);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || !privateMode(stat, 0o600) || stat.nlink !== 1 || stat.size > 1048576) throw new Error(INPUT);
    const receipt = JSON.parse(readFileSync(fd, "utf8"));
    if (receipt.version !== 1 || receipt.environment !== "local-isolated" || receipt.phase !== "PREPARED"
      || receipt.runId !== parts.at(-1) || receipt.project !== `cms-pp1-local-${receipt.runId}`
      || !object(receipt.images) || !["api", "node", "postgres"].every((name) => imageId(receipt.images[name]))
      || !/^[a-f0-9]{40}$/.test(receipt.sourceCommit) || receipt.apiOrigin !== "https://api.cms.test:8443"
      || new Date(receipt.preparedAt).toISOString() !== receipt.preparedAt) throw new Error(INPUT);
    return receipt;
  } finally { closeSync(fd); }
}
const execute = promisify(execFile);
async function run(file, args, options) {
  const result = await execute(file, args, { ...options, shell: false, timeout: 5000, maxBuffer: 1048576, encoding: "utf8" });
  return { ...result, code: 0 };
}
function one(result) {
  if (result.code !== 0) throw new Error(TARGET);
  const values = JSON.parse(result.stdout);
  if (!Array.isArray(values) || values.length !== 1 || !object(values[0])) throw new Error(TARGET);
  return values[0];
}
function noDeclaredPorts(value) { return value === null || (object(value) && Object.keys(value).length === 0); }
function noActualPorts(value) {
  return value === null || (object(value) && Object.values(value).every((ports) => ports === null || (Array.isArray(ports) && ports.length === 0)));
}
export async function resolveTarget(runRoot, deps = {}) {
  let receipt, env;
  try {
    const source = deps.env || process.env;
    if ((source.DOCKER_HOST && source.DOCKER_HOST !== "unix:///var/run/docker.sock") || source.DOCKER_CONTEXT) throw new Error(INPUT);
    env = { ...source, DOCKER_HOST: "unix:///var/run/docker.sock" };
    for (const name of ["DOCKER_CONTEXT", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"]) delete env[name];
    if (typeof runRoot !== "string" || !runRoot) throw new Error(INPUT);
    receipt = receiptAt(runRoot);
  } catch { throw new Error(INPUT); }
  try {
    const command = deps.run || run, prefix = ["--host", "unix:///var/run/docker.sock"], web = `${receipt.project}_web`;
    const container = one(await command("docker", [...prefix, "inspect", `${receipt.project}-ingress-1`], { env }));
    const labels = container.Config?.Labels, host = container.HostConfig, settings = container.NetworkSettings;
    if (!fullId(container.Id) || container.Name !== `/${receipt.project}-ingress-1` || container.Image !== receipt.images.node
      || container.State?.Running !== true || labels?.["com.docker.compose.project"] !== receipt.project
      || labels?.["com.docker.compose.service"] !== "ingress" || host?.Privileged !== false || host.NetworkMode !== web
      || !noDeclaredPorts(host.PortBindings) || !noActualPorts(settings?.Ports)
      || !object(settings?.Networks) || Object.keys(settings.Networks).length !== 1 || !Object.hasOwn(settings.Networks, web)) throw new Error(TARGET);
    const endpoint = settings.Networks[web];
    if (!fullId(endpoint.NetworkID) || !privateIp(endpoint.IPAddress) || !Number.isInteger(endpoint.IPPrefixLen)
      || endpoint.IPPrefixLen < 1 || endpoint.IPPrefixLen > 32) throw new Error(TARGET);
    const network = one(await command("docker", [...prefix, "network", "inspect", endpoint.NetworkID], { env }));
    if (network.Id !== endpoint.NetworkID || network.Name !== web || network.Internal !== true || network.Driver !== "bridge"
      || network.Labels?.["com.docker.compose.project"] !== receipt.project || network.Labels?.["com.docker.compose.network"] !== "web"
      || network.Containers?.[container.Id]?.IPv4Address !== `${endpoint.IPAddress}/${endpoint.IPPrefixLen}`) throw new Error(TARGET);
    return Object.freeze({ host: endpoint.IPAddress, port: 8443, containerId: container.Id, networkId: network.Id });
  } catch { throw new Error(TARGET); }
}
export function createForwarder(target, deps = {}) {
  if (!target || !privateIp(target.host) || target.port !== 8443 || !fullId(target.containerId) || !fullId(target.networkId)) throw new Error(TARGET);
  const endpoint = Object.freeze({ host: target.host, port: 8443 }), pairs = new Set();
  const connect = deps.connect || net.connect, idleMs = deps.idleMs ?? 30000;
  const server = net.createServer({ allowHalfOpen: true }, (client) => {
    client.on("error", () => {});
    if (pairs.size >= 64) { client.destroy(); return; }
    let upstream, closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true; pairs.delete(cleanup); client.destroy(); upstream?.destroy();
    };
    pairs.add(cleanup);
    client.on("close", cleanup); client.on("error", cleanup); client.setTimeout(idleMs, cleanup);
    try {
      upstream = connect(endpoint);
      upstream.on("error", cleanup);
      upstream.on("close", (hadError) => { if (hadError || !upstream.readableEnded) cleanup(); });
      upstream.setTimeout(idleMs, cleanup);
      client.pipe(upstream); upstream.pipe(client);
    } catch { cleanup(); }
  });
  let stopping;
  const signals = deps.signals;
  const stop = () => {
    if (!stopping) {
      for (const cleanup of pairs) cleanup();
      stopping = new Promise((done) => server.close(() => done()));
    }
    return stopping;
  };
  server.stop = stop;
  if (signals) {
    for (const signal of ["SIGINT", "SIGTERM"]) signals.once(signal, stop);
    server.once("close", () => { for (const signal of ["SIGINT", "SIGTERM"]) signals.removeListener(signal, stop); });
  }
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== "--run-root" || !args[1]) throw new Error(INPUT);
    const target = await resolveTarget(args[1]), server = createForwarder(target, { signals: process });
    server.on("error", () => { console.error("PP1_LOCAL_FORWARD_START_FAILED"); process.exitCode = 2; void server.stop(); });
    server.once("listening", () => console.log("PP1_LOCAL_FORWARD_LISTENING"));
    server.once("close", () => console.log("PP1_LOCAL_FORWARD_STOPPED"));
    server.listen(8443, "127.0.0.1");
  } catch (error) { console.error(error.message === INPUT ? INPUT : TARGET); process.exitCode = 2; }
}
