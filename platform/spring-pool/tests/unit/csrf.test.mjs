import { test } from "node:test";
import assert from "node:assert/strict";
import { csrfForRequest, verifyCsrf } from "../../web/src/csrf.ts";
const token = "a".repeat(43);
function request(
  origin = "https://app.example.test",
  cookie = `__Host-sp_csrf=${token}`,
) {
  return new Request("https://app.example.test/scripts", {
    method: "POST",
    headers: {
      ...(origin ? { Origin: origin } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
}
test("CSRF requires same origin and matching valid cookie/form tokens", () => {
  assert.equal(verifyCsrf(request(), token, false), true);
  for (const [req, value] of [
    [request(null), token],
    [request("https://other.test"), token],
    [request(), "b".repeat(43)],
    [request(), null],
    [request(undefined, ""), token],
    [
      request(undefined, `__Host-sp_csrf=${token}; __Host-sp_csrf=${token}`),
      token,
    ],
  ])
    assert.equal(verifyCsrf(req, value, false), false);
});
test("cookie is host-scoped, secure in Access mode and reused when valid", () => {
  const created = csrfForRequest(
    new Request("https://app.example.test/"),
    false,
  );
  assert.match(created.token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(
    created.cookie,
    /__Host-sp_csrf=.*; Path=\/; Secure; HttpOnly; SameSite=Strict/,
  );
  assert.deepEqual(csrfForRequest(request(), false), { token });
});
test("local cookie cannot authorize an Access-mode form", () => {
  const req = request(undefined, `sp_csrf=${token}`);
  assert.equal(verifyCsrf(req, token, false), false);
  assert.equal(verifyCsrf(req, token, true), true);
  assert.doesNotMatch(
    csrfForRequest(new Request("http://localhost/"), true).cookie,
    /Secure/,
  );
});
