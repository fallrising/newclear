/**
 * Minimal clarkQ HTTP client (Node 18+ / modern browsers with fetch).
 */
export class APIError extends Error {
  constructor(status, code, message) {
    super(`${message} (${code}, http ${status})`);
    this.name = "APIError";
    this.status = status;
    this.code = code;
    this.messageText = message;
  }
}

export class Client {
  /**
   * @param {string} baseURL
   * @param {string} [apiKey]
   * @param {typeof fetch} [fetchImpl]
   */
  constructor(baseURL, apiKey = "", fetchImpl = globalThis.fetch.bind(globalThis)) {
    this.baseURL = baseURL.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
  }

  async health() {
    const res = await this.fetch(`${this.baseURL}/health`);
    if (!res.ok) throw new APIError(res.status, "HTTP_ERROR", await res.text());
  }

  /**
   * @param {string} queue
   * @param {string} body
   * @param {Record<string, string>} [metadata]
   * @param {object} [encryption]
   */
  async enqueue(queue, body, metadata, encryption) {
    const payload = { body };
    if (metadata) payload.metadata = metadata;
    if (encryption) payload.encryption = encryption;
    return this.#json(
      "POST",
      `/api/v1/queue/${encodeURIComponent(queue)}`,
      payload
    );
  }

  /**
   * @param {string} queue
   * @param {{ peek?: boolean, timeout?: number }} [opts]
   * @returns {Promise<object|null>} null when queue empty (204)
   */
  async dequeue(queue, opts = {}) {
    const params = new URLSearchParams();
    if (opts.peek) params.set("peek", "true");
    if (opts.timeout) params.set("timeout", String(opts.timeout));
    const qs = params.toString();
    const path = `/api/v1/queue/${encodeURIComponent(queue)}${qs ? `?${qs}` : ""}`;
    const res = await this.#request("GET", path);
    if (res.status === 204) return null;
    if (!res.ok) throw await this.#toError(res);
    return res.json();
  }

  async clear(queue) {
    const data = await this.#json("DELETE", `/api/v1/queue/${encodeURIComponent(queue)}`);
    return data.cleared ?? 0;
  }

  async listQueues() {
    const data = await this.#json("GET", "/api/v1/queues");
    return data.queues ?? [];
  }

  async #json(method, path, body) {
    const res = await this.#request(method, path, body);
    if (!res.ok) throw await this.#toError(res);
    if (res.status === 204) return {};
    return res.json();
  }

  #request(method, path, body) {
    const headers = {};
    let payload;
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    if (this.apiKey) headers["X-API-Key"] = this.apiKey;
    return this.fetch(`${this.baseURL}${path}`, { method, headers, body: payload });
  }

  async #toError(res) {
    const text = await res.text();
    try {
      const data = JSON.parse(text);
      const err = data.error || {};
      return new APIError(res.status, err.code || "HTTP_ERROR", err.message || text);
    } catch {
      return new APIError(res.status, "HTTP_ERROR", text);
    }
  }
}
