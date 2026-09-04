import {http, HttpResponse} from "msw";
import {describe, expect, it} from "vitest";
import {api} from "../api";
import {server} from "./server";

describe("API client", () => {
  it("preserves stable control-plane errors", async () => {
    server.use(
      http.post("/api/v1/topics", () =>
        HttpResponse.json(
          {code: "CONFLICT", msg: "topic already exists", data: null},
          {status: 409},
        )),
    );
    await expect(
      api("/api/v1/topics", {method: "POST", body: "{}"}),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "CONFLICT",
        message: "topic already exists",
        status: 409,
      }),
    );
  });
});
