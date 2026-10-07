import { WorkflowEntrypoint } from "cloudflare:workers";

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

async function body(request) {
  if (!request.body) throw new Error("body required");
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2048) throw new Error("body too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const input = JSON.parse(new TextDecoder().decode(bytes));
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).sort().join(",") !== "id,payload" ||
      typeof input.id !== "string" || !ID.test(input.id) || typeof input.payload !== "string" ||
      input.payload.length > 128) throw new Error("invalid submission");
  return input;
}

async function readJob(db, id) {
  const job = await db.prepare(
    "SELECT id, payload, callback_count, step_nonce, completed FROM jobs WHERE id = ?"
  ).bind(id).first();
  const count = await db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE id = ?")
    .bind(id).first();
  return { job, row_count: count.count };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ fixture: "open-compute-m1", ok: true });
    }
    if (request.method === "POST" && url.pathname === "/jobs") {
      let input;
      try { input = await body(request); }
      catch { return Response.json({ error: "invalid submission" }, { status: 400 }); }
      await env.DB.prepare(
        "INSERT INTO jobs(id, payload) VALUES (?, ?) ON CONFLICT(id) DO NOTHING"
      ).bind(input.id, input.payload).run();
      const result = await readJob(env.DB, input.id);
      if (result.job.payload !== input.payload) {
        return Response.json({ error: "id already has a different payload" }, { status: 409 });
      }
      return Response.json(result);
    }
    if (request.method === "GET" && url.pathname.startsWith("/jobs/")) {
      const id = url.pathname.slice("/jobs/".length);
      if (!ID.test(id)) return Response.json({ error: "invalid id" }, { status: 400 });
      const result = await readJob(env.DB, id);
      return Response.json(result, { status: result.job ? 200 : 404 });
    }
    return Response.json({ error: "route not found" }, { status: 404 });
  }
};

export class LabFlow extends WorkflowEntrypoint {
  async run(event, step) {
    const id = event.payload.jobId;
    if (typeof id !== "string" || !ID.test(id)) throw new Error("invalid job id");
    const first = await step.do("instrumented-callback", async () => {
      const nonce = crypto.randomUUID();
      // A replay increments this counter again and replaces the nonce. Do not
      // change this to an idempotent upsert: that would hide callback replay.
      await this.env.DB.prepare(
        "UPDATE jobs SET callback_count = callback_count + 1, step_nonce = ? WHERE id = ?"
      ).bind(nonce, id).run();
      const { job } = await readJob(this.env.DB, id);
      if (!job) throw new Error("job does not exist");
      return { jobId: id, nonce };
    });
    const approval = await step.waitForEvent("approval", {
      type: "approval", timeout: "5 minutes"
    });
    if (approval.payload.approved !== true) throw new Error("approval required");
    await step.do("record-completion", async () => {
      await this.env.DB.prepare("UPDATE jobs SET completed = 1 WHERE id = ?")
        .bind(id).run();
      return { recorded: true };
    });
    return { jobId: id, nonce: first.nonce };
  }
}
