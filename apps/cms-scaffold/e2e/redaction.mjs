/** Shared by browser helpers and the runner; no unredacted logs are persisted. */
export function redact(text, secrets = []) {
  let out = String(text);
  for (const secret of [...new Set(secrets)].filter(Boolean).sort((a, b) => b.length - a.length)) {
    out = out.split(secret).join("[REDACTED]");
    out = out.split(JSON.stringify(secret).slice(1, -1)).join("[REDACTED]");
  }
  return out
    .replace(/(\bcms_session\s*=\s*)[^;\s"'\\]+/gi, "$1[REDACTED]")
    .replace(/("(?:csrfToken|X-CSRF-Token|Authorization)"\s*:\s*")[^"\r\n]*(")/gi, "$1[REDACTED]$2")
    .replace(/("name"\s*:\s*"(?:X-CSRF-Token|Authorization)"\s*,\s*"value"\s*:\s*")[^"\r\n]*(")/gi, "$1[REDACTED]$2")
    .replace(/((?:X-CSRF-Token|Authorization)\s*[:=]\s*)[^\r\n",}]+/gi, "$1[REDACTED]");
}
