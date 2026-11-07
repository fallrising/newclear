/* MIT License — Copyright (c) 2026 yetone
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE. */
// Response-only Bun FetchSession observation, inspired by yetone/magpie (MIT),
// a6217e83d3caa8b870fc200b252226bf7c5560e9 internal/claudetui/tap.js.
// Requests, auth, headers and TLS are passed unchanged to the original implementation.
(() => {
  const path = process.env.THINROUTER_CLAUDE_TAP;
  if (!path) return;
  delete process.env.THINROUTER_CLAUDE_TAP;
  // The helper supplies only its own preload. Do not propagate it into MCP children.
  delete process.env.BUN_OPTIONS;
  for (let i = process.execArgv.length - 1; i >= 0; i--) {
    if (!process.execArgv[i].includes("thinrouter-claude-tui-")) continue;
    if (process.execArgv[i].startsWith("--preload=")) process.execArgv.splice(i, 1);
    else if (process.execArgv[i - 1] === "--preload") process.execArgv.splice(--i, 2);
  }
  const fs = require("fs");
  let fd;
  try { fd = fs.openSync(path, "a"); } catch { return; }
  let bytes = 0;
  let stopped = false;
  const put = row => {
    if (stopped) throw new Error("tap stopped");
    const line = JSON.stringify(row) + "\n";
    const size = Buffer.byteLength(line);
    // Reserve space for one fixed terminal failure so the Rust reader cannot
    // wait forever when payload observation exhausts its bounded file budget.
    if (bytes + size > 64 * 1024 * 1024 - 1024) {
      stopped = true;
      fs.writeSync(fd, '{"tap":"limit"}\n');
      throw new Error("tap limit");
    }
    fs.writeSync(fd, line);
    bytes += size;
  };
  const Real = globalThis.Bun && Bun.FetchSession;
  if (typeof Real !== "function") { put({tap: "none"}); return; }
  let number = 0;
  const read = async (s, body) => {
    const decoder = new TextDecoder("utf-8", {fatal: true});
    let pending = "";
    let heldCR = false;
    const consume = text => {
      // CRLF may be split across chunks; never manufacture an extra event boundary.
      for (const ch of text) {
        if (heldCR) { pending += "\n"; heldCR = false; if (ch === "\n") continue; }
        if (ch === "\r") heldCR = true; else pending += ch;
        if (pending.length > 8 * 1024 * 1024) throw new Error("event limit");
      }
      let at;
      while ((at = pending.indexOf("\n\n")) !== -1) {
        const block = pending.slice(0, at); pending = pending.slice(at + 2);
        const data = block.split("\n").filter(l => l.startsWith("data:"))
          .map(l => l.slice(5).replace(/^ /, "")).join("\n");
        if (!data) continue;
        const e = JSON.parse(data);
        if (!e || typeof e.type !== "string") throw new Error("invalid event");
        if (e.type !== "ping") put({s, e});
      }
    };
    try {
      for await (const chunk of body) consume(decoder.decode(chunk, {stream: true}));
      consume(decoder.decode());
      if (heldCR) { heldCR = false; consume("\n"); }
      if (pending.trim()) throw new Error("truncated event");
      put({s, end: "done"});
    } catch {
      try { put({s, end: "cut"}); } catch {}
    }
  };
  class FetchSession extends Real {
    async fetch(input, init) {
      const url = String((input && input.url) || input);
      const headers = new Headers((init && init.headers) || (input && input.headers));
      const selected = headers.get("x-claude-code-request-class") === "main" &&
          /\/v1\/messages(?:\?|$)/.test(url);
      let response;
      try { response = await super.fetch(input, init); }
      catch (error) {
        if (selected) { try { put({tap: "request_failed"}); } catch {} }
        throw error;
      }
      if (selected) {
        const s = ++number;
        try {
          put({s, open: true});
          if (!response.ok) {
            put({s, http_status: response.status});
          } else if (!response.body || !/^text\/event-stream/i.test(response.headers.get("content-type") || "")) {
            put({s, end: "cut"});
          } else {
            // clone updates the response's internal stream consistently too; replacing
            // just its public body property would break text()/json() consumers.
            const observer = response.clone();
            void read(s, observer.body);
          }
        } catch { try { put({s, end: "cut"}); } catch {} }
      }
      return response;
    }
  }
  try { Bun.FetchSession = FetchSession; } catch {}
  put({tap: Bun.FetchSession === FetchSession ? "on" : "none"});
})();
