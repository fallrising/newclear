import {createReadStream, existsSync, statSync} from "node:fs";
import {createServer} from "node:http";
import {extname, join, normalize} from "node:path";

const root = normalize(join(import.meta.dirname, "..", "dist"));
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  const requested = normalize(join(root, pathname));
  const safe =
    requested.startsWith(root) && existsSync(requested) && statSync(requested).isFile()
      ? requested
      : join(root, "index.html");
  response.setHeader("Content-Type", contentTypes[extname(safe)] ?? "application/octet-stream");
  response.setHeader("Cache-Control", "no-store");
  createReadStream(safe).pipe(response);
}).listen(4173, "127.0.0.1");
