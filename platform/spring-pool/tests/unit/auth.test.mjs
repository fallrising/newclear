import { test } from "node:test";
import assert from "node:assert/strict";
import { createAuthenticator } from "../../web/src/auth.ts";

const now = 1800000000;
const env = {
  ENVIRONMENT: "staging",
  AUTH_MODE: "access",
  ACCESS_TEAM_DOMAIN: "unit.cloudflareaccess.com",
  ACCESS_AUD: "unit-app",
  OWNER_EMAIL: "Owner@Example.test",
};
const keys = await crypto.subtle.generateKey(
  {
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  },
  true,
  ["sign", "verify"],
);
const jwk = {
  ...(await crypto.subtle.exportKey("jwk", keys.publicKey)),
  kid: "key-1",
  alg: "RS256",
  use: "sig",
};
const b64 = (v) =>
  Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString(
    "base64url",
  );
async function token(overrides = {}, header = {}) {
  const unsigned = `${b64({ alg: "RS256", kid: "key-1", ...header })}.${b64({ iss: "https://unit.cloudflareaccess.com", aud: ["unit-app"], exp: now + 60, email: "OWNER@example.test", ...overrides })}`;
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keys.privateKey,
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${Buffer.from(sig).toString("base64url")}`;
}
function request(jwt, host = "staging.example.test") {
  return new Request(`https://${host}/scripts`, {
    headers: jwt
      ? {
          "Cf-Access-Jwt-Assertion": jwt,
          "X-Spring-Pool-Actor": "attacker@example.test",
        }
      : { "X-Spring-Pool-Actor": "attacker@example.test" },
  });
}
function auth(fetcher = async () => Response.json({ keys: [jwk] })) {
  return createAuthenticator({ fetch: fetcher, now: () => now });
}
test("valid signed Access identity becomes normalized owner; forged actor header is irrelevant", async () => {
  assert.deepEqual(await auth()(request(await token()), env), {
    ok: true,
    actor: "owner@example.test",
    local: false,
  });
});
test("invalid credentials fail closed", async (t) => {
  for (const [name, jwt, status] of [
    ["missing", undefined, 401],
    ["expired", await token({ exp: now }), 401],
    ["wrong audience", await token({ aud: ["other"] }), 401],
    ["wrong issuer", await token({ iss: "https://evil.example" }), 401],
    ["future nbf", await token({ nbf: now + 61 }), 401],
    ["invalid exp", await token({ exp: "forever" }), 401],
    ["wrong owner", await token({ email: "other@example.test" }), 403],
    ["algorithm confusion", await token({}, { alg: "none" }), 401],
    ["unknown kid", await token({}, { kid: "unknown" }), 401],
    [
      "bad signature",
      (await token()).replace(
        /\.([A-Za-z0-9_-])(?=[A-Za-z0-9_-]+$)/,
        (_m, x) => "." + (x === "A" ? "B" : "A"),
      ),
      401,
    ],
  ])
    await t.test(name, async () =>
      assert.equal((await auth()(request(jwt), env)).status, status),
    );
});
test("configuration is mandatory and cannot target arbitrary JWKS hosts", async () => {
  for (const patch of [
    { AUTH_MODE: "unknown" },
    { ACCESS_AUD: "" },
    { OWNER_EMAIL: "" },
    { ACCESS_TEAM_DOMAIN: "evil.example/a" },
    { ACCESS_TEAM_DOMAIN: "unit.cloudflareaccess.com.evil.test" },
  ]) {
    let calls = 0;
    const result = await auth(async () => {
      calls++;
      throw new Error("must not fetch");
    })(request(await token()), { ...env, ...patch });
    assert.equal(result.status, 503);
    assert.equal(calls, 0);
  }
});
test("local mode requires local environment, loopback and explicit identity", async () => {
  const local = {
    AUTH_MODE: "local",
    ENVIRONMENT: "local",
    LOCAL_OWNER_EMAIL: "Owner@Example.test",
  };
  assert.deepEqual(await auth()(request(undefined, "localhost"), local), {
    ok: true,
    actor: "owner@example.test",
    local: true,
  });
  for (const [host, config] of [
    ["localhost", { ...local, ENVIRONMENT: "staging" }],
    ["public.example.test", local],
    ["localhost", { ...local, LOCAL_OWNER_EMAIL: "" }],
  ])
    assert.equal((await auth()(request(undefined, host), config)).status, 503);
});
test("JWKS failure is observable as unavailable and never grants identity", async () => {
  assert.equal(
    (
      await auth(async () => {
        throw new Error("offline");
      })(request(await token()), env)
    ).status,
    503,
  );
});
test("JWKS cache is per configured issuer and refetches unknown kid", async () => {
  let calls = 0;
  const verify = auth(async () => {
    calls++;
    return Response.json({ keys: [jwk] });
  });
  await verify(request(await token()), env);
  await verify(request(await token()), env);
  assert.equal(calls, 1);
  await verify(request(await token({}, { kid: "next-key" })), env);
  assert.equal(calls, 2);
});
