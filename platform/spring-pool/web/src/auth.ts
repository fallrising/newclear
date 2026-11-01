export type AuthEnvironment = {
  ENVIRONMENT?: string;
  AUTH_MODE?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  OWNER_EMAIL?: string;
  LOCAL_OWNER_EMAIL?: string;
};
export type AuthResult =
  | { ok: true; actor: string; local: boolean }
  | { ok: false; status: 401 | 403 | 503; message: string };
type AccessKey = JsonWebKey & { kid?: string; use?: string; alg?: string };
type Options = { fetch?: typeof fetch; now?: () => number };
const unavailable = (): AuthResult => ({
  ok: false,
  status: 503,
  message: "Authentication is not configured.",
});
const rejected = (): AuthResult => ({
  ok: false,
  status: 401,
  message: "Not authenticated.",
});
const validEmail = (v: unknown): v is string =>
  typeof v === "string" &&
  v.length <= 254 &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid encoding");
  return Uint8Array.from(
    atob(value.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0),
  );
}
function object(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
      decode(value),
    ),
  );
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error("Invalid claims");
  return parsed as Record<string, unknown>;
}
async function readKeys(response: Response): Promise<AccessKey[]> {
  if (!response.ok || !response.body) throw new Error("JWKS unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) {
        await reader.cancel();
        throw new Error("JWKS oversized");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const data: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes),
  );
  if (
    !data ||
    typeof data !== "object" ||
    !("keys" in data) ||
    !Array.isArray(data.keys) ||
    data.keys.length > 32
  )
    throw new Error("Invalid JWKS");
  return data.keys.filter(
    (k): k is AccessKey =>
      !!k &&
      typeof k === "object" &&
      k.kty === "RSA" &&
      typeof k.kid === "string" &&
      (!k.alg || k.alg === "RS256") &&
      (!k.use || k.use === "sig"),
  );
}
export function createAuthenticator(options: Options = {}) {
  const fetchKeys = options.fetch ?? globalThis.fetch.bind(globalThis);
  const now = options.now ?? (() => Date.now() / 1000);
  const cache = new Map<string, { keys: AccessKey[]; expires: number }>();
  async function keys(domain: string, force = false) {
    const cached = cache.get(domain);
    if (!force && cached && cached.expires > now()) return cached.keys;
    const result = await readKeys(
      await fetchKeys(`https://${domain}/cdn-cgi/access/certs`, {
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      }),
    );
    cache.set(domain, { keys: result, expires: now() + 600 });
    return result;
  }
  return async function authenticate(
    request: Request,
    env: AuthEnvironment,
  ): Promise<AuthResult> {
    if (env.AUTH_MODE === "local") {
      if (
        env.ENVIRONMENT !== "local" ||
        !["localhost", "127.0.0.1", "[::1]"].includes(
          new URL(request.url).hostname,
        ) ||
        !validEmail(env.LOCAL_OWNER_EMAIL)
      )
        return unavailable();
      return {
        ok: true,
        actor: env.LOCAL_OWNER_EMAIL.toLowerCase(),
        local: true,
      };
    }
    const domain = env.ACCESS_TEAM_DOMAIN;
    if (
      env.AUTH_MODE !== "access" ||
      !domain ||
      !/^[a-z0-9][a-z0-9-]*\.cloudflareaccess\.com$/.test(domain) ||
      !env.ACCESS_AUD?.trim() ||
      !validEmail(env.OWNER_EMAIL)
    )
      return unavailable();
    const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
    if (!jwt || jwt.length > 16384) return rejected();
    let header: Record<string, unknown>,
      claims: Record<string, unknown>,
      signature: Uint8Array<ArrayBuffer>,
      parts: string[];
    try {
      parts = jwt.split(".");
      if (parts.length !== 3) return rejected();
      header = object(parts[0]);
      claims = object(parts[1]);
      signature = decode(parts[2]);
      if (
        header.alg !== "RS256" ||
        typeof header.kid !== "string" ||
        !header.kid ||
        header.kid.length > 256
      )
        return rejected();
      const audience =
        typeof claims.aud === "string" ? [claims.aud] : claims.aud;
      if (
        !Array.isArray(audience) ||
        !audience.includes(env.ACCESS_AUD) ||
        claims.iss !== `https://${domain}` ||
        typeof claims.exp !== "number" ||
        !Number.isFinite(claims.exp) ||
        claims.exp <= now() ||
        (claims.nbf !== undefined &&
          (typeof claims.nbf !== "number" ||
            !Number.isFinite(claims.nbf) ||
            claims.nbf > now() + 60)) ||
        !validEmail(claims.email)
      )
        return rejected();
    } catch {
      return rejected();
    }
    let key: AccessKey | undefined;
    try {
      const cachedBefore = cache.has(domain);
      key = (await keys(domain)).find((k) => k.kid === header.kid);
      // A fresh fetch already checked the latest set; refresh an existing cache once on rotation.
      if (!key && cachedBefore)
        key = (await keys(domain, true)).find((k) => k.kid === header.kid);
    } catch {
      return {
        ok: false,
        status: 503,
        message: "Authentication service unavailable.",
      };
    }
    if (!key) return rejected();
    try {
      const imported = await crypto.subtle.importKey(
        "jwk",
        key,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      );
      if (
        !(await crypto.subtle.verify(
          "RSASSA-PKCS1-v1_5",
          imported,
          signature,
          new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
        ))
      )
        return rejected();
    } catch {
      return rejected();
    }
    const actor = (claims.email as string).toLowerCase();
    if (actor !== env.OWNER_EMAIL.toLowerCase())
      return { ok: false, status: 403, message: "Not authorized." };
    return { ok: true, actor, local: false };
  };
}
export const authenticate = createAuthenticator();
