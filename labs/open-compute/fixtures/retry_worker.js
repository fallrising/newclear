import { WorkflowEntrypoint } from "cloudflare:workers";

const ID = /^[a-z0-9][a-z0-9-]{0,63}(?![\s\S])/;
const CASES = ["unguarded", "idempotent", "exhausted"];
const POLICY = { retries: { limit: 1, delay: 100, backoff: "constant" }, timeout: 5000 };

async function readJob(db, id) {
  const job = await db.prepare("SELECT id, case_name, completed FROM retry_jobs WHERE id = ?").bind(id).first();
  const jobs = await db.prepare("SELECT COUNT(*) AS count FROM retry_jobs WHERE id = ?").bind(id).first();
  const entries = await db.prepare(
    "SELECT attempt, retry_limit, delay_ms, backoff, timeout_ms, effect_acknowledged, outcome_marker FROM retry_entries WHERE job_id = ? ORDER BY seq LIMIT 3"
  ).bind(id).all();
  const count = await db.prepare("SELECT COUNT(*) AS count FROM retry_entries WHERE job_id = ?").bind(id).first();
  const effects = await db.prepare("SELECT COUNT(*) AS count FROM retry_effects WHERE job_id = ?").bind(id).first();
  return { job, job_count: jobs.count, entries: entries.results, entry_count: count.count, effect_count: effects.count };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "GET" || url.search) {
      return Response.json({ error: "route not found" }, { status: 404 });
    }
    if (url.pathname === "/health") return Response.json({ fixture: "open-compute-m6", ok: true });
    if (url.pathname.startsWith("/jobs/")) {
      const id = url.pathname.slice(6);
      if (!ID.test(id)) return Response.json({ error: "invalid id" }, { status: 400 });
      const value = await readJob(env.DB, id);
      return Response.json(value, { status: value.job ? 200 : 404 });
    }
    return Response.json({ error: "route not found" }, { status: 404 });
  }
};

function boundedInteger(value) {
  return Number.isInteger(value) && value >= 0 && value <= 10000 ? value : -1;
}

export class RetryFlow extends WorkflowEntrypoint {
  async run(event, step) {
    const input = event.payload;
    if (!input || typeof input !== "object" || Array.isArray(input) ||
        Object.keys(input).sort().join(",") !== "caseName,jobId" ||
        typeof input.jobId !== "string" || !ID.test(input.jobId) || !CASES.includes(input.caseName)) {
      throw new Error("invalid retry input");
    }
    const { jobId, caseName } = input;
    const result = await step.do("controlled-effect", POLICY, async (ctx) => {
      // Independent identity records repeated attempts rather than concealing them.
      const entryId = crypto.randomUUID();
      const attempt = boundedInteger(ctx?.attempt);
      const retryLimit = boundedInteger(ctx?.config?.retries?.limit);
      const delay = boundedInteger(ctx?.config?.retries?.delay);
      const backoff = ctx?.config?.retries?.backoff === "constant" ? "constant" : "invalid";
      const timeout = boundedInteger(ctx?.config?.timeout);
      await this.env.DB.prepare(
        "INSERT INTO retry_entries(entry_id,job_id,attempt,retry_limit,delay_ms,backoff,timeout_ms) SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM retry_entries WHERE job_id = ?) < 3"
      ).bind(entryId, jobId, attempt, retryLimit, delay, backoff, timeout, jobId).run();
      if ((attempt !== 1 && attempt !== 2) || retryLimit !== 1 || delay !== 100 ||
          backoff !== "constant" || timeout !== 5000 || ctx?.step?.name !== "controlled-effect") {
        throw new Error("unexpected retry context");
      }
      if (caseName === "idempotent") {
        await this.env.DB.prepare(
          "INSERT INTO retry_effects(job_id,operation_key) VALUES (?,?) ON CONFLICT(operation_key) DO NOTHING"
        ).bind(jobId, "effect-" + jobId).run();
      } else {
        await this.env.DB.prepare("INSERT INTO retry_effects(job_id,operation_key) VALUES (?,?)")
          .bind(jobId, null).run();
      }
      const shouldThrow = attempt === 1 || caseName === "exhausted";
      await this.env.DB.prepare(
        "UPDATE retry_entries SET effect_acknowledged = ?, outcome_marker = ? WHERE entry_id = ? AND job_id = ?"
      ).bind(1, shouldThrow ? "throw" : "return", entryId, jobId).run();
      // No asynchronous work occurs between acknowledgement and fixed outcome.
      if (shouldThrow) throw new Error("controlled retry failure");
      return { jobId, caseName, attempt: 2 };
    });
    await this.env.DB.prepare("UPDATE retry_jobs SET completed = ? WHERE id = ?").bind(1, jobId).run();
    return result;
  }
}
