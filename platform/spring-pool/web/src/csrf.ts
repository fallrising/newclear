function cookieToken(request: Request, local: boolean): string | undefined {
  const name = local ? "sp_csrf" : "__Host-sp_csrf";
  const matching = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`));
  if (matching.length !== 1) return undefined;
  const value = matching[0].slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
}
export function csrfForRequest(
  request: Request,
  local: boolean,
): { token: string; cookie?: string } {
  const previous = cookieToken(request, local);
  if (previous) return { token: previous };
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const cookie = `${local ? "sp_csrf" : "__Host-sp_csrf"}=${token}; Path=/; ${local ? "" : "Secure; "}HttpOnly; SameSite=Strict`;
  return { token, cookie };
}
export function verifyCsrf(
  request: Request,
  submitted: unknown,
  local: boolean,
): boolean {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return false;
  const expected = cookieToken(request, local);
  if (
    !expected ||
    typeof submitted !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(submitted)
  )
    return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++)
    difference |= expected.charCodeAt(i) ^ submitted.charCodeAt(i);
  return difference === 0;
}
