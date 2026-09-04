interface Envelope<T> {
  code: string;
  msg: string;
  data: T;
}

interface Csrf {
  headerName: string;
  parameterName: string;
  token: string;
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message || code);
  }
}

let csrf: Csrf | undefined;

async function csrfToken(): Promise<Csrf> {
  if (csrf) {
    return csrf;
  }
  const response = await fetch("/api/v1/auth/csrf", {
    credentials: "include",
  });
  const body = (await response.json()) as Envelope<Csrf>;
  if (!response.ok || body.code !== "OK") {
    throw new ApiError(body.code, body.msg, response.status);
  }
  csrf = body.data;
  return csrf;
}

export async function api<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const token = await csrfToken();
    headers.set(token.headerName, token.token);
  }
  const response = await fetch(path, {
    ...init,
    method,
    headers,
    credentials: "include",
  });
  let envelope: Envelope<T>;
  try {
    envelope = (await response.json()) as Envelope<T>;
  } catch {
    throw new ApiError(
      "BAD_RESPONSE",
      "The control plane returned an unreadable response",
      response.status,
    );
  }
  if (!response.ok || envelope.code !== "OK") {
    throw new ApiError(envelope.code, envelope.msg, response.status);
  }
  return envelope.data;
}

export function resetCsrfForTests(): void {
  csrf = undefined;
}
